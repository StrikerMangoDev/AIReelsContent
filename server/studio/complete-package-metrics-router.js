import { Router } from 'express'
import { z } from 'zod'
import { createPostizProvider, publishingConfig } from '../publishing/provider.js'
import { workspaceAuth, requireWriteRole, ownerScope } from './workspaces.js'
import { syncProviderMetrics } from './provider-metrics.js'

const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message })
const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/)
export { parseProviderPostAnalytics } from './provider-metrics.js'

export function createCompletePackageMetricsRouter({ repository, auth, provider = createPostizProvider(), config = publishingConfig, now = () => new Date() }) {
  const router = Router()
  const base = '/packages/:id/complete-package/metrics'
  router.use((req, _res, next) => /^\/packages\/[^/]+\/complete-package\/metrics(?:\/|$)/.test(req.path) ? next() : next('router'))
  router.use(workspaceAuth(repository, auth), requireWriteRole)
  async function scope(req) {
    const owner = ownerScope(req)
    const pack = await repository.studioGet(owner, 'package', req.params.id)
    if (!pack) throw fail(404, 'Content package not found')
    const configuration = config()
    const accounts = configuration.accounts.filter(account => account.ownerScope === owner)
    const publications = (await repository.studioList(owner, 'social_publication')).filter(item => item.packageId === pack.id && item.status === 'published' && item.providerState === 'PUBLISHED' && item.releaseUrl && item.providerPostId && accounts.some(account => account.accountId === item.accountId && account.platform === item.platform))
    return { owner, pack, configuration, publications }
  }
  router.get(`${base}/config`, async (req, res) => {
    const { configuration, publications } = await scope(req)
    res.json({ configured: configuration.enabled, reason: configuration.enabled ? 'Only confirmed published receipts in this workspace can be read.' : 'Server publishing credentials and authorized account mappings are required for provider analytics.', eligiblePublications: publications.map(({ id, platform, accountId, providerPostId, releaseUrl, contentHash: publishedContentHash }) => ({ id, platform, accountId, providerPostId, releaseUrl, publishedContentHash })) })
  })
  router.post(`${base}/sync`, async (req, res) => {
    const input = z.object({ publicationId: id, days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(7) }).strict().parse(req.body)
    const { owner, pack, configuration, publications } = await scope(req)
    if (!configuration.enabled) throw fail(503, 'Provider analytics is not configured for this workspace')
    const publication = publications.find(item => item.id === input.publicationId)
    if (!publication) throw fail(422, 'Choose a confirmed published receipt belonging to this package and account')
    res.json(await syncProviderMetrics({ repository, owner, pack, publication, days: input.days, actor: req.identity.uid, provider, config, now }))
  })
  router.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(422).json({ error: 'Analytics fields or provider response do not match the supported schema; no measurements were invented.' })
    if (error.publicMessage) return res.status(error.status).json({ error: error.publicMessage })
    if (Number.isInteger(error.status)) return res.status(502).json({ error: 'The analytics provider rejected this read. Check the account connection and API access.', providerStatus: error.status })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'The analytics snapshot changed. Reload before reading again.' })
    res.status(502).json({ error: 'Provider analytics could not be read. No measurements were saved.' })
  })
  return router
}
