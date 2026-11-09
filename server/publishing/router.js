import { Router } from 'express'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { ownerScope, workspaceAuth, requireWriteRole, workspaceRole } from '../studio/workspaces.js'
import { contentHash } from '../studio/approval.js'
import { assessRelease } from '../studio/release.js'
import { assessMediaAcceptance } from '../media/acceptance.js'
import { readMediaFile } from '../media/files.js'
import { costScopeHash } from '../budget/policy.js'
import { createPostizProvider, publishingConfig } from './provider.js'
import { platformSettings, renderSocialCaption, socialSourceUrls } from './constraints.js'
import { postizContentMatches } from './readback.js'
import { setTimeout as delay } from 'node:timers/promises'

const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message })
const inputSchema = z.object({ requestId: z.guid(), revision: z.number().int().positive(), accountId: z.string().min(1).max(200), platform: z.string().min(1).max(80), mode: z.enum(['draft', 'schedule', 'now']), publishAt: z.iso.datetime().optional(), caption: z.string().trim().min(1).max(12000), assetIds: z.array(z.string().min(1).max(100)).min(1).max(10), confirmed: z.literal(true), automatic: z.boolean().default(false) }).strict().superRefine((input, ctx) => {
  if (!input.automatic && !z.uuid().safeParse(input.requestId).success) ctx.addIssue({ code: 'custom', path: ['requestId'], message: 'Manual publication requires a UUID request identifier' })
})
const profileSchema = z.object({ accountId: z.string().min(1).max(200), weeklyBrief: z.string().trim().min(15).max(4000), audience: z.string().trim().min(1).max(500), tone: z.string().trim().min(1).max(200), contentPillars: z.array(z.string().trim().min(1).max(200)).min(1).max(12), weeklyCadence: z.number().int().min(0).max(14), dailyNews: z.boolean(), maxDailyPosts: z.number().int().min(1).max(10), timezone: z.string().max(100).default('Asia/Calcutta').refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }), enabled: z.boolean(), automationConsent: z.boolean().default(false), revision: z.number().int().min(0) }).strict()

export function approvedCaption(pack, platform) {
  return renderSocialCaption(pack, platform)
}

async function defaultReady({ repository, owner, pack, assets, input }) {
  if (input.automatic) return { eligible: false, issues: ['An explicit automated release policy is required.'] }
  const text = await assessRelease(repository, owner, pack)
  const media = assessMediaAcceptance(pack, assets)
  return { eligible: text.eligible && media.eligible, issues: [...text.issues, ...media.issues] }
}

