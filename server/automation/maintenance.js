import { createHash, randomUUID } from 'node:crypto'
import https from 'node:https'
import { load } from 'cheerio'
import { automationRegistryOwner } from './runner.js'
import { policyReferenceOwner, policyReferences } from '../studio/package-rules.js'
import { safeSourceUrl } from '../studio/evidence.js'
import { syncProviderMetrics } from '../studio/provider-metrics.js'
import { createPostizProvider, publishingConfig } from '../publishing/provider.js'

const day = 86400000
const date = value => new Date(value).toISOString()
const due = (record, now) => !record?.nextAttemptAt || Date.parse(record.nextAttemptAt) <= +now
const hash = value => createHash('sha256').update(value).digest('hex')
const failure = (previous, now) => ({ failures: Math.min(7, (previous?.failures || 0) + 1), nextAttemptAt: date(+now + day * Math.min(7, 2 ** (previous?.failures || 0))) })

export async function fetchPolicyReference(reference) {
  if (!policyReferences.some(item => item.id === reference.id && item.url === reference.url)) throw new Error('Unapproved policy reference')
  let dnsTimer
  const { url, address } = await Promise.race([safeSourceUrl(reference.url), new Promise((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('Policy DNS timeout')), 3000) })]).finally(() => clearTimeout(dnsTimer))
  const body = await new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'EvidenceStudioPolicyReference/1.0', Accept: 'text/html,text/plain' }, lookup: (_host, options, callback) => callback(null, options.all ? [{ address, family: 4 }] : address, 4) }, response => {
      // Redirects are deliberately not followed, including redirects to other official hosts.
      if (response.statusCode !== 200 || !/^text\/(html|plain)/i.test(response.headers['content-type'] || '')) { response.resume(); reject(new Error('Official reference unavailable')); return }
      const chunks = []; let size = 0
      response.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(new Error('Policy response too large')); else chunks.push(chunk) })
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); response.on('error', reject)
    })
    const timer = setTimeout(() => request.destroy(new Error('Policy fetch timeout')), 8000)
    request.on('close', () => clearTimeout(timer)); request.on('error', reject)
  })
  const $ = load(body); $('script,style,nav,footer,header,noscript').remove()
  const main = $('main,article').first(); const text = (main.length ? main.text() : $.text()).replace(/\s+/g, ' ').trim()
  if (text.length < 200 || /^(access denied|just a moment|please enable javascript)/i.test(text)) throw new Error('Policy text unavailable')
  return { contentHash: hash(text), excerpt: text.slice(0, 600), bytes: Buffer.byteLength(body) }
}

async function batches(values, width, work) {
  const results = []
  for (let i = 0; i < values.length; i += width) results.push(...await Promise.all(values.slice(i, i + width).map(work)))
  return results
}

export async function refreshPolicyReferences({ repository, now = new Date(), fetchReference = fetchPolicyReference }) {
  const owner = randomUUID(); const lease = 'complete-policy-refresh'
  if (!await repository.acquireLease(lease, owner, 240000)) return { status: 'busy' }
  try {
    const results = await batches(policyReferences, 3, async reference => {
      const previous = await repository.studioGet(policyReferenceOwner, 'policy_reference', reference.id)
      if (!due(previous, now)) return { id: reference.id, status: 'cached' }
      let value
      try {
        const fetched = await fetchReference(reference)
        if (!/^[a-f0-9]{64}$/.test(fetched.contentHash)) throw new Error('Invalid policy response')
        const contentChanged = Boolean(previous?.contentHash && previous.contentHash !== fetched.contentHash)
        value = { ...reference, ...fetched, retrievalStatus: 'retrieved_unreviewed', fetchedAt: date(now), attemptedAt: date(now), contentChanged, reviewDue: contentChanged ? date(now) : previous?.reviewDue || reference.reviewDue, failures: 0, nextAttemptAt: date(+now + day), provenance: 'scheduled_official_reference_get', limitation: 'Retrieved automatically; changes require editorial interpretation. No policy compliance is inferred.' }
      } catch {
        value = { ...reference, contentHash: previous?.contentHash || null, fetchedAt: previous?.fetchedAt || null, attemptedAt: date(now), retrievalStatus: 'unavailable', reviewDue: previous?.reviewDue || reference.reviewDue, ...failure(previous, now), provenance: 'scheduled_official_reference_get', limitation: 'Official source could not be retrieved. Earlier content, if any, does not establish current requirements.' }
      }
      await repository.studioPut(policyReferenceOwner, 'policy_reference', reference.id, value, previous?.revision || 0)
      return { id: reference.id, status: value.retrievalStatus }
    })
    return { status: 'completed', results }
  } finally { await repository.releaseLease(lease, owner) }
}

