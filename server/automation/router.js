import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ownerScope, workspaceAuth, requireWriteRole } from '../studio/workspaces.js'
import { automationRegistryOwner } from './runner.js'
import { assessAutomationRelease } from './services.js'
import { contentHash } from '../studio/approval.js'
import { costScopeHash } from '../budget/policy.js'

export function createAutomationRouter({ repository, auth, onAutomationAdmitted, assessReady = assessAutomationRelease }) {
  const router = Router()
  router.use((req, _res, next) => /^\/automation(?:\/|$)/.test(req.path) ? next() : next('router'))
  router.use(workspaceAuth(repository, auth), requireWriteRole, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/automation', async (req, res) => {
    const owner = ownerScope(req)
    const [profiles, plans, runs, requests, requestResults] = await Promise.all(['account_profile', 'automation_plan', 'automation_run', 'automation_request', 'automation_request_result'].map(kind => repository.studioList(owner, kind)))
    res.json({ profiles, plans, runs, requests, requestResults })
  })
  router.get('/automation/packages/:id/export', async (req, res) => {
    const owner = ownerScope(req)
    const pack = await repository.studioGet(owner, 'package', req.params.id)
    if (!pack) return res.status(404).json({ error: 'Content package not found.' })
    const profiles = await repository.studioList(owner, 'account_profile')
    const profile = profiles.find(value => costScopeHash(value, null) === pack.automaticReview?.profileHash)
    if (!profile) return res.status(422).json({ error: 'This content needs a current account-bound automated review before export.' })
    const run = (await repository.studioList(owner, 'automation_run')).filter(value => value.packageId === pack.id && value.assetIds?.length).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
    const assets = run ? await Promise.all(run.assetIds.map(id => repository.studioGet(owner, 'asset', id))) : (await repository.studioList(owner, 'asset')).filter(asset => asset.packageId === pack.id && asset.packageContentHash === contentHash(pack) && asset.status === 'completed').sort((a, b) => a.id.localeCompare(b.id))
    const assessment = await assessReady({ repository, owner, pack, assets, profile, actorUid: req.identity.uid, input: { automatic: true, accountId: profile.accountId, platform: profile.platform } })
    if (!assessment.eligible) return res.status(422).json({ error: assessment.issues.join(' ') })
    res.json({ manifest: { scope: 'automated-text-and-media-package', method: 'automated-content-release-v1', contentHash: contentHash(pack), profileHash: costScopeHash(profile, null), exportedAt: new Date().toISOString(), textReview: pack.automaticReview, media: assessment.media, sources: pack.evidence.map(({ id, url, retrievedAt, hash }) => ({ id, url, retrievedAt, hash })), limitations: ['Automated checks and model evaluation; no independent human approval or universal factual accuracy is claimed.'] }, package: pack, assets: assets.map(asset => ({ id: asset.id, kind: asset.kind, mime: asset.mime, sha256: asset.sha256, bytes: asset.bytes, fileUrl: `/api/studio/assets/${encodeURIComponent(asset.id)}/file` })) })
  })
  router.post('/automation/run', async (req, res) => {
    if (req.workspace.role !== 'owner') return res.status(403).json({ error: 'Only the workspace owner can run account automation.' })
    const input = z.object({ accountIds: z.array(z.string().min(1).max(200)).min(1).max(5).optional() }).strict().parse(req.body)
    const owner = ownerScope(req)
    const profiles = (await repository.studioList(owner, 'account_profile')).filter(profile => profile.enabled && profile.automationConsent && (!input.accountIds || input.accountIds.includes(profile.accountId)))
    if (!profiles.length || input.accountIds?.some(id => !profiles.some(profile => profile.accountId === id))) return res.status(422).json({ error: 'Choose enabled accounts with a saved automation plan and owner consent.' })
    if (!onAutomationAdmitted) return res.status(503).json({ error: 'Automatic execution is not configured. Your saved account plans are safe.' })
    const id = randomUUID()
    const request = await repository.studioPut(owner, 'automation_request', id, { status: 'queued', actorUid: req.identity.uid, accountIds: profiles.map(profile => profile.accountId), error: null }, 0)
    const registered = await repository.studioGet(automationRegistryOwner, 'automation_owner', owner)
    await repository.studioPut(automationRegistryOwner, 'automation_owner', owner, { ownerScope: owner, enabled: true }, registered?.revision || 0)
    try { await onAutomationAdmitted({ owner, actorUid: req.identity.uid, requestId: id, accountIds: request.accountIds }) }
    catch {
      const current = await repository.studioGet(owner, 'automation_request', id)
      if (current?.status === 'queued') await repository.studioPut(owner, 'automation_request', id, { ...current, status: 'dispatch_unknown', error: 'The dispatcher did not confirm the full run. Check the saved account stages before requesting another run.' }, current.revision)
      return res.status(503).json({ error: 'Automatic execution could not start. Check the saved run before trying again.', requestId: id })
    }
    res.status(202).json(await repository.studioGet(owner, 'automation_request', id))
  })
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Choose valid enabled account identifiers.' })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'Automation state changed. Reload before trying again.' })
    next(error)
  })
  return router
}
