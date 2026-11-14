import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletePackage, completeContextSchema, completeInputHash, decisionParameters, validateAnalysisResult } from '../studio/complete-package.js'
import { settingsSchema } from '../studio/content.js'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { createCompletePackageRouter } from '../studio/complete-package-router.js'

const evaluatedAt = new Date('2026-11-11T12:00:00.000Z')
function fixture() {
  const pack = { id: 'final-audit', revision: 1, title: 'An attributed announcement', status: 'completed', settings: settingsSchema.parse({ platform: 'Instagram', language: 'English', duration: 60 }), evidence: [{ id: 'E1', title: 'Announcement', url: 'https://example.com/news', excerpt: 'A preview was announced.', retrievedAt: evaluatedAt.toISOString() }], content: { script: 'A preview was announced [C1].', scenes: [{ timing: '0:00-1:00', visualPrompt: 'Original illustrative typography', onScreen: 'A preview', narration: 'A preview was announced [C1].' }], claims: [{ id: 'C1', text: 'A preview was announced.', evidenceId: 'E1' }], strategy: { language: 'English', platforms: [{ platform: 'Instagram', headline: 'A preview', body: 'A preview was announced [C1].', format: 'reel', thumbnail: 'Original type' }], production: { videoPrompt: 'Original typography', audioPrompt: 'Clear narration', musicDirection: 'No music', subtitleStyle: 'Readable captions', editingNotes: 'Preserve words' } } } }
  const context = completeContextSchema.parse({ brand: 'Approved editorial brand', rightsNote: 'Original assets only', platformAccounts: [{ platform: 'Instagram', accountId: 'own-instagram' }], productionTools: { graphics: 'Approved graphics tool', video: 'Approved video tool', voice: 'Approved voice tool', music: 'Approved audio tool', editor: 'Approved editor' }, metrics: Array.from({ length: 5 }, (_, index) => ({ observationId: `obs-${index}`, accountId: 'own-instagram', postId: `post-${index}`, platform: 'Instagram', format: 'reel', distribution: 'organic', publishedAt: '2026-10-31T12:00:00.000Z', measuredAt: '2026-11-01T12:00:00.000Z', source: { kind: 'manual', label: 'Dashboard copy' }, metrics: { reach: 100, shares: index + 1 } })) })
  const values = { format: 'reel', language: 'English', tone: 'Clear', duration: '60 seconds', aspectRatio: '9:16', visualStyle: 'Original typography', audioApproach: 'Clear narration', coverApproach: 'Readable title', cta: 'Read the announcement', postingSlot: 'Unavailable', successMetric: 'Reported share rate', testVariable: 'Opening wording' }
  const analysis = { summary: 'Hypotheses and reported metrics.', decisions: decisionParameters.map(parameter => ({ id: `instagram-${parameter}`, platform: 'Instagram', parameter, value: values[parameter], method: parameter === 'successMetric' ? 'analytics' : 'hypothesis', evidenceIds: [], metricIds: parameter === 'successMetric' ? context.metrics.map(item => item.observationId) : [], rationale: 'Compare reported observations without predicting results.', alternatives: [], confidence: parameter === 'successMetric' ? 'medium' : 'low', missing: parameter === 'postingSlot' ? ['No timing observations'] : [] })) }
  const profiles = [{ accountId: 'own-instagram', platform: 'Instagram', audience: 'Curious professionals' }]
  let savedAnalysis = null
  const repository = { async studioGet(_owner, kind) { if (kind === 'complete_context') return { revision: 1, context }; if (kind === 'complete_analysis') return savedAnalysis; return null }, async studioList(_owner, kind) { return kind === 'account_profile' ? profiles : [] } }
  return { pack, context, analysis, profiles, repository, save(result) { savedAnalysis = { status: 'completed', inputHash: completeInputHash(pack, context, profiles, evaluatedAt), result } } }
}

test('expired analytics support invalidates current recommendations before policy expiry', async () => {
  const value = fixture()
  const initial = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  assert.equal(initial.analytics.comparisons[0].result.status, 'available')
  value.save(validateAnalysisResult(value.analysis, value.pack, value.context, initial.analytics))
  const current = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  assert.equal(current.analysis.status, 'completed')
  const expired = await buildCompletePackage(value.repository, 'owner', value.pack, new Date('2026-12-03T12:00:00.000Z'))
  assert.equal(expired.analytics.comparisons[0].result.status, 'unavailable')
  assert.equal(expired.analysis.stale, true, 'Time-expired metric support must not remain current merely because context JSON is unchanged')
  assert.ok(expired.prompts.every(prompt => prompt.status !== 'ready'))
})

test('source-free hypotheses do not claim measured calculations', async () => {
  const value = fixture()
  for (const decision of value.analysis.decisions) { decision.method = 'hypothesis'; decision.metricIds = []; decision.confidence = 'low' }
  const checked = validateAnalysisResult(value.analysis, value.pack, value.context)
  assert.ok(checked.decisions.every(decision => !decision.calculations))
})

test('missing selected platform adaptation cannot yield ready external production prompts', async () => {
  const value = fixture()
  value.pack.content.strategy.platforms = []
  value.save(value.analysis)
  const complete = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  assert.equal(complete.platforms.find(item => item.platform === 'Instagram').status, 'unavailable')
  assert.ok(complete.prompts.every(prompt => prompt.status !== 'ready'), 'A global title or script cannot replace the missing selected platform adaptation')
})

test('a correction template without an affected asset and failed check is not ready to execute', async () => {
  const value = fixture()
  value.save(value.analysis)
  const complete = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  assert.notEqual(complete.prompts.find(prompt => prompt.kind === 'correction').status, 'ready')
})

