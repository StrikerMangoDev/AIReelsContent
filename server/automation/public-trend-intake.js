import { createHash, randomUUID } from 'node:crypto'
import https from 'node:https'
import { load } from 'cheerio'
import { safeSourceUrl, publicAddress } from '../studio/evidence.js'
import { costScopeHash } from '../budget/policy.js'
import { workspaceRole } from '../studio/workspaces.js'

export const publicTrendVersion = 'google-public-trending-rss-v1'
const cacheOwner = '__public_trend_cache__'
const hour = 3600000
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const countryCodes = 'AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW'.split(' ')
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
const countryAliases = { uk: 'GB', usa: 'US', 'united states of america': 'US', 'south korea': 'KR', 'north korea': 'KP', russia: 'RU', vietnam: 'VN', taiwan: 'TW' }
const limits = ['Official Google public trending-search RSS capture; not an authenticated Google Trends time series or social-account trend report.', 'Approximate traffic is a reported bucket string, not an exact search-volume measurement.', 'One feed snapshot cannot establish growth, velocity, audience intent, platform reach or virality.', 'Linked news URLs and titles are observed feed metadata; those articles were not fetched or fact-checked.', 'Topic matching uses explicit query tokens and remains an editorial relevance hypothesis. Missing matches do not establish absence of demand.']
const text = value => String(value || '').replace(/\s+/g, ' ').trim()

export function normalizeTrendCountry(value) {
  const input = text(value).toLowerCase()
  if (!input || ['global', 'world', 'worldwide', 'international'].includes(input)) return null
  if (Object.hasOwn(countryAliases, input)) return countryAliases[input]
  const code = input.toUpperCase()
  if (countryCodes.includes(code)) return code
  return countryCodes.find(candidate => regionNames.of(candidate).toLowerCase() === input) || null
}

export async function fetchPublicTrendRss(country, { resolve, request = https.request, timeoutMs = 8000 } = {}) {
  const code = normalizeTrendCountry(country)
  if (!code) throw new Error('Choose an explicit supported country; no global trend feed is inferred.')
  const sourceUrl = `https://trends.google.com/trending/rss?geo=${code}`
  const deadline = Math.max(1, Math.min(8000, timeoutMs)); const started = Date.now()
  let dnsTimer
  const { url, address } = await Promise.race([safeSourceUrl(sourceUrl, resolve), new Promise((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('Public trend DNS timed out')), deadline) })]).finally(() => clearTimeout(dnsTimer))
  const remaining = deadline - (Date.now() - started)
  if (remaining <= 0) throw new Error('Public trend request timed out')
  return new Promise((resolveResult, reject) => {
    const call = request(url, { method: 'GET', headers: { Accept: 'application/rss+xml,application/xml,text/xml', 'User-Agent': 'AIReelsContent-PublicTrend/1.0' }, lookup: (_host, options, callback) => callback(null, options.all ? [{ address, family: 4 }] : address, 4) }, response => {
      if (response.statusCode !== 200 || !/^(?:application\/(?:rss\+)?xml|text\/xml)(?:;|$)/i.test(response.headers['content-type'] || '') || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.resume(); reject(new Error('Official public trend RSS is unavailable')); return }
      const chunks = []; let bytes = 0
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) { const error = new Error('Public trend feed exceeds 1 MB'); reject(error); call.destroy(error) } else chunks.push(chunk) })
      response.on('end', () => resolveResult({ xml: Buffer.concat(chunks).toString('utf8'), sourceUrl, country: code, bytes }))
      response.on('error', reject)
    })
    const timer = setTimeout(() => call.destroy(new Error('Public trend request timed out')), remaining)
    call.on('close', () => clearTimeout(timer)); call.on('error', reject); call.end()
  })
}

const childText = ($, element, name) => text($(element).children().filter((_index, child) => child.tagName === name || child.name === name).first().text())
function observedNewsUrl(value) {
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port || value.length > 2000 || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(host) || /^\d[\d.]+$/.test(host) && !publicAddress(host)) return null
    return url.href
  } catch { return null }
}

