import { z } from 'zod'
import { env } from '../config/env.js'
import { costScopeHash } from '../budget/policy.js'
import { workspaceRole } from '../studio/workspaces.js'
import { automationRegistryOwner } from './runner.js'
import { executeAccountAutomation } from './services.js'

const reference = z.object({ owner: z.string().min(1).max(128), actorUid: z.string().min(1).max(200), requestId: z.string().uuid(), accountIds: z.array(z.string().min(1).max(200)).min(1).max(20).refine(ids => new Set(ids).size === ids.length) }).strict()
const wait = ms => ms ? new Promise(resolve => setTimeout(resolve, ms)) : new Promise(resolve => setImmediate(resolve))
const sameAccounts = (a, b) => Array.isArray(a) && a.length === b.length && b.every(id => a.includes(id))
const consented = (profile, actor) => profile?.enabled && profile.automationConsent && profile.automaticPolicy?.version === 'account-automation-v1' && profile.automaticPolicy.scope === 'research-generation-and-social-publishing' && profile.automaticPolicy.paidBudgetMicros === 0 && profile.automaticPolicy.consentedBy === actor

// Local opt-in only: admission never scans or resumes an unrelated pending request.
export function localAutomationDispatcher({ repository, enabled, host, nodeEnv, vercel, config = env, run = executeAccountAutomation, pause = wait, report = () => {} }) {
  if (enabled !== 'true' || config.CONTENT_ACCOUNT_AUTOMATION !== 'true' || !['127.0.0.1', '::1', 'localhost'].includes(host) || nodeEnv === 'production' || vercel) return undefined
  let tail = Promise.resolve()
  const notify = entry => { try { report(entry) } catch { /* Logging cannot repeat or interrupt an account stage. */ } }
  return input => {
    const parsed = reference.safeParse(input)
    if (!parsed.success) throw new Error('Invalid local automation reference')
    const scope = parsed.data
    tail = tail.then(() => pause(0)).then(async () => {
      const request = await repository.studioGet(scope.owner, 'automation_request', scope.requestId)
      if (request?.status !== 'queued' || request.actorUid !== scope.actorUid || !sameAccounts(request.accountIds, scope.accountIds)) return
      let claimed
      const profiles = await repository.studioList(scope.owner, 'account_profile')
      const bindings = scope.accountIds.map(accountId => profiles.filter(profile => profile.accountId === accountId))
      const selected = bindings.flat()
      const currentScope = async binding => {
        const [current, registry, role, profile] = await Promise.all([
          repository.studioGet(scope.owner, 'automation_request', scope.requestId),
          repository.studioGet(automationRegistryOwner, 'automation_owner', scope.owner),
          workspaceRole(repository, scope.owner, scope.actorUid),
          binding ? repository.studioGet(scope.owner, 'account_profile', binding.id) : null,
        ])
        if (config.CONTENT_ACCOUNT_AUTOMATION !== 'true' || !registry?.enabled || role !== 'owner' || current?.actorUid !== scope.actorUid || !sameAccounts(current?.accountIds, scope.accountIds) || current?.status !== (claimed ? 'running' : 'queued') || claimed && current.revision !== claimed.revision) throw new Error('Local automation scope changed')
        if (binding && (!consented(profile, scope.actorUid) || profile.accountId !== binding.accountId || costScopeHash(profile, null) !== binding.hash)) throw new Error('Account consent or profile changed')
      }
      const outcomes = []
      try {
        await currentScope()
        if (bindings.some(matches => matches.length !== 1) || selected.some(profile => !consented(profile, scope.actorUid))) throw new Error('Account consent is unavailable')
        claimed = await repository.studioPut(scope.owner, 'automation_request', scope.requestId, { ...request, status: 'running' }, request.revision)
        let status = 'completed'
        for (const original of selected) {
          const binding = { id: original.id, accountId: original.accountId, hash: costScopeHash(original, null) }
          for (let pass = 0; pass < 96; pass++) {
            await currentScope(binding)
            const outcome = await run({ repository, owner: scope.owner, profileId: binding.id, requestId: scope.requestId })
            await currentScope(binding)
            const results = Array.isArray(outcome?.results) ? outcome.results : []
            const previous = outcomes.findIndex(entry => entry.profileId === binding.id)
            const recorded = { profileId: binding.id, accountId: binding.accountId, outcome }
            if (previous < 0) outcomes.push(recorded); else outcomes[previous] = recorded
            if (!outcome || outcome.status && !['completed', 'skipped'].includes(outcome.status) || results.some(result => !['pending', 'completed', 'awaiting_receipt'].includes(result.status))) { status = 'blocked'; break }
            if (outcome.deferred === true || outcome.continuationPending === true) {
              if (!results.length || results.some(result => !['pending', 'completed', 'awaiting_receipt'].includes(result.status)) || pass === 95) { status = 'blocked'; break }
              await pause(Number.isFinite(outcome.retryAfterMs) ? Math.max(0, Math.min(30000, outcome.retryAfterMs)) : 0)
              continue
            }
            if (results.some(result => result.status === 'pending')) status = 'blocked'
            else if (results.some(result => result.status === 'awaiting_receipt')) status = 'awaiting_receipt'
            break
          }
          if (status !== 'completed') break
        }
        await currentScope()
        await repository.studioPut(scope.owner, 'automation_request', scope.requestId, { ...claimed, status, outcomes, error: status === 'blocked' ? 'Local execution stopped. Inspect the saved account stage before requesting another run.' : null }, claimed.revision)
        notify({ event: 'local_automation_request', requestId: scope.requestId, status })
      } catch {
        const current = await repository.studioGet(scope.owner, 'automation_request', scope.requestId)
        if (current?.actorUid === scope.actorUid && sameAccounts(current.accountIds, scope.accountIds) && current.status === (claimed ? 'running' : 'queued') && current.revision === (claimed || request).revision) {
          await repository.studioPut(scope.owner, 'automation_request', scope.requestId, { ...current, status: 'blocked', outcomes, error: 'Local execution stopped. Saved stages remain unchanged; inspect the current request and consent before retrying.' }, current.revision)
        }
        notify({ event: 'local_automation_request', requestId: scope.requestId, status: 'blocked' })
      }
    }).catch(() => { notify({ event: 'local_automation_dispatch_failed', requestId: scope.requestId, status: 'blocked' }) })
  }
}
