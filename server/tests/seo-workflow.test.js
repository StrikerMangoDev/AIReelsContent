import test from 'node:test'
import assert from 'node:assert/strict'
import { seoWorkflowSchema, buildSeoWorkflow, seoContextHash, seoGenerationContext, auditSeoPage } from '../studio/seo-workflow.js'
import { workflowGenerationContext, workflowPrepublicationIssues } from '../studio/strategy-workflow.js'
import { completeContextSchema, completeInputHash } from '../studio/complete-package.js'
import { contentHash } from '../studio/approval.js'
import { createRepository } from '../storage/repository.js'
import { runContentJob } from '../studio/job-worker.js'
import { reserveFreeOperation } from '../budget/free-operation.js'
import { costScopeHash } from '../budget/policy.js'
import { platforms } from '../studio/content.js'

const now = new Date('2026-11-12T12:00:00Z')
const at = days => new Date(now.getTime() + days * 86400000).toISOString()
const seo = () => seoWorkflowSchema.parse({ version: 'website-seo-v1', enabled: true, siteUrl: 'https://example.com/', business: { objectives: 'Explain source-backed AI updates.', audience: 'AI learners', industry: 'AI' },
  pages: [{ id: 'article', url: 'https://example.com/article', purpose: 'Explain a limited preview.', primaryKeywordId: 'keyword', supportingKeywordIds: [], cluster: 'AI previews', pillarUrl: 'https://example.com/ai', action: 'create', rationale: 'Answer the audience question.' }],
  keywords: [{ id: 'keyword', phrase: 'AI preview', intent: 'informational', role: 'primary', provider: 'Imported research', sourceUrl: 'https://example.com/research', observedAt: at(-1), region: 'India', period: 'November snapshot' }],
  research: [{ id: 'research', url: 'https://example.com/research', kind: 'official', observation: 'The source discusses a preview.', observedAt: at(-1) }],
  outline: [{ id: 'heading', level: 1, text: 'Understand the preview', researchIds: ['research'] }] })
const pack = (platform = 'Instagram') => ({ id: 'pack', title: 'Preview', settings: { platform, outputs: ['website', 'platforms'] }, evidence: [{ id: 'E1', excerpt: 'The publisher announced a limited preview.' }], review: { issues: [] }, content: { website: { title: 'Preview', body: 'A limited preview [C1].' }, claims: [{ id: 'C1', text: 'A limited preview', evidenceId: 'E1' }] } })
const metric = (id, start, end, values = {}) => ({ id, pageUrl: 'https://example.com/article', segment: 'India · mobile · web · all queries', source: 'search_console', sourceUrl: 'https://search.google.com/search-console/performance/search-analytics', periodStart: at(start), periodEnd: at(end), observedAt: at(-1), ...values })

test('SEO page identity retains CMS query identifiers while ignoring tracking and fragments', () => {
  const value = seo()
  value.pages[0].url = 'https://example.com/?p=123'
  value.pages.push({ ...value.pages[0], id: 'another-post', url: 'https://example.com/?p=456' })
  assert.equal(seoWorkflowSchema.safeParse(value).success, true)
  value.pages[1].url = 'https://example.com/?utm_campaign=social&p=123#section'
  assert.equal(seoWorkflowSchema.safeParse(value).success, false)
  value.pages[0].url = 'https://example.com/article?language=en&id=123'
  value.pages[1].url = 'https://example.com/article?id=123&language=en'
  assert.equal(seoWorkflowSchema.safeParse(value).success, false)
})

test('legacy social-only production analysis keeps its historical input hash without SEO opt-in', () => {
  const legacy = { id: 'legacy', settings: { platform: 'Instagram', outputs: ['platforms'] }, content: null, evidence: [] }
  const expected = '6818c0a9b98dcf8185fef4c753f68698421b66087558d3925f1059593cf2d81d'
  assert.equal(completeInputHash(legacy, {}, [], now), expected)
  assert.equal(completeInputHash(legacy, {}, [], now, [], [], [{ id: 'unrelated', packageId: 'another-package', capturedAt: at(0) }]), expected)
})

