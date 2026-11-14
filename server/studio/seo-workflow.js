import { nativeWebsiteDestination } from './native-website.js'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { load } from 'cheerio'
import { contentHash } from './approval.js'
import { publicAddress, fetchPublicPage } from './evidence.js'
import { costScopeHash } from '../budget/policy.js'

export const seoWorkflowVersion = 'website-seo-v1'
const text = (max = 1000) => z.string().trim().min(1).max(max)
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/)
const date = z.string().datetime()
const refs = z.array(id).max(20).default([])
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const https = z.string().url().max(2000).refine(value => {
  const url = new URL(value); const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && !/(?:^|\.)(localhost|local|internal)$/.test(host) && (!isIP(host) || publicAddress(host))
}, 'Use a public HTTPS URL without credentials')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value })
const pageKey = value => {
  const url = new URL(value)
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`
}
const phraseKey = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
const sourceFields = { sourceUrl: https, observedAt: date }
const metricSchema = z.object({ id, pageUrl: https, query: text(300).optional(), segment: text(500), source: z.enum(['search_console', 'ga4', 'reported']), ...sourceFields, periodStart: date, periodEnd: date, clicks: count.optional(), impressions: count.optional(), position: z.number().min(1).max(1000).optional(), organicSessions: count.optional(), conversions: count.optional() }).strict().superRefine((value, ctx) => {
  if (!(Date.parse(value.periodStart) < Date.parse(value.periodEnd) && Date.parse(value.periodEnd) <= Date.parse(value.observedAt))) ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'Use a completed measurement period ending before observation' })
  if (value.clicks !== undefined && value.impressions !== undefined && value.clicks > value.impressions) ctx.addIssue({ code: 'custom', path: ['clicks'], message: 'Clicks cannot exceed impressions in the same search observation' })
  if (!['clicks', 'impressions', 'position', 'organicSessions', 'conversions'].some(key => value[key] !== undefined)) ctx.addIssue({ code: 'custom', message: 'Record at least one measured metric; leave unknown values blank' })
})

export const seoWorkflowSchema = z.object({
  version: z.literal(seoWorkflowVersion), enabled: z.boolean(), siteUrl: https.optional(),
  business: z.object({ objectives: text(1500), audience: text(1000), industry: text(500) }).strict().optional(),
  pages: z.array(z.object({ id, url: https, purpose: text(1000), primaryKeywordId: id.optional(), supportingKeywordIds: refs, cluster: text(200).optional(), pillarUrl: https.optional(), action: z.enum(['create', 'update', 'merge', 'keep']), rationale: text(1000) }).strict()).max(30).default([]),
  competitors: z.array(z.object({ id, url: https, kind: z.enum(['direct', 'indirect']), observation: text(1500), gap: text(1500), ...sourceFields }).strict()).max(10).default([]),
  keywords: z.array(z.object({ id, phrase: text(300), intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']), role: z.enum(['primary', 'supporting']), cluster: text(200).optional(), volume: count.optional(), difficulty: z.number().min(0).max(100).optional(), cpc: z.number().min(0).max(1000000).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), provider: text(200), ...sourceFields, region: text(200), period: text(200) }).strict()).max(30).default([]),
  research: z.array(z.object({ id, url: https, kind: z.enum(['serp', 'question', 'expert', 'official', 'community']), observation: text(1500), gap: text(1500).optional(), observedAt: date }).strict()).max(30).default([]),
  outline: z.array(z.object({ id, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: text(500), researchIds: refs }).strict()).max(30).default([]),
  calendar: z.array(z.object({ id, pageId: id, dueDate: day, owner: text(200), status: z.enum(['planned', 'writing', 'review', 'published']) }).strict()).max(30).default([]),
  checks: z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/), originality: z.enum(['not_checked', 'reported_checked']), intentSatisfied: z.boolean(), addedValue: z.boolean(), note: text(1500) }).strict().optional(),
  publication: z.object({ pageUrl: https, status: z.enum(['not_connected', 'draft', 'published_reported']), cms: text(200).optional(), publishedAt: date.optional(), receiptUrl: https.optional(), sitemapUrl: https.optional(), indexing: z.enum(['not_checked', 'requested_reported', 'indexed_reported', 'not_indexed_reported']), inspectedAt: date.optional(), inspectionSourceUrl: https.optional() }).strict().optional(),
  metrics: z.array(metricSchema).max(60).default([]),
  decisions: z.array(z.object({ id, pageId: id, action: z.enum(['refresh', 'expand', 'merge', 'keep', 'investigate']), reason: text(1500), metricIds: refs, status: z.enum(['proposed', 'adopted']) }).strict()).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message })
  for (const key of ['pages', 'competitors', 'keywords', 'research', 'outline', 'calendar', 'metrics', 'decisions']) if (new Set(value[key].map(item => item.id)).size !== value[key].length) issue([key], 'Identifiers must be unique')
  const pageIds = new Set(value.pages.map(item => item.id)); const keywordIds = new Set(value.keywords.map(item => item.id)); const researchIds = new Set(value.research.map(item => item.id)); const metrics = new Map(value.metrics.map(item => [item.id, item]))
  const sameSite = url => !value.siteUrl || new URL(url).origin === new URL(value.siteUrl).origin
  if (value.pages.some(item => !sameSite(item.url) || item.pillarUrl && !sameSite(item.pillarUrl))) issue(['pages'], 'Owned pages and pillars must belong to the selected website origin')
  if (new Set(value.pages.map(item => pageKey(item.url))).size !== value.pages.length) issue(['pages'], 'Map each website page once; tracking parameters and fragments do not create a new page')
  for (const [index, page] of value.pages.entries()) {
    if (page.primaryKeywordId && !keywordIds.has(page.primaryKeywordId) || page.supportingKeywordIds.some(key => !keywordIds.has(key))) issue(['pages', index], 'Mapped keywords must exist in this workflow')
    if (page.primaryKeywordId && page.supportingKeywordIds.includes(page.primaryKeywordId)) issue(['pages', index], 'A primary keyword cannot also be a supporting keyword for the same page')
  }
  if (value.outline.some(item => item.researchIds.some(key => !researchIds.has(key)))) issue(['outline'], 'Outline references must belong to this workflow research')
  if (value.calendar.some(item => !pageIds.has(item.pageId))) issue(['calendar'], 'Calendar entries must reference this workflow page')
  for (const [index, keyword] of value.keywords.entries()) if (keyword.cpc !== undefined && !keyword.currency) issue(['keywords', index, 'currency'], 'Record the currency for a measured CPC')
  if (value.publication) {
    const p = value.publication
    if (!sameSite(p.pageUrl) || p.sitemapUrl && !sameSite(p.sitemapUrl)) issue(['publication'], 'Publication and sitemap must belong to this website origin')
    if (!value.pages.some(page => pageKey(page.url) === pageKey(p.pageUrl))) issue(['publication', 'pageUrl'], 'Publication must reference a mapped page')
    if (p.status === 'published_reported' && (!p.publishedAt || !p.receiptUrl)) issue(['publication'], 'Reported publication needs its actual time and receipt URL')
    if (p.indexing !== 'not_checked' && (!p.inspectedAt || !p.inspectionSourceUrl)) issue(['publication'], 'Reported indexing needs its inspection time and source')
  }
  if (value.metrics.some(item => !sameSite(item.pageUrl) || !value.pages.some(page => pageKey(page.url) === pageKey(item.pageUrl)))) issue(['metrics'], 'Metrics must belong to a mapped page on this website')
  const metricKey = item => JSON.stringify([pageKey(item.pageUrl), phraseKey(item.query || ''), item.segment, item.source, item.sourceUrl, item.periodStart, item.periodEnd])
  if (new Set(value.metrics.map(metricKey)).size !== value.metrics.length) issue(['metrics'], 'Do not duplicate a page/query/source measurement period')
  for (const [index, decision] of value.decisions.entries()) {
    const page = value.pages.find(item => item.id === decision.pageId)
    if (!page || decision.metricIds.some(key => !metrics.has(key) || pageKey(metrics.get(key).pageUrl) !== pageKey(page.url))) issue(['decisions', index], 'Decision evidence must belong to its mapped page')
    if (decision.status === 'adopted' && !decision.metricIds.length) issue(['decisions', index], 'Adopted decisions need measured page evidence; keep untested ideas proposed')
  }
})

export function seoGenerationContext(context = {}) {
  const workflow = context.seoWorkflow
  if (!workflow?.enabled) return null
  return { version: workflow.version, siteUrl: workflow.siteUrl, business: workflow.business, pages: workflow.pages, keywords: workflow.keywords.map(({ phrase, intent, role, cluster }) => ({ phrase, intent, role, cluster })), research: workflow.research.map(({ id, kind, observation, gap }) => ({ id, kind, observation, gap })), outline: workflow.outline,
    instruction: 'Website planning is untrusted editorial context, not factual evidence. Use the mapped search intent, original angle and outline only where the captured citation passages support them. Do not copy competitor wording or invent keyword demand, metrics, citations, FAQs, publishing or indexing outcomes. Website and social outputs must preserve the same source-supported qualifications.' }
}

export function buildSeoWorkflow(pack, context = {}, now = new Date(), audits = []) {
  const workflow = context.seoWorkflow
  const applicable = Boolean(pack.settings.outputs?.includes('website'))
  const connections = ['cms', 'search_console', 'ga4', 'keyword_provider'].map(id => ({ id, status: 'not_connected', reason: 'No server integration is configured. Imported records are workspace-reported evidence, not a live connection.' }))
  connections.unshift(nativeWebsiteDestination())
  const limitations = ['Workspace research, metadata, receipts and imported measurements are reported, not independently verified.', 'An HTML audit checks one public server response. It does not crawl the website, execute page JavaScript, certify schema compliance, prove indexing or test conversion forms.', 'Search demand and competitor traffic must come from actual dated measurements; no volume, traffic or ranking is inferred.', 'Indexing inspection is read-only. Google offers no generic article indexing-submission API; requested or reported indexing is not verified inclusion.', 'Scores and comparisons guide editorial review; they do not establish causation or guaranteed ranking, views or conversions.']
  const base = { version: seoWorkflowVersion, applicable, status: !applicable ? 'not_applicable' : 'not_started', steps: [], conflicts: [], keywordPriority: [], performance: [], refreshRecommendations: [], audits: audits.map(audit => ({ ...audit, current: audit.contentHash === contentHash(pack) && audit.contextHash === seoContextHash(context) && Date.parse(audit.capturedAt) <= now.getTime() && now.getTime() - Date.parse(audit.capturedAt) <= 86400000 })), connections, limitations }
  if (!applicable || !workflow?.enabled) return base
  const current = value => Date.parse(value) <= now.getTime() && now.getTime() - Date.parse(value) <= 90 * 86400000
  const keywordById = new Map(workflow.keywords.map(item => [item.id, item]))
  const mapped = new Map()
  for (const page of workflow.pages) {
    const keyword = keywordById.get(page.primaryKeywordId)
    if (!keyword) continue
    const key = `${phraseKey(keyword.phrase)}:${keyword.intent}`
    mapped.set(key, [...mapped.get(key) || [], page])
  }
  base.conflicts = [...mapped.entries()].filter(([, pages]) => pages.length > 1).map(([key, pages]) => ({ phrase: keywordById.get(pages[0].primaryKeywordId).phrase, intent: key.split(':').at(-1), pageUrls: pages.map(page => page.url), reason: 'Multiple pages target the same primary phrase and intent. Review consolidation or distinguish their intent before writing.' }))
  base.keywordPriority = workflow.keywords.map(keyword => ({ keywordId: keyword.id, score: keyword.difficulty === undefined || !current(keyword.observedAt) ? null : Math.round(((100 - keyword.difficulty) / 20 + (['commercial', 'transactional'].includes(keyword.intent) ? 2 : 1) + (workflow.pages.some(page => page.primaryKeywordId === keyword.id) ? 3 : 0)) * 10) / 10, maxScore: 10, rationale: 'Editorial heuristic: (100 − reported difficulty) / 20 + intent fit (1 informational/navigational, 2 commercial/transactional) + primary-page mapping (3). Missing or stale difficulty means no score; this is not a probability.', provenance: 'reported_unverified' }))
  base.performance = workflow.metrics.map(item => ({ ...item, ctr: item.clicks !== undefined && item.impressions > 0 ? item.clicks / item.impressions : null, conversionRate: item.conversions !== undefined && item.organicSessions > 0 ? item.conversions / item.organicSessions : null, provenance: 'reported_unverified', current: current(item.observedAt) }))
  for (const row of base.performance.filter(item => item.current)) {
    const duration = Date.parse(row.periodEnd) - Date.parse(row.periodStart)
    const previous = base.performance.filter(item => item.id !== row.id && item.current && pageKey(item.pageUrl) === pageKey(row.pageUrl) && item.segment === row.segment && item.source === row.source && item.sourceUrl === row.sourceUrl && phraseKey(item.query || '') === phraseKey(row.query || '') && Date.parse(item.periodEnd) <= Date.parse(row.periodStart) && Date.parse(item.periodEnd) - Date.parse(item.periodStart) === duration).toSorted((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0]
    if (!previous) continue
    const changes = Object.fromEntries(['clicks', 'impressions', 'position', 'organicSessions', 'conversions'].filter(key => row[key] !== undefined && previous[key] !== undefined).map(key => [key, { previous: previous[key], current: row[key], absoluteChange: row[key] - previous[key], relativeChange: previous[key] > 0 ? (row[key] - previous[key]) / previous[key] : null }]))
    if (!Object.keys(changes).length) continue
    const declining = ['clicks', 'impressions', 'organicSessions', 'conversions'].some(key => changes[key]?.absoluteChange < 0) || changes.position?.absoluteChange > 0
    base.refreshRecommendations.push({ pageUrl: row.pageUrl, action: declining ? 'investigate' : 'keep', metricIds: [previous.id, row.id], changes, reason: declining ? 'Comparable reported performance declined. Investigate intent, freshness, technical changes and seasonality before editing.' : 'Comparable reported performance did not decline on the available measures. Keep monitoring; this is not proof of content impact.' })
  }
  const step = (id, title, ready, reason, future = false) => base.steps.push({ id, title, status: ready ? 'ready' : future ? 'pending' : 'needs_attention', reason })
  step('business', 'Website and industry research', Boolean(workflow.siteUrl && workflow.business && workflow.pages.length), 'Describe the business, audience, existing pages and the page opportunity.')
  step('competitors', 'Competitor gaps', workflow.competitors.length >= 5 && workflow.competitors.every(item => current(item.observedAt)), 'Record 5–10 direct or indirect competitors with dated observations and an original content gap; links alone are not traffic evidence.')
  step('keywords', 'Keyword research and intent', workflow.keywords.length > 0 && workflow.keywords.every(item => current(item.observedAt)), 'Use dated source, provider, region and period for each phrase. Blank volume, difficulty and CPC remain unknown.')
  step('mapping', 'Keyword mapping and topic clusters', Boolean(workflow.pages.length && workflow.pages.every(page => page.primaryKeywordId && page.cluster && page.pillarUrl) && !base.conflicts.length), 'Map primary/supporting terms to a page and cluster/pillar; review competing intent before creating another page.')
  step('research', 'Search results and audience questions', workflow.research.some(item => item.kind === 'serp' && current(item.observedAt)) && workflow.research.some(item => item.kind === 'question' && current(item.observedAt)), 'Record current search-result and question research. A top-ten review is reported research, not an automated Google scrape.')
  step('outline', 'Source-informed outline', workflow.outline.length > 0 && workflow.outline.filter(item => item.level === 1).length === 1 && workflow.outline[0].level === 1 && workflow.outline.every((item, index) => item.researchIds.length > 0 && (!index || item.level <= workflow.outline[index - 1].level + 1)), 'Use one H1, a logical H2/H3 structure and references to original research; page claims still require captured evidence.')
  step('calendar', 'Website content calendar', workflow.calendar.length > 0, 'Plan page work and dates. A calendar status is not a publishing receipt.')
  step('writing', 'Website and social content', Boolean(pack.content?.website && (pack.review?.issues || []).length === 0), 'Generate the selected website/social outputs from the same captured sources and preserve citations.')
  step('quality', 'Intent, originality and additional value', Boolean(workflow.checks?.contentHash === contentHash(pack) && workflow.checks.originality === 'reported_checked' && workflow.checks.intentSatisfied && workflow.checks.addedValue), 'Record checks against the exact saved content. Reported originality is not a plagiarism-service certificate.')
  const metadata = context.website
  step('onpage', 'On-page metadata and live HTML audit', Boolean(metadata?.seoTitle && metadata.metaDescription && metadata.canonicalUrl && metadata.heroAlt && base.audits.some(item => item.current && pageKey(item.pageUrl) === pageKey(metadata.canonicalUrl) && workflow.pages.some(page => pageKey(page.url) === pageKey(item.pageUrl)) && item.title === metadata.seoTitle && item.description === metadata.metaDescription && item.canonicalUrl && pageKey(item.canonicalUrl) === pageKey(metadata.canonicalUrl) && item.checks.every(check => check.status !== 'needs_attention'))), 'Save metadata and inspect its mapped canonical page. Observed title, description and canonical must match the supplied values. Schema, alt-description accuracy, mobile rendering and speed need separate validation.')
  step('publication', 'CMS publishing and sitemap', false, 'The AIReelsContent native website destination uses the administrator-only reviewed-publication route when enabled. This report has no verified publication receipt; external CMS and sitemap delivery are not connected.', true)
  step('indexing', 'Search indexing inspection', false, 'Search Console is not connected. Supplied indexing notes do not verify Google indexing or trigger submission.', true)
  step('measurement', 'Organic traffic and conversions', base.performance.some(item => item.current), 'Import completed, dated page/query windows. Search Console and GA4 are not connected; missing metrics remain unavailable.', true)
  step('updates', 'Performance review and refresh plan', base.refreshRecommendations.length > 0 || workflow.decisions.some(item => item.status === 'adopted' && item.metricIds.length && item.metricIds.every(key => base.performance.some(metric => metric.id === key && metric.current))), 'Compare matching page/query/source windows and record a review decision. No automatic CMS rewrite is sent.', true)
  base.status = base.steps.every(item => item.status === 'ready') ? 'ready' : 'needs_attention'
  return base
}

export const seoContextHash = context => costScopeHash({ seoWorkflow: context.seoWorkflow || null, website: context.website || null }, null)

export async function auditSeoPage(pageUrl, { fetchPage = fetchPublicPage, now = new Date() } = {}) {
  https.parse(pageUrl)
  const page = await fetchPage(pageUrl)
  if (!/^text\/html(?:\s*;|$)/i.test(page.headers?.['content-type'] || '')) throw new Error('A website SEO audit requires an HTML response')
  const url = page.url instanceof URL ? page.url : new URL(page.url)
  const $ = load(page.body)
  const title = $('head > title').first().text().trim().slice(0, 300)
  const description = $('meta[name="description" i]').first().attr('content')?.trim().slice(0, 500) || ''
  const canonicalValue = $('link[rel="canonical" i]').first().attr('href')
  let canonicalUrl = null
  try { const resolved = new URL(canonicalValue, url).href; if (canonicalValue && https.safeParse(resolved).success) canonicalUrl = resolved } catch { /* Invalid canonical stays unavailable. */ }
  const allHeadings = $('h1,h2,h3').toArray().map(node => ({ level: Number(node.tagName.slice(1)), text: $(node).text().trim().slice(0, 500) }))
  const headings = allHeadings.slice(0, 100)
  const noindex = /(?:^|[:,\s])(?:noindex|none)(?:$|[,\s])/i.test($('meta[name="robots" i],meta[name="googlebot" i]').toArray().map(node => $(node).attr('content')).join(' ') + ' ' + (page.headers?.['x-robots-tag'] || ''))
  const images = $('img').toArray(); const missingAlt = images.filter(node => $(node).attr('alt') === undefined).length
  const allStructuredData = $('script[type="application/ld+json"]').toArray().map(node => { try { JSON.parse($(node).text()); return { parseable: true } } catch { return { parseable: false } } })
  const structuredData = allStructuredData.slice(0, 20)
  const links = $('a[href]').toArray().slice(0, 500).flatMap(node => { try { const target = new URL($(node).attr('href'), url); return ['https:', 'http:'].includes(target.protocol) ? [{ url: target.href, internal: target.origin === url.origin }] : [] } catch { return [] } })
  const checks = []
  const check = (id, ready, reason) => checks.push({ id, status: ready ? 'ready' : 'needs_attention', reason })
  check('title', Boolean(title), 'A nonempty HTML title is required; length alone does not establish search quality.')
  check('description', Boolean(description), 'Supply a page-specific meta description.')
  check('h1', allHeadings.filter(item => item.level === 1).length === 1, 'Use one clear H1 in this response.')
  check('heading_order', !allHeadings.some((item, index) => index === 0 ? item.level !== 1 : item.level > allHeadings[index - 1].level + 1), 'Heading levels should not skip H1/H2 hierarchy.')
  check('canonical', Boolean(canonicalUrl), 'Provide a valid public HTTPS canonical URL; target equivalence and indexing are not verified.')
  check('robots', !noindex, noindex ? 'This response contains an explicit noindex/none directive.' : 'No explicit noindex directive found; robots.txt and Google indexing are not verified.')
  check('image_alt', missingAlt === 0, `${missingAlt} image(s) have no alt attribute. Empty decorative alt text is allowed; description accuracy is not checked.`)
  check('open_graph', Boolean($('meta[property="og:title"]').attr('content') && $('meta[property="og:description"]').attr('content') && $('meta[property="og:image"]').attr('content')), 'Check Open Graph title, description and image in the response.')
  check('structured_data', allStructuredData.length > 0 && allStructuredData.every(item => item.parseable), 'JSON-LD must be present and parseable. Syntax checks do not validate schema type, eligibility or claims.')
  check('capture_bounds', allHeadings.length <= 100 && allStructuredData.length <= 20, 'Large heading/schema inventories require separate review; bounded output is not a complete crawl.')
  return { pageUrl, finalUrl: url.href, capturedAt: now.toISOString(), status: checks.every(item => item.status === 'ready') ? 'ready' : 'needs_attention', title, description, canonicalUrl, headings, images: { count: images.length, missingAlt }, links: { internal: links.filter(item => item.internal).length, external: links.filter(item => !item.internal).length }, structuredData, checks, responseHash: createHash('sha256').update(page.body).digest('hex'), provenance: 'server_public_html_capture' }
}