const website = { slug: 'limited-ai-preview', seoTitle: 'A limited AI preview', metaDescription: 'An attributed announcement with its limitations.', canonicalUrl: 'https://example.com/limited-ai-preview', internalLinks: [{ label: 'Related explainers', url: 'https://example.com/explainers' }], heroAlt: 'Illustrative editorial typography, rather than a real product screenshot.', heroAspectRatio: '16:9' }

test('website planning schema rejects unsafe URLs and unsupported canvas or slug values', () => {
  assert.deepEqual(completeContextSchema.parse({ website }).website, website)
  for (const url of ['javascript:alert(1)', 'http://example.com/page', 'file:///private', 'https://user:password@example.com/page']) {
    assert.equal(completeContextSchema.safeParse({ website: { ...website, canonicalUrl: url } }).success, false, `canonical URL: ${url}`)
    assert.equal(completeContextSchema.safeParse({ website: { ...website, internalLinks: [{ label: 'Link', url }] } }).success, false, `internal link: ${url}`)
  }
  assert.equal(completeContextSchema.safeParse({ website: { ...website, heroAspectRatio: 'auto' } }).success, false)
  assert.equal(completeContextSchema.safeParse({ website: { ...website, slug: '../another-page' } }).success, false)
  assert.equal(completeContextSchema.safeParse({ website: { ...website, internalLinks: Array.from({ length: 21 }, () => ({ label: 'Link', url: 'https://example.com/page' })) } }).success, false)
  assert.equal(completeContextSchema.safeParse({ website: { ...website, apiKey: 'not-permitted' } }).success, false)
})

test('website metadata is labeled unverified and changes invalidate existing AI decisions', async () => {
  const value = fixture()
  value.pack.content.website = { title: 'Limited preview', body: 'A preview was announced [C1].' }
  value.pack.settings.outputs = ['script', 'website']
  value.context.website = { ...website }
  value.save(value.analysis)
  const complete = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  const section = complete.sections.find(item => item.id === 'website')
  assert.equal(section.value.slug, website.slug)
  assert.equal(section.value.metadata.canonicalUrl, website.canonicalUrl)
  assert.equal(section.value.metadata.provenance, 'reported_unverified')
  assert.equal(section.value.internalLinks[0].provenance, 'reported_unverified')
  assert.equal(section.value.publication.status, 'unavailable')
  assert.notEqual(section.status, 'ready', 'Supplying SEO values cannot claim a verified published website')
  value.context.website.seoTitle = 'A changed title'
  const changed = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  assert.equal(changed.analysis.stale, true)
  assert.ok(changed.prompts.every(prompt => prompt.status !== 'ready'))
})

test('website hero uses its own approved canvas and remains blocked without current analysis or applicable output', async () => {
  const value = fixture()
  value.pack.content.website = { title: 'Limited preview', body: 'A preview was announced [C1].' }
  value.pack.settings.outputs = ['script', 'website']
  value.context.website = { ...website }
  value.save(value.analysis)
  let complete = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  let hero = complete.prompts.find(prompt => prompt.kind === 'website-hero')
  assert.equal(hero.status, 'ready')
  assert.equal(hero.settings.aspectRatio, '16:9')
  assert.equal(hero.settings.duration, undefined)
  assert.match(hero.prompt, /Website hero canvas: 16:9/)
  assert.doesNotMatch(hero.prompt, /Canvas: 9:16/)
  delete value.context.website.heroAspectRatio
  value.save(value.analysis)
  complete = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  assert.notEqual(complete.prompts.find(prompt => prompt.kind === 'website-hero').status, 'ready')
  value.context.website = { ...website }; value.save(null)
  complete = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  assert.notEqual(complete.prompts.find(prompt => prompt.kind === 'website-hero').status, 'ready')
  value.pack.settings.outputs = ['script']; value.save(value.analysis)
  complete = await buildCompletePackage(value.repository, 'owner', value.pack, evaluatedAt)
  hero = complete.prompts.find(prompt => prompt.kind === 'website-hero')
  assert.equal(hero.status, 'not_applicable', 'Retained legacy article content must not override current deselected website output')
})

test('complete metadata export retains the owner source-check gate and supplied provenance', async () => {
  const { pack } = fixture(); pack.content.website = { title: 'Limited preview', body: 'A preview was announced [C1].' }; pack.settings.outputs = ['script', 'website']
  const repository = createRepository(':memory:'); repository.studioPut('alice', 'package', pack.id, pack, 0)
  repository.studioPut('alice', 'complete_context', pack.id, { context: { website } }, 0)
  let eligible = false; let checks = 0
  const app = express(); app.use(createCompletePackageRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: 'alice' }; next() }, assessDownload: async (_repository, owner, saved, options) => { checks++; assert.equal(owner, 'alice'); assert.equal(saved.id, pack.id); assert.deepEqual(options, { requireApproval: false, policy: 'owner-download' }); return { eligible } } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${server.address().port}/packages/${pack.id}/complete-package/download`
    let response = await fetch(url); assert.equal(response.status, 422)
    assert.equal(JSON.stringify(await response.json()).includes(website.canonicalUrl), false)
    eligible = true
    response = await fetch(url); assert.equal(response.status, 200)
    const exported = await response.json()
    assert.deepEqual(exported.completePackage.context.website, website)
    assert.equal(exported.completePackage.sections.find(section => section.id === 'website').value.metadata.provenance, 'reported_unverified')
    assert.equal(checks, 2)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