test('SEO schema rejects forged proof, bad references, private URLs and ambiguous monetary metrics', () => {
  assert.equal(completeContextSchema.safeParse({}).success, true, 'Legacy packages remain valid')
  const checks = [
    value => { value.verified = true },
    value => { value.audits = [{ verified: true }] },
    value => { value.pages[0].primaryKeywordId = 'missing' },
    value => { value.pages[0].url = 'https://different.example/article' },
    value => { value.pages.push({ ...value.pages[0], id: 'duplicate-url', url: `${value.pages[0].url}?utm_campaign=1` }) },
    value => { value.keywords[0].cpc = 0.5 },
    value => { value.keywords[0].volume = -1 },
    value => { value.keywords[0].difficulty = 101 },
    value => { value.outline[0].researchIds = ['missing'] },
    value => { value.calendar = [{ id: 'task', pageId: 'article', owner: 'Desk', dueDate: '2026-02-31', status: 'planned' }] },
    value => { value.decisions = [{ id: 'decision', pageId: 'article', action: 'refresh', reason: 'An untested idea', metricIds: [], status: 'adopted' }] },
    value => { value.metrics = [metric('row', -8, -2, { clicks: 11, impressions: 10 })] },
    value => { value.metrics = [metric('row', -8, -2, { impressions: 10, segment: '' })] },
    value => { value.publication = { pageUrl: 'https://example.com/article', status: 'published_reported', indexing: 'indexed_reported' } },
  ]
  for (const change of checks) { const value = seo(); change(value); assert.equal(seoWorkflowSchema.safeParse(value).success, false, change.toString()) }
  for (const siteUrl of ['http://example.com/', 'https://user:password@example.com/', 'https://localhost/', 'https://169.254.169.254/', 'https://[::1]/', 'https://example.com:444/']) assert.equal(seoWorkflowSchema.safeParse({ ...seo(), siteUrl }).success, false, siteUrl)
  assert.equal(completeContextSchema.safeParse({ seoWorkflow: seo(), website: { canonicalUrl: 'https://different.example/article' } }).success, false)
})

test('keyword mapping detects equivalent primary phrases with equal intent, keeps unknown data unknown and uses transparent scoring', () => {
  const value = seo()
  value.keywords.push({ ...value.keywords[0], id: 'other-keyword', phrase: '  AI   PREVIEW ', difficulty: 20, volume: 0 })
  value.pages.push({ ...value.pages[0], id: 'other-page', url: 'https://example.com/other', primaryKeywordId: 'other-keyword' })
  const report = buildSeoWorkflow(pack(), { seoWorkflow: value }, now)
  assert.equal(report.conflicts.length, 1)
  assert.deepEqual(report.conflicts[0].pageUrls, ['https://example.com/article', 'https://example.com/other'])
  assert.equal(report.keywordPriority[0].score, null)
  assert.equal(report.keywordPriority[1].score, 8)
  assert.equal(value.keywords[1].volume, 0, 'Measured zero remains distinct from missing')
  value.keywords[1].observedAt = at(-100)
  assert.equal(buildSeoWorkflow(pack(), { seoWorkflow: value }, now).keywordPriority[1].score, null)
  value.keywords[1].intent = 'commercial'
  assert.deepEqual(buildSeoWorkflow(pack(), { seoWorkflow: value }, now).conflicts, [], 'Different search intent requires editorial review but is not automatically the same target')
})

test('SEO analytics compare only equal, nonoverlapping page/query/source/segment windows; missing denominators and zero baselines stay unknown', () => {
  const value = seo()
  value.metrics = [metric('before', -16, -9, { clicks: 20, impressions: 100, position: 5 }), metric('after', -9, -2, { clicks: 10, impressions: 100, position: 7 })]
  let report = buildSeoWorkflow(pack(), { seoWorkflow: value }, now)
  assert.equal(report.performance[0].ctr, 0.2)
  assert.equal(report.performance[0].conversionRate, null)
  assert.equal(report.refreshRecommendations.length, 1)
  assert.equal(report.refreshRecommendations[0].action, 'investigate')
  assert.equal(report.refreshRecommendations[0].changes.clicks.relativeChange, -0.5)
  for (const change of [row => { row.segment = 'India · desktop · web · all queries' }, row => { row.query = 'A different query' }, row => { row.source = 'reported' }, row => { row.sourceUrl = 'https://example.com/another-report' }, row => { row.periodStart = at(-8) }, row => { row.periodStart = at(-10); row.periodEnd = at(-3) }]) {
    const other = structuredClone(value); change(other.metrics[1]); assert.equal(buildSeoWorkflow(pack(), { seoWorkflow: other }, now).refreshRecommendations.length, 0, change.toString())
  }
  value.metrics[0].clicks = 0; value.metrics[0].impressions = 0
  report = buildSeoWorkflow(pack(), { seoWorkflow: value }, now)
  assert.equal(report.performance[0].ctr, null)
  assert.equal(report.refreshRecommendations[0].changes.clicks.relativeChange, null)
})