export async function refreshRegisteredMetrics({ repository, now = new Date(), provider = createPostizProvider(), config = publishingConfig, limit = 10 }) {
  const lease = 'complete-scheduled-metrics'; const leaseOwner = randomUUID()
  if (!await repository.acquireLease(lease, leaseOwner, 240000)) return { status: 'busy' }
  try {
    const configuration = config()
    if (!configuration.enabled) return { status: 'unavailable', reason: 'Provider analytics is not configured.' }
    const owners = (await repository.studioList(automationRegistryOwner, 'automation_owner')).filter(item => item.enabled && typeof item.ownerScope === 'string')
    if (owners.length > 20) return { status: 'capacity_exceeded' }
    const candidates = []
    for (const record of owners) {
      const owner = record.ownerScope
      const [profiles, receipts, refreshes] = await Promise.all(['account_profile', 'social_publication', 'complete_metrics_refresh'].map(kind => repository.studioList(owner, kind)))
      for (const publication of receipts) {
        const profile = profiles.find(item => item.enabled && item.automationConsent && item.accountId === publication.accountId && item.platform === publication.platform)
        const previous = refreshes.find(item => item.id === publication.id)
        if (!profile || publication.status !== 'published' || publication.providerState !== 'PUBLISHED' || !publication.releaseUrl || !publication.providerPostId || !configuration.accounts.some(account => account.ownerScope === owner && account.accountId === publication.accountId && account.platform === publication.platform) || !due(previous, now)) continue
        candidates.push({ owner, profile, publication, previous })
      }
    }
    candidates.sort((a, b) => String(a.previous?.attemptedAt || '').localeCompare(String(b.previous?.attemptedAt || '')) || a.publication.id.localeCompare(b.publication.id))
    const results = await batches(candidates.slice(0, Math.min(10, Math.max(1, limit))), 5, async ({ owner, profile, publication, previous }) => {
      const authorize = async () => {
        const [registry, current] = await Promise.all([repository.studioGet(automationRegistryOwner, 'automation_owner', owner), repository.studioGet(owner, 'account_profile', profile.id)])
        return registry?.enabled === true && registry.ownerScope === owner && current?.enabled === true && current.automationConsent === true && current.accountId === publication.accountId && current.platform === publication.platform
      }
      let value
      try {
        const pack = await repository.studioGet(owner, 'package', publication.packageId)
        if (!pack) throw new Error('Package unavailable')
        const result = await syncProviderMetrics({ repository, owner, pack, publication, actor: 'scheduled_maintenance', authorize, provider, config, now: () => now })
        value = { status: result.snapshot.status, fetchedAt: result.snapshot.fetchedAt, snapshotId: result.snapshot.id, failures: 0, nextAttemptAt: date(+now + day) }
      } catch {
        value = { status: 'unavailable', fetchedAt: previous?.fetchedAt || null, snapshotId: previous?.snapshotId || null, reason: 'Scheduled provider read unavailable or authorization changed; previous measurements were preserved.', ...failure(previous, now) }
      }
      const result = await repository.studioPut(owner, 'complete_metrics_refresh', publication.id, { ...value, packageId: publication.packageId, publicationId: publication.id, accountId: publication.accountId, platform: publication.platform, attemptedAt: date(now), provenance: 'scheduled_provider_read' }, previous?.revision || 0)
      return { publicationId: publication.id, status: result.status }
    })
    return { status: 'completed', results, deferred: Math.max(0, candidates.length - results.length) }
  } finally { await repository.releaseLease(lease, leaseOwner) }
}

export async function runScheduledMaintenance(options) {
  const results = await Promise.allSettled([refreshPolicyReferences(options), refreshRegisteredMetrics(options)])
  return Object.fromEntries(results.map((result, index) => [index === 0 ? 'policies' : 'analytics', result.status === 'fulfilled' ? result.value : { status: 'unavailable' }]))
}
