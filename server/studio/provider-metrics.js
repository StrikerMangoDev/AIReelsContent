import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createPostizProvider, publishingConfig } from '../publishing/provider.js'
import { workspaceRole } from './workspaces.js'
import { contentHash } from './approval.js'

const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message })
const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/)
const number = z.union([z.number().finite(), z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/)]).refine(value => Number.isFinite(Number(value)))
const seriesSchema = z.array(z.object({ label: z.string().trim().min(1).max(120), data: z.array(z.object({ total: number.nullable(), date: z.iso.date() }).strip()).max(366), percentageChange: z.number().finite().nullable().optional() }).strip()).max(50)

// Keep provider daily series intact: their labels do not establish matching rate denominators.
export function parseProviderPostAnalytics(value) {
  if (value && !Array.isArray(value) && value.missing === true) return { status: 'missing_release_id', series: [], reason: 'The provider needs a verified native post association before analytics are available.' }
  const series = seriesSchema.parse(value)
  return { status: series.some(item => item.data.some(point => point.total !== null)) ? 'available' : 'unavailable', series, reason: series.length ? 'Provider-returned daily series. Metric definitions, distribution and cumulative-versus-daily meaning must be established before calculating cross-metric rates.' : 'The provider returned no metrics for this post and period.' }
}

export async function syncProviderMetrics({ repository, owner, pack, publication, days = 7, actor, authorize, provider = createPostizProvider(), config = publishingConfig, now = () => new Date() }) {
  if (![7, 30, 90].includes(days)) throw fail(422, 'Unsupported analytics window')
    id.parse(publication.providerPostId)
    const key = createHash('sha256').update(JSON.stringify([pack.id, publication.id, days])).digest('hex').slice(0, 32)
    const lease = `complete-metrics:${owner}:${key}`; const leaseOwner = randomUUID()
    if (!await repository.acquireLease(lease, leaseOwner, 120000)) throw fail(409, 'This analytics read is already in progress')
    try {
      const checkCurrent = async () => {
        if (authorize ? !await authorize() : !['owner', 'editor'].includes(await workspaceRole(repository, owner, actor))) throw fail(403, 'Workspace access changed during the analytics read')
        const [latest, receipt] = await Promise.all([repository.studioGet(owner, 'package', pack.id), repository.studioGet(owner, 'social_publication', publication.id)])
        const latestConfiguration = config()
        if (!latestConfiguration.enabled || !latestConfiguration.accounts.some(account => account.ownerScope === owner && account.accountId === publication.accountId && account.platform === publication.platform)) throw fail(409, 'The provider configuration changed during the analytics read')
        if (!publication.releaseUrl || publication.packageId !== pack.id || !latest || contentHash(latest) !== contentHash(pack) || !receipt || ['packageId', 'platform', 'accountId', 'providerPostId', 'releaseUrl', 'contentHash'].some(field => receipt[field] !== publication[field]) || receipt.status !== 'published' || receipt.providerState !== 'PUBLISHED') throw fail(409, 'The package or publication changed during the analytics read')
      }
      const previous = await repository.studioGet(owner, 'complete_provider_metrics', key)
      const cacheAge = previous ? new Date(now()).getTime() - Date.parse(previous.fetchedAt) : NaN
      if (previous && previous.contentHash === contentHash(pack) && ['publicationId', 'platform', 'accountId', 'providerPostId', 'releaseUrl'].every(field => previous[field] === (field === 'publicationId' ? publication.id : publication[field])) && previous.publishedContentHash === (publication.contentHash || null) && cacheAge >= 0 && cacheAge < 900000) {
        await checkCurrent()
        return { snapshot: previous, cached: true }
      }
      await checkCurrent()
      const value = parseProviderPostAnalytics(await provider.postAnalytics(publication.providerPostId, days))
      await checkCurrent()
      const snapshot = await repository.studioPut(owner, 'complete_provider_metrics', key, { ...value, packageId: pack.id, contentHash: contentHash(pack), publishedContentHash: publication.contentHash || null, publicationId: publication.id, platform: publication.platform, accountId: publication.accountId, providerPostId: publication.providerPostId, releaseUrl: publication.releaseUrl, days, fetchedAt: new Date(now()).toISOString(), source: { kind: 'provider_read', label: 'Postiz post analytics', documentation: 'https://docs.postiz.com/public-api/analytics/post' }, requestedBy: actor, normalization: 'raw_series_only', limitations: ['This is a server-authenticated provider read, not independent verification of the underlying social network measurements.', 'No missing metrics are replaced with zeros and no daily series are silently summed or treated as lifetime totals.'] }, previous?.revision || 0)
      return { snapshot, cached: false }
    } finally { await repository.releaseLease(lease, leaseOwner) }
}