export function parsePublicTrendRss(xml, { country, now = new Date() } = {}) {
  const code = normalizeTrendCountry(country)
  if (!code || typeof xml !== 'string' || Buffer.byteLength(xml) > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Public trend feed input is invalid')
  const $ = load(xml, { xmlMode: true })
  if ($('rss > channel').length !== 1) throw new Error('Official public trend feed is not RSS')
  const entries = []; const seen = new Set()
  $('rss > channel > item').slice(0, 100).each((_index, element) => {
    const query = childText($, element, 'title').slice(0, 200)
    const published = Date.parse(childText($, element, 'pubDate'))
    if (!query || seen.has(query.toLowerCase()) || !Number.isFinite(published) || published >= now.getTime() || now.getTime() - published > 2 * 86400000) return
    seen.add(query.toLowerCase())
    const traffic = childText($, element, 'ht:approx_traffic')
    const approximateTraffic = traffic.length <= 50 && /^[\d.,\s]+[KMB]?\+?$/i.test(traffic) ? traffic : null
    const news = $(element).children().filter((_i, child) => child.tagName === 'ht:news_item' || child.name === 'ht:news_item').slice(0, 3).toArray().flatMap(item => {
      const url = observedNewsUrl(childText($, item, 'ht:news_item_url'))
      return url ? [{ title: childText($, item, 'ht:news_item_title').slice(0, 300), url, provenance: 'feed_metadata_not_fetched' }] : []
    })
    entries.push({ id: `google-trend-${hash([code, query, published]).slice(0, 16)}`, query, country: code, publishedAt: new Date(published).toISOString(), capturedAt: now.toISOString(), approximateTraffic, trafficProvenance: 'Google-reported approximate bucket; not exact volume', news })
  })
  return { status: entries.length ? 'available' : 'unavailable', country: code, sourceUrl: `https://trends.google.com/trending/rss?geo=${code}`, capturedAt: now.toISOString(), entries, limitations: limits }
}

const stopwords = new Set('a an the and or for from with to of in on at by is are was were new latest update updates launch launches launched announce announces announced introducing introduction ai artificial intelligence model models technology today now this that how what why your you can use using'.split(' '))
const tokens = value => text(value).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(word => word.length >= 2 && !stopwords.has(word))
export function matchPublicTrendEntries(topic, entries) {
  const topicTokens = [...new Set(tokens(topic))]
  if (!topicTokens.length) return []
  return entries.flatMap(entry => {
    const queryTokens = [...new Set(tokens(entry.query))]
    const matchedTokens = topicTokens.filter(token => queryTokens.includes(token))
    const exact = topicTokens.join(' ') === queryTokens.join(' ')
    if (!exact && (topicTokens.length < 2 || matchedTokens.length < 2 || matchedTokens.length / Math.min(topicTokens.length, 6) < 0.5)) return []
    return [{ ...entry, matchedTokens, matchBasis: exact ? 'Exact normalized query/topic match; intent remains unverified.' : 'Explicit topic-token overlap; relevance and intent remain hypotheses.' }]
  }).sort((a, b) => b.matchedTokens.length - a.matchedTokens.length || b.publishedAt.localeCompare(a.publishedAt)).slice(0, 3)
}

export async function collectPublicTrendIntake({ repository, owner, profile, pack, actorUid, now = new Date(), fetchRss = fetchPublicTrendRss, assertAuthorization = async () => {} }) {
  const profileHash = costScopeHash(profile, null)
  const consent = async () => {
    await assertAuthorization()
    const current = await repository.studioGet(owner, 'account_profile', profile.id)
    if (!current?.enabled || !current.automationConsent || current.automaticPolicy?.version !== 'account-automation-v1' || current.automaticPolicy?.scope !== 'research-generation-and-social-publishing' || current.automaticPolicy?.consentedBy !== actorUid || costScopeHash(current, null) !== profileHash || await workspaceRole(repository, owner, actorUid) !== 'owner') throw Object.assign(new Error('Current account owner consent is required for public trend intake.'), { preDispatch: true })
  }
  await consent()
  const saved = await repository.studioGet(owner, 'complete_context', pack.id)
  const destination = saved?.context?.workflow?.destinations.find(item => item.platform === profile.platform && item.accountId === profile.accountId)
  if (!destination) return { status: 'not_configured', reason: 'Configure this account strategy before public trend intake.' }
  const country = normalizeTrendCountry(saved.context.country)
  const topic = text(pack.researchContext?.opportunity?.title || pack.title).slice(0, 300)
  let feed; let reason
  if (!country) reason = 'An explicit country is missing or unrecognized. No country or global trend feed was inferred.'
  else {
    const leaseId = `public-trend-rss:${country}`; const leaseOwner = randomUUID()
    if (!await repository.acquireLease(leaseId, leaseOwner, 15000)) return { status: 'busy', reason: 'This country’s official public trend feed is already being refreshed.' }
    try {
      const previous = await repository.studioGet(cacheOwner, 'public_trend_feed', country)
      if (previous?.version === publicTrendVersion && Date.parse(previous.expiresAt) > now.getTime() && Date.parse(previous.capturedAt) <= now.getTime()) feed = previous
      else {
        try {
          await consent()
          const result = await fetchRss(country)
          feed = { ...parsePublicTrendRss(result.xml, { country, now }), version: publicTrendVersion, expiresAt: new Date(now.getTime() + hour).toISOString() }
        } catch { feed = { version: publicTrendVersion, status: 'unavailable', country, sourceUrl: `https://trends.google.com/trending/rss?geo=${country}`, capturedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(), entries: [], reason: 'The official public trend feed could not be captured. No measurements were substituted.', limitations: limits } }
        await consent()
        feed = await repository.studioPut(cacheOwner, 'public_trend_feed', country, feed, previous?.revision || 0)
      }
    } finally { await repository.releaseLease(leaseId, leaseOwner) }
  }
  await consent()
  const current = await repository.studioGet(owner, 'complete_context', pack.id)
  if (current?.revision !== saved.revision) return { status: 'changed', reason: 'Account strategy changed during trend capture; no strategy records were replaced.' }
  const matches = feed?.status === 'available' ? matchPublicTrendEntries(topic, feed.entries) : []
  const status = !country || feed?.status !== 'available' ? 'unavailable' : matches.length ? 'available' : 'not_relevant'
  const record = { version: publicTrendVersion, packageId: pack.id, accountId: profile.accountId, platform: profile.platform, profileHash, contextRevision: saved.revision, topic, country, sourceUrl: feed?.sourceUrl || null, status, reason: reason || feed?.reason || (matches.length ? 'The official feed contains an explicitly matching query; relevance is an editorial hypothesis.' : 'No feed query matches this topic closely enough. Preserve an evergreen decision; do not infer that audience demand is absent.'), capturedAt: feed?.capturedAt || now.toISOString(), expiresAt: feed?.expiresAt || new Date(now.getTime() + 15 * 60000).toISOString(), matches, limitations: limits }
  const id = hash([publicTrendVersion, pack.id, profile.platform, profile.accountId, country, topic]).slice(0, 32)
  const previous = await repository.studioGet(owner, 'public_trend_intake', id)
  await consent()
  const savedRecord = await repository.studioPut(owner, 'public_trend_intake', id, record, previous?.revision || 0)
  const first = matches[0]
  const workflowPatch = first ? { trendDecision: { mode: 'use_signal', reason: `Official Google public trending RSS query “${first.query}” matches topic terms in ${country}. Traffic is an approximate bucket; intent, growth and platform performance remain unverified.`.slice(0, 1000) }, researchRecord: { id: first.id, type: 'trend', url: record.sourceUrl, observedAt: record.capturedAt, observation: `Google public trending RSS lists “${first.query}” for ${country}, published ${first.publishedAt}; approximate traffic bucket ${first.approximateTraffic || 'unavailable'}. This is one snapshot, not exact volume or measured growth.`, interpretation: 'The query may be relevant to this topic; audience intent and social-platform performance remain unknown.', response: 'Consider the sourced topic fit; recheck this signal before publishing and preserve factual citations.', confidence: 'low', hypothesis: true, questionIds: [], trend: { query: first.query, region: country, periodStart: first.publishedAt, periodEnd: record.capturedAt, recheckAt: record.expiresAt } } } : null
  return { status, intakeId: savedRecord.id, record: savedRecord, workflowPatch }
}