test('SEO checks are source/content-bound, cannot turn reported publication into provider proof, and never block social publishing', () => {
  const value = seo(); const saved = pack()
  value.outline.push({ id: 'bad-level', level: 3, text: 'A skipped heading', researchIds: ['research'] })
  value.checks = { contentHash: contentHash(saved), originality: 'reported_checked', intentSatisfied: true, addedValue: true, note: 'Actual recorded review scope.' }
  value.publication = { pageUrl: value.pages[0].url, status: 'published_reported', publishedAt: at(-1), receiptUrl: value.pages[0].url, indexing: 'indexed_reported', inspectedAt: at(-1), inspectionSourceUrl: 'https://search.google.com/search-console/' }
  let report = buildSeoWorkflow(saved, { seoWorkflow: value }, now)
  assert.equal(report.steps.find(item => item.id === 'outline').status, 'needs_attention')
  assert.equal(report.steps.find(item => item.id === 'quality').status, 'ready')
  assert.equal(report.steps.find(item => item.id === 'publication').status, 'pending')
  assert.equal(report.steps.find(item => item.id === 'indexing').status, 'pending')
  assert.ok(report.connections.filter(item => item.id !== 'native_website').every(item => item.status === 'not_connected'))
  assert.equal(report.connections.find(item => item.id === 'native_website').automatic, false)
  saved.content.website.body = 'Changed content [C1].'
  assert.equal(buildSeoWorkflow(saved, { seoWorkflow: value }, now).steps.find(item => item.id === 'quality').status, 'needs_attention')
  for (const platform of platforms) {
    const social = { ...saved, settings: { platform, outputs: ['platforms'] } }
    assert.equal(buildSeoWorkflow(social, { seoWorkflow: value }, now).status, 'not_applicable')
    assert.deepEqual(workflowPrepublicationIssues(social, { seoWorkflow: value }, platform, `account-${platform}`, now), [])
  }
})

test('audit bindings survive PostgreSQL JSONB key reordering but expire after metadata, content or capture age changes', () => {
  const value = seo(); const saved = pack()
  const context = { seoWorkflow: value, website: { seoTitle: 'Preview', metaDescription: 'A preview', canonicalUrl: value.pages[0].url, heroAlt: 'An illustrative model diagram' } }
  const reordered = { website: { heroAlt: context.website.heroAlt, canonicalUrl: context.website.canonicalUrl, metaDescription: context.website.metaDescription, seoTitle: context.website.seoTitle }, seoWorkflow: Object.fromEntries(Object.entries(value).reverse()) }
  assert.equal(seoContextHash(context), seoContextHash(reordered))
  const audit = { pageUrl: value.pages[0].url, finalUrl: value.pages[0].url, title: 'Preview', description: 'A preview', canonicalUrl: value.pages[0].url, capturedAt: at(0), contentHash: contentHash(saved), contextHash: seoContextHash(context), checks: [{ status: 'ready' }] }
  const step = (ctx = context, time = now, records = [audit]) => buildSeoWorkflow(saved, ctx, time, records).steps.find(item => item.id === 'onpage').status
  assert.equal(step(reordered), 'ready')
  assert.equal(step(context, new Date(at(2))), 'needs_attention')
  assert.equal(step({ ...context, website: { ...context.website, seoTitle: 'A different title' } }), 'needs_attention')
  assert.equal(step(context, now, [{ ...audit, title: 'Not the supplied title' }]), 'needs_attention')
  assert.equal(step(context, now, [{ ...audit, pageUrl: 'https://example.com/another' }]), 'needs_attention')
})

const html = '<html><head><title>Preview</title><meta name="description" content="A preview"><link rel="canonical" href="/article"><meta property="og:title" content="Preview"><meta property="og:description" content="A preview"><meta property="og:image" content="/image.png"><script type="application/ld+json">{"@type":"Article"}</script></head><body><h1>Preview</h1><h2>Details</h2><img src="/image.png" alt="An illustration"><a href="/about">About</a><a href="https://other.example/">Reference</a></body></html>'
const capture = (body = html, headers = {}) => ({ fetchPage: async () => ({ url: new URL('https://example.com/article'), body, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } }), now })