export function createPublishingService({ repository, provider = createPostizProvider(), config = publishingConfig, readFile = readMediaFile, assessReady = defaultReady }) {
  const accountFor = (owner, id, platform) => config().accounts.find(account => account.ownerScope === owner && account.accountId === id && account.platform === platform)
  const profileId = accountId => createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  async function packFor(owner, id) { const pack = await repository.studioGet(owner, 'package', id); if (!pack) throw fail(404, 'Content package not found'); return pack }
  async function actorCanWrite(owner, actor) { if (!['owner', 'editor'].includes(await workspaceRole(repository, owner, actor))) throw fail(403, 'Publishing access changed before dispatch') }
  return { async publish({ owner, actorUid, packageId, input: rawInput }) {
    let externalAttempted = false
    try {
    const input = inputSchema.parse(rawInput); await actorCanWrite(owner, actorUid)
    if (!config().enabled) throw fail(503, 'Social publishing is not configured')
    const account = accountFor(owner, input.accountId, input.platform)
    if (!account) throw fail(422, 'Choose an authorized platform and account')
    if (new Set(input.assetIds).size !== input.assetIds.length) throw fail(400, 'Choose each media asset once')
    if (input.mode === 'schedule' && (!input.publishAt || Date.parse(input.publishAt) <= Date.now())) throw fail(422, 'Choose a future publication time')
    if (input.mode !== 'schedule' && input.publishAt) throw fail(400, 'Only scheduled posts accept a publication time')
    const pack = await packFor(owner, packageId)
    if (pack.revision !== input.revision) throw fail(409, 'Content changed before publishing')
    if (approvedCaption(pack, input.platform) !== input.caption) throw fail(422, 'Publish the exact saved platform text; save and review changes first')
    if (!socialSourceUrls(pack, input.platform).length) throw fail(422, 'The saved post needs an attached cited source URL before publishing.')
    const assets = await Promise.all(input.assetIds.map(id => repository.studioGet(owner, 'asset', id)))
    if (assets.some(asset => !asset || asset.packageId !== pack.id || !['image', 'video'].includes(asset.kind))) throw fail(422, 'Choose completed image or video assets from this package')
    const providerSettings = platformSettings(pack, account, assets)
    const profile = await repository.studioGet(owner, 'account_profile', profileId(account.accountId))
    const ready = await assessReady({ repository, owner, pack, assets, input, profile, actorUid: actorUid })
    if (!ready.eligible) throw fail(422, ready.issues.join(' '))
    const scope = { packageId: pack.id, contentHash: contentHash(pack), profileHash: profile ? costScopeHash(profile, null) : null, accountId: account.accountId, platform: account.platform, provider: account.provider, providerSettings, mode: input.mode, publishAt: input.publishAt || null, caption: input.caption, assets: assets.map(asset => ({ id: asset.id, sha256: asset.sha256 })), automatic: input.automatic }
    const scopeHash = costScopeHash(scope, null); const id = scopeHash.slice(0, 32)
    const leaseId = `social-publish:${owner}`; const leaseOwner = randomUUID()
    let acquired = false
    for (let attempt = 0; attempt < 16; attempt++) {
      acquired = await repository.acquireLease(leaseId, leaseOwner, 30000)
      if (acquired) break
      if (attempt < 15) await delay(1000)
    }
    if (!acquired) throw Object.assign(fail(409, 'Another publication is being prepared; no provider dispatch was started.'), { preDispatch: true })
    let receipt
    try {
      const priorReceipts = await repository.studioList(owner, 'social_publication')
      const previous = priorReceipts.find(value => value.requestId === input.requestId)
      if (previous && previous.scopeHash !== scopeHash) throw fail(409, 'Request identifier belongs to different publication inputs')
      const duplicate = await repository.studioGet(owner, 'social_publication', id)
      if (duplicate) return { status: 200, receipt: duplicate }
      if (input.automatic) {
        if (!profile?.enabled || !profile.automationConsent || !profile.automaticPolicy || !Number.isInteger(profile.maxDailyPosts)) throw fail(422, 'Account automation consent is missing or disabled')
        const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: profile.timezone || 'Asia/Calcutta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
        const targetDay = day(input.publishAt || Date.now())
        const held = priorReceipts.filter(value => value.accountId === account.accountId && value.status !== 'blocked' && day(value.publishAt || value.dispatchedAt || value.createdAt) === targetDay)
        if (held.length >= profile.maxDailyPosts) throw fail(429, 'The account daily publication limit has been reached, including uncertain attempts')
      }
      receipt = await repository.studioPut(owner, 'social_publication', id, { ...scope, scopeHash, requestId: input.requestId, createdBy: actorUid, status: 'preparing', assetIds: input.assetIds, uploadedMedia: [], providerPostId: null, providerState: null, releaseUrl: null, error: null }, 0)
    } finally { await repository.releaseLease(leaseId, leaseOwner) }
    let dispatched = false
    try {
      const media = []
      for (const asset of assets) {
        await actorCanWrite(owner, actorUid)
        const bytes = await readFile(asset.id)
        if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256 || bytes.length !== asset.bytes) throw fail(409, 'Stored media differs from the accepted asset')
        externalAttempted = true
        const upload = await provider.upload(bytes, asset); media.push(upload)
        receipt = await repository.studioPut(owner, 'social_publication', id, { ...receipt, uploadedMedia: [...media] }, receipt.revision)
      }
      const current = await packFor(owner, pack.id)
      if (contentHash(current) !== scope.contentHash || current.revision !== pack.revision) throw fail(409, 'Content changed during publication preparation')
      const currentAssets = await Promise.all(input.assetIds.map(assetId => repository.studioGet(owner, 'asset', assetId)))
      const currentProfile = await repository.studioGet(owner, 'account_profile', profileId(account.accountId))
      const currentAccount = accountFor(owner, account.accountId, account.platform)
      const currentReady = await assessReady({ repository, owner, pack: current, assets: currentAssets, input, profile: currentProfile, actorUid: actorUid })
      if (!currentReady.eligible || !config().enabled || !currentAccount || (currentProfile ? costScopeHash(currentProfile, null) : null) !== scope.profileHash || costScopeHash(platformSettings(current, currentAccount, currentAssets), null) !== costScopeHash(scope.providerSettings, null)) throw fail(409, 'Publication authorization changed before dispatch')
      await actorCanWrite(owner, actorUid)
      receipt = await repository.studioPut(owner, 'social_publication', id, { ...receipt, status: 'dispatching', dispatchedAt: new Date().toISOString() }, receipt.revision)
      dispatched = true
      externalAttempted = true
      const result = await provider.create({ type: input.mode, date: input.publishAt || new Date().toISOString(), shortLink: false, tags: [], posts: [{ integration: { id: account.accountId }, value: [{ content: input.caption, image: media }], settings: scope.providerSettings }] })
      if (result.integration !== account.accountId) throw new Error('Provider returned a different account receipt')
      receipt = await repository.studioPut(owner, 'social_publication', id, { ...receipt, status: 'submitted', providerPostId: result.postId, submittedAt: new Date().toISOString() }, receipt.revision)
      return { status: 201, receipt }
    } catch {
      receipt = await repository.studioPut(owner, 'social_publication', id, { ...receipt, status: dispatched ? 'dispatch_unknown' : 'blocked', error: dispatched ? 'Provider outcome is uncertain. Refresh status; do not create a second post.' : 'Publication preparation failed. No post dispatch was attempted.' }, receipt.revision)
      return { status: 502, receipt }
    }
    } catch (error) {
      if (!externalAttempted) error.preDispatch = true
      throw error
    }
  }, async refresh({ owner, actorUid, id }) {
    await actorCanWrite(owner, actorUid); const receipt = await repository.studioGet(owner, 'social_publication', id)
    if (!receipt) throw fail(404, 'Publication receipt not found')
    if (!receipt.providerPostId) return receipt
    if (!config().enabled || !accountFor(owner, receipt.accountId, receipt.platform)) throw fail(503, 'Publishing readback is not configured for this account')
    const date = Date.parse(receipt.publishAt || receipt.dispatchedAt || receipt.createdAt)
    const posts = await provider.list(new Date(date - 86400000).toISOString(), new Date(date + 86400000).toISOString())
    const post = posts.find(value => value.id === receipt.providerPostId && value.integration?.id === receipt.accountId)
    if (!post || !postizContentMatches(receipt.caption, post.content)) throw fail(409, 'Provider readback does not match this publication; no retry was sent')
    const state = String(post.state || '').toUpperCase()
    const status = state === 'PUBLISHED' ? 'published' : state === 'QUEUE' ? 'scheduled' : state === 'DRAFT' ? 'draft' : state === 'ERROR' ? 'failed' : 'submitted'
    const releaseUrl = typeof post.releaseURL === 'string' && /^https:\/\//.test(post.releaseURL) ? post.releaseURL : null
    return await repository.studioPut(owner, 'social_publication', receipt.id, { ...receipt, status, providerState: state, releaseUrl, lastReadbackAt: new Date().toISOString(), error: status === 'failed' ? 'Provider reported a publication failure. No automatic retry was sent.' : null }, receipt.revision)
  } }
}

