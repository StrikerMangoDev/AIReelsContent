import { runScheduledMaintenance } from '../server/automation/maintenance.js'
import { timingSafeEqual } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { env } from '../server/config/env.js'
import { automationRegistryOwner } from '../server/automation/runner.js'
import { z } from 'zod'
import { send } from '@vercel/queue'
import { costScopeHash } from '../server/budget/policy.js'

export const automationQueueTopic = 'content-account-automation-v1'
export const automationReference = z.object({ owner: z.string().min(1).max(128), profileId: z.string().min(1).max(100), requestId: z.string().uuid().optional() }).strict()

export async function dispatchAutomation({ owner, requestId, accountIds }, repository, _retain = waitUntil, publish = send) {
  if (env.CONTENT_ACCOUNT_AUTOMATION !== 'true' || !env.CRON_SECRET) throw new Error('Automation dispatcher is disabled')
  const profiles = (await repository.studioList(owner, 'account_profile')).filter(profile => profile.enabled && profile.automationConsent && (!accountIds || accountIds.includes(profile.accountId)))
  if (profiles.length > 20) throw new Error('Automation fanout limit exceeded')
  const enqueuedAt = new Date().toISOString()
  const results = await Promise.allSettled(profiles.map(profile => publish(automationQueueTopic, { ...automationReference.parse({ owner, profileId: profile.id, ...(requestId ? { requestId } : {}) }), enqueuedAt }, { retentionSeconds: 86400, idempotencyKey: `automation:${costScopeHash({ owner, profileId: profile.id, requestId: requestId || enqueuedAt.slice(0, 10), deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local' }, null)}` })))
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) {
    console.error(JSON.stringify({ event: 'automation_queue_admission_failed', count: failures.length }))
    throw new Error('Durable automation admission failed; already admitted references remain idempotent.')
  }
  return { admitted: profiles.length }
}

const authenticateVertex = async config => {
  const { vertexGoogleAuthOptions, vertexProductionProject } = await import('../server/providers/vertex-fallback.js')
  return vertexGoogleAuthOptions({ ...config, VERTEX_FALLBACK_PROJECT: vertexProductionProject })
}
export function createAutomationHandler({ repository, retain = waitUntil, dispatch = dispatchAutomation, config = env, authenticateVertex: authenticate = authenticateVertex, maintenance = runScheduledMaintenance }) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store')
    const expected = Buffer.from(`Bearer ${config.CRON_SECRET || ''}`); const actual = Buffer.from(request.headers.authorization || '')
    if (!config.CRON_SECRET || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return response.status(401).json({ error: 'Unauthorized' })
    if (config.CONTENT_ACCOUNT_AUTOMATION !== 'true') return response.status(503).json({ error: 'Account automation is disabled.' })
    if (request.method === 'HEAD') {
      try { await authenticate(config); return response.status(204).end() }
      catch (error) {
        const diagnostic = error?.authFailure
        if (['google_auth_import', 'vercel_oidc_import', 'client_construction', 'oidc_exchange', 'google_token_exchange', 'access_token_validation'].includes(diagnostic?.phase)) response.setHeader('X-Vertex-Auth-Phase', diagnostic.phase)
        if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_INVALID_ARG_TYPE', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ENOENT', 'invalid_request', 'invalid_grant', 'invalid_target', 'permission_denied', 'unauthorized_client', 'access_denied'].includes(diagnostic?.code)) response.setHeader('X-Vertex-Auth-Code', diagnostic.code)
        if (Number.isInteger(diagnostic?.httpStatus) && diagnostic.httpStatus >= 400 && diagnostic.httpStatus <= 599) response.setHeader('X-Vertex-Auth-Status', String(diagnostic.httpStatus))
        if (['attribute_condition_rejected', 'audience_rejected', 'issuer_rejected', 'impersonation_permission_denied'].includes(diagnostic?.reason)) response.setHeader('X-Vertex-Auth-Reason', diagnostic.reason)
        return response.status(503).end()
      }
    }
    if (request.method === 'GET') {
      const owners = (await repository.studioList(automationRegistryOwner, 'automation_owner')).filter(record => record.enabled && typeof record.ownerScope === 'string')
      if (owners.length > 20) return response.status(503).json({ error: 'Scheduled workspace capacity exceeded. No partial batch was silently dispatched.' })
      retain(maintenance({ repository }).catch(() => console.error(JSON.stringify({ event: 'automation_maintenance_unavailable' }))))
      await Promise.all(owners.map(record => dispatch({ owner: record.ownerScope }, repository, retain)))
      return response.status(202).json({ status: 'admitted', workspaces: owners.length })
    }
    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
    const parsed = automationReference.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Invalid automation reference' })
    const input = parsed.data
    const registry = await repository.studioGet(automationRegistryOwner, 'automation_owner', input.owner)
    if (!registry?.enabled) return response.status(403).json({ error: 'Workspace automation is not authorized.' })
    const profile = await repository.studioGet(input.owner, 'account_profile', input.profileId)
    if (!profile?.enabled || !profile.automationConsent) return response.status(403).json({ error: 'Account automation is not authorized.' })
    await dispatch({ owner: input.owner, requestId: input.requestId, accountIds: [profile.accountId] }, repository, retain)
    return response.status(202).json({ status: 'admitted', profileId: input.profileId })
  }
}

let handler
export default async function automationHandler(request, response) {
  try {
    if (!handler) { const { repository } = await import('../server/storage/index.js'); handler = createAutomationHandler({ repository }) }
    return await handler(request, response)
  } catch { return response.status(503).json({ error: 'Automation is temporarily unavailable. Saved jobs remain available.' }) }
}