test('public HTML audit distinguishes observed syntax and metadata from search indexing, rejects non-HTML and fails closed beyond output bounds', async () => {
  let report = await auditSeoPage('https://example.com/article', capture())
  assert.equal(report.status, 'ready')
  assert.equal(report.canonicalUrl, 'https://example.com/article')
  assert.equal(report.provenance, 'server_public_html_capture')
  assert.deepEqual(report.links, { internal: 1, external: 1 })
  assert.equal(report.verified, undefined)
  report = await auditSeoPage('https://example.com/article', capture(html, { 'x-robots-tag': 'googlebot: noindex' }))
  assert.equal(report.checks.find(item => item.id === 'robots').status, 'needs_attention')
  report = await auditSeoPage('https://example.com/article', capture(html.replace('alt="An illustration"', '')))
  assert.equal(report.images.missingAlt, 1)
  report = await auditSeoPage('https://example.com/article', capture(html + '<h2>More</h2>'.repeat(100) + '<h1>Hidden second H1</h1>'))
  assert.equal(report.checks.find(item => item.id === 'h1').status, 'needs_attention')
  assert.equal(report.checks.find(item => item.id === 'capture_bounds').status, 'needs_attention')
  assert.equal(report.headings.length, 100)
  report = await auditSeoPage('https://example.com/article', capture(html + '<script type="application/ld+json">{}</script>'.repeat(20) + '<script type="application/ld+json">invalid</script>'))
  assert.equal(report.checks.find(item => item.id === 'structured_data').status, 'needs_attention')
  assert.equal(report.structuredData.length, 20)
  await assert.rejects(auditSeoPage('https://example.com/article', capture('{}', { 'content-type': 'application/json' })), /HTML/)
})

test('website planning reaches initial and regenerated jobs on every social platform without becoming factual evidence or leaking measurement receipts', async () => {
  for (const platform of platforms) for (const instruction of [undefined, 'Explain the limitations more clearly']) {
    const repository = createRepository(':memory:')
    try {
      let saved = repository.studioPut('alice', 'package', 'pack', { ...pack(platform), status: 'draft', content: null }, 0)
      const context = { seoWorkflow: seo() }
      repository.studioPut('alice', 'complete_context', saved.id, { context }, 0)
      const scope = { operation: 'generation', packageId: saved.id, revision: saved.revision, contentHash: contentHash(saved), actorUid: 'alice', ...(instruction ? { instruction } : {}) }
      const requestId = 'seo-job'
      const admission = repository.studioJobReserve('alice', requestId, costScopeHash(scope, null), 10, scope)
      await reserveFreeOperation(repository, 'alice', requestId, scope)
      repository.studioJobUpdate('alice', requestId, { status: 'reserved', ready: true }, admission.job.revision, 'reserved')
      saved = repository.studioPut('alice', 'package', saved.id, { ...saved, status: 'generating', jobId: requestId }, saved.revision)
      let seen = false
      const result = await runContentJob({ repository, uid: 'alice', requestId, prepareCompletePackage: async () => ({}), generate: async (evidence, _settings, details) => {
        seen = true
        assert.equal(details.strategyWorkflow.websiteSeo.keywords[0].intent, 'informational')
        assert.equal(details.strategyWorkflow.websiteSeo.outline[0].text, 'Understand the preview')
        assert.equal(details.strategyWorkflow.websiteSeo.metrics, undefined)
        assert.equal(details.strategyWorkflow.websiteSeo.publication, undefined)
        assert.equal(evidence[0].id, 'E1')
        assert.equal(details.revisionInstruction, instruction || null)
        return { website: { title: 'A limited preview [C1]', body: 'The publisher announced a limited preview [C1].' }, strategy: { angle: 'Explain the preview', audience: 'AI learners', whyNow: 'Answer a recurring question', factCheck: 'Preserve the limited scope', language: 'English', languageReason: 'Saved preference', voice: 'Female', voiceReason: 'Saved preference', delivery: 'Clear', keywords: ['AI preview'], platforms: [{ platform, headline: 'A limited preview [C1]', hook: 'A limited preview [C1]', body: 'The publisher announced a limited preview [C1].', alternativeHook: 'The limited preview [C1]', cta: 'Read the source', format: 'post', hashtags: [], thumbnail: 'A model diagram', retentionPlan: 'Explain one supported fact', testPlan: 'Compare like formats' }], experiments: [{ variable: 'Hook', variantA: 'Short', variantB: 'Question', metric: 'Reach', decisionRule: 'Compare after the same window' }] }, claims: [{ id: 'C1', text: 'The publisher announced a limited preview', evidenceId: 'E1', quote: 'The publisher announced a limited preview.', status: 'attributed' }] }
      } })
      assert.equal(seen, true)
      assert.equal(result.status, 'completed', `${platform}: ${result.error || ''}`)
    } finally { repository.close() }
  }
  const context = { seoWorkflow: seo() }
  assert.equal(workflowGenerationContext(context).websiteSeo.version, 'website-seo-v1')
  context.seoWorkflow.enabled = false
  assert.equal(seoGenerationContext(context), null)
})