export function createPublishingRouter({ repository, auth, provider = createPostizProvider(), config = publishingConfig, readFile = readMediaFile, assessReady = defaultReady }) {
  const router = Router()
  const service = createPublishingService({ repository, provider, config, readFile, assessReady })
  router.use((req, _res, next) => /^\/(?:publishing(?:\/|$)|social-publications(?:\/|$)|packages\/[^/]+\/social-publications\/?$)/.test(req.path) ? next() : next('router'))
  router.use(workspaceAuth(repository, auth), requireWriteRole)
  const accounts = owner => config().accounts.filter(account => account.ownerScope === owner)
  const publicAccount = account => ({ id: account.accountId, name: account.name, platform: account.platform, provider: account.provider })
  const profileId = accountId => createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  async function packFor(owner, id) { const pack = await repository.studioGet(owner, 'package', id); if (!pack) throw fail(404, 'Content package not found'); return pack }

  router.get('/publishing/config', (req, res) => res.json({ enabled: config().enabled, accounts: accounts(ownerScope(req)).map(publicAccount) }))
  router.get('/publishing/receipts', async (req, res) => res.json({ publications: await repository.studioList(ownerScope(req), 'social_publication') }))
  router.get('/publishing/profiles', async (req, res) => res.json({ profiles: (await repository.studioList(ownerScope(req), 'account_profile')).filter(profile => accounts(ownerScope(req)).some(account => account.accountId === profile.accountId)) }))
  router.put('/publishing/profiles', async (req, res) => {
    if (req.workspace.role !== 'owner') throw fail(403, 'Only the workspace owner can change account automation')
    const input = profileSchema.parse(req.body); const owner = ownerScope(req)
    const account = accounts(owner).find(account => account.accountId === input.accountId)
    if (!account) throw fail(422, 'Choose an authorized social account')
    const { revision, ...settings } = input
    const saved = await repository.studioPut(owner, 'account_profile', profileId(input.accountId), { ...settings, platform: account.platform, name: account.name, automaticPolicy: input.automationConsent ? { version: 'account-automation-v1', consentedBy: req.identity.uid, consentedAt: new Date().toISOString(), scope: 'research-generation-and-social-publishing', paidBudgetMicros: 0 } : null }, revision)
    const active = (await repository.studioList(owner, 'account_profile')).some(profile => profile.enabled && profile.automationConsent && profile.automaticPolicy)
    await repository.studioPut('__automation_registry__', 'automation_owner', owner, { ownerScope: owner, enabled: active })
    res.json(saved)
  })
  router.get('/packages/:id/social-publications', async (req, res) => { const owner = ownerScope(req); await packFor(owner, req.params.id); res.json({ publications: (await repository.studioList(owner, 'social_publication')).filter(value => value.packageId === req.params.id) }) })
  router.post('/packages/:id/social-publications', async (req, res) => {
    const outcome = await service.publish({ owner: ownerScope(req), actorUid: req.identity.uid, packageId: req.params.id, input: req.body })
    res.status(outcome.status).json(outcome.receipt)
  })
  router.post('/social-publications/:id/refresh', async (req, res) => res.json(await service.refresh({ owner: ownerScope(req), actorUid: req.identity.uid, id: req.params.id })))
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Check the publication fields and exact account confirmation.' })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'Publication changed; reload its receipt before retrying.' })
    if (error.publicMessage) return res.status(error.status).json({ error: error.publicMessage })
    next(error)
  })
  return router
}
