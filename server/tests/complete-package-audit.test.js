import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletePackage, completeContextSchema, completeInputHash, decisionParameters, validateAnalysisResult, analysisRequest } from '../studio/complete-package.js'
import { contentHash } from '../studio/approval.js'
import { settingsSchema, platforms } from '../studio/content.js'
import { calculateObservationMetrics, summarizeComparablePerformance } from '../studio/package-analytics.js'

const now = new Date('2026-11-11T12:00:00.000Z')
test('provider response schema restricts posting slots to low-confidence hypotheses without weakening other decisions', () => {
  const { pack, context } = fixture()
  const request = analysisRequest(pack, context, { observations: [], comparisons: [] })
  const [slot, other] = request.schema.properties.decisions.items.anyOf
  assert.equal(slot.properties.parameter.const, 'postingSlot')
  assert.equal(slot.properties.method.const, 'hypothesis')
  assert.equal(slot.properties.confidence.const, 'low')
  assert.deepEqual(other.properties.parameter.enum, decisionParameters.filter(parameter => parameter !== 'postingSlot'))
  assert.deepEqual(other.properties.method.enum, ['evidence', 'analytics', 'hypothesis'])
  assert.equal(slot.additionalProperties, false)
  assert.deepEqual(slot.required, other.required)
})
function fixture() {
  const pack = { id: 'complete-audit-pack', revision: 1, title: 'Source-reported preview', status: 'completed', settings: settingsSchema.parse({ platform: platforms.join(','), language: 'English', duration: 60 }), evidence: [{ id: 'E1', title: 'Publisher announcement', url: 'https://example.com/announcement', excerpt: 'The publisher announced a preview available to existing customers. Its production availability has not been established.', retrievedAt: now.toISOString(), limitations: ['Publisher-reported preview.'] }], content: { script: 'The publisher announced a preview [C1].', scenes: [{ timing: '0:00-0:15', narration: 'The publisher announced a preview [C1].', onScreen: 'Publisher-reported preview [C1]', visualPrompt: 'Illustrative product cards with no invented interface.' }], claims: [{ id: 'C1', text: 'The publisher announced a preview.', evidenceId: 'E1', quote: 'The publisher announced a preview available to existing customers.', status: 'attributed' }], captions: { reel: 'The publisher announced a preview [C1].', linkedin: 'The publisher announced a preview [C1].' }, website: { title: 'Publisher-reported preview', body: 'The publisher announced a preview [C1].' }, strategy: { language: 'English', voice: 'Female', delivery: 'Clear and factual.', platforms: platforms.map(platform => ({ platform, headline: 'Publisher-reported preview [C1]', hook: 'A source-reported preview [C1].', body: 'The publisher announced a preview [C1].', cta: 'Read the source.', hashtags: [], thumbnail: 'Readable source-attributed title.', format: platform === 'YouTube' ? 'video' : platform === 'Instagram' ? 'reel' : 'post', retentionPlan: 'One supported fact.', alternativeHook: 'A preview was announced [C1].', testPlan: 'Compare qualified openings.' })), production: { videoPrompt: 'Use illustrative product cards.', audioPrompt: 'Speak clearly without implying tested results.', musicDirection: 'No music or effects.', subtitleStyle: 'Readable captions.', editingNotes: 'Preserve all qualifications.' } } } }
  const context = completeContextSchema.parse({ objective: 'Explain the source-reported development.', brand: 'Approved cobalt and white editorial brand.', rightsNote: 'Use original typography and cleared brand assets only.', platformAccounts: platforms.map(platform => ({ platform, accountId: `account-${platform.toLowerCase()}` })), productionTools: { graphics: 'Approved graphics tool', video: 'Approved video tool', voice: 'Approved voice tool', music: 'Approved audio tool', editor: 'Approved editor' } })
  const profiles = platforms.map(platform => ({ id: `profile-${platform}`, accountId: `account-${platform.toLowerCase()}`, platform, audience: 'Curious professionals', tone: 'Clear and factual', contentPillars: ['Source-reported releases'], weeklyBrief: 'Explain supported product developments.' }))
  const values = { format: 'post', language: 'English', tone: 'Clear and factual', duration: '30 seconds', aspectRatio: '9:16', visualStyle: 'Original editorial typography', audioApproach: 'Silent captioned video, no music or audio', coverApproach: 'Use the approved qualified headline', cta: 'Read the source.', postingSlot: 'Unavailable', successMetric: 'Source-link clicks', testVariable: 'Compare opening wording' }
  const analysis = { summary: 'Production hypotheses only; no measured performance claims.', decisions: platforms.flatMap(platform => decisionParameters.map(parameter => ({ id: `${platform.toLowerCase()}-${parameter}`, platform, parameter, value: parameter === 'format' ? platform === 'YouTube' ? 'video' : platform === 'Instagram' ? 'reel' : 'post' : values[parameter] || 'Not applicable', method: 'hypothesis', evidenceIds: [], metricIds: [], rationale: 'A proposed production choice to test; not a proven performance claim.', alternatives: [], confidence: 'low', missing: parameter === 'postingSlot' ? ['No comparable timing observations.'] : [] }))) }
  return { pack, context, profiles, analysis }
}

function repositoryFor({ pack, context, analysis, profiles, assets = [], publications = [], storedHash, completed = true }) {
  return {
    async studioGet(_owner, kind, id) {
      if (id !== pack.id) return null
      if (kind === 'complete_context') return { id, revision: 1, context }
      if (kind === 'complete_analysis') return { id, status: completed ? 'completed' : 'failed', inputHash: storedHash || completeInputHash(pack, context, profiles), contentHash: contentHash(pack), result: analysis, generatedAt: now.toISOString() }
      return null
    },
    async studioList(_owner, kind) { return ({ account_profile: profiles, asset: assets, social_publication: publications, automation_plan: [] })[kind] || [] },
  }
}

test('analysis cannot elevate one unverified or stale metric reference into high-confidence reasoning', () => {
  for (const measuredAt of [now.toISOString(), '2026-09-02T12:00:00.000Z']) {
    const { pack, context, analysis } = fixture()
    context.metrics = [{ observationId: 'reported-one', accountId: 'account-instagram', postId: 'post-one', platform: 'Instagram', format: 'reel', distribution: 'organic', publishedAt: measuredAt === now.toISOString() ? '2026-11-10T12:00:00.000Z' : '2026-09-01T12:00:00.000Z', measuredAt, source: { kind: 'manual', label: 'Unverified dashboard copy' }, metrics: { reach: 100, shares: 1 } }]
    const decision = analysis.decisions.find(item => item.platform === 'Instagram' && item.parameter === 'successMetric')
    Object.assign(decision, { method: 'analytics', metricIds: ['reported-one'], confidence: 'high', value: 'Guaranteed highest sharing performance' })
    assert.throws(() => validateAnalysisResult(analysis, pack, context), /Analytics decisions require a current comparable sample/)
  }
})

test('analysis refuses metric references belonging to another destination account', () => {
  const { pack, context, analysis } = fixture()
  context.metrics = [{ observationId: 'foreign-one', accountId: 'foreign-account', postId: 'foreign-post', platform: 'Instagram' }]
  const decision = analysis.decisions.find(item => item.platform === 'Instagram')
  Object.assign(decision, { method: 'analytics', metricIds: ['foreign-one'] })
  assert.throws(() => validateAnalysisResult(analysis, pack, context), /unavailable evidence or account metrics/)
})

test('accepted analytics reasoning carries actual server calculations with bounded confidence', () => {
  const { pack, context, analysis } = fixture()
  context.metrics = Array.from({ length: 5 }, (_, index) => ({ observationId: `reported-${index}`, accountId: 'account-instagram', postId: `post-${index}`, platform: 'Instagram', format: 'reel', distribution: 'organic', publishedAt: '2026-11-10T12:00:00.000Z', measuredAt: now.toISOString(), source: { kind: 'manual', label: 'Native dashboard export' }, metrics: { reach: 100, shares: index + 1 } }))
  const analytics = { observations: context.metrics.map(item => ({ ...item, calculated: calculateObservationMetrics(item) })), comparisons: [{ accountId: 'account-instagram', platform: 'Instagram', format: 'reel', distribution: 'organic', result: summarizeComparablePerformance(context.metrics, { accountId: 'account-instagram', platform: 'Instagram', format: 'reel', distribution: 'organic', now }) }] }
  const decision = analysis.decisions.find(item => item.platform === 'Instagram' && item.parameter === 'successMetric')
  Object.assign(decision, { method: 'analytics', metricIds: context.metrics.map(item => item.observationId), confidence: 'medium', value: 'Measure reported share rate without predicting outcomes.' })
  const result = validateAnalysisResult(analysis, pack, context, analytics)
  const checked = result.decisions.find(item => item.id === decision.id)
  assert.equal(checked.calculations.length, 5)
  assert.equal(checked.calculations[0].metric, 'shareRate')
  assert.equal(checked.calculations[0].value, 1)
  assert.equal(checked.calculations[0].denominator, 100)
  assert.equal(checked.calculations[0].formula, 'shares / reach * 100')
})

test('posting slots cannot claim vendor evidence or elevated confidence on any platform', () => {
  for (const platform of platforms) for (const basis of [
    { method: 'evidence', evidenceIds: ['E1'], confidence: 'low' },
    { method: 'hypothesis', evidenceIds: [], confidence: 'medium' },
    { method: 'hypothesis', evidenceIds: [], confidence: 'high' },
  ]) {
    const { pack, context, analysis } = fixture()
    Object.assign(analysis.decisions.find(item => item.platform === platform && item.parameter === 'postingSlot'), basis, { value: '10:00 AM Asia/Calcutta', rationale: 'A test hypothesis; no comparable account timing observations.' })
    assert.throws(() => validateAnalysisResult(analysis, pack, context), /Posting slots must be low-confidence test hypotheses/, platform)
  }
  const { pack, context, analysis } = fixture()
  assert.equal(validateAnalysisResult(analysis, pack, context).decisions.filter(item => item.parameter === 'postingSlot').length, 5, 'Low-confidence unavailable test slots remain accepted')
  Object.assign(analysis.decisions.find(item => item.parameter === 'postingSlot'), { value: '10:00 AM Asia/Calcutta (test slot)', method: 'hypothesis', confidence: 'low' })
  assert.doesNotThrow(() => validateAnalysisResult(analysis, pack, context))
})

test('generic comparable account metrics are not timing-specific evidence for a posting slot', async () => {
  const value = fixture()
  value.context.metrics = Array.from({ length: 5 }, (_, index) => ({ observationId: `timing-${index}`, accountId: 'account-instagram', postId: `post-${index}`, platform: 'Instagram', format: 'reel', distribution: 'organic', publishedAt: '2026-11-10T12:00:00.000Z', measuredAt: now.toISOString(), source: { kind: 'manual', label: 'Native dashboard export' }, metrics: { reach: 100, shares: index + 1 } }))
  const complete = await buildCompletePackage(repositoryFor(value), 'audit-owner', value.pack, now)
  assert.ok(complete.analytics.comparisons.some(item => item.result.status === 'available'))
  Object.assign(value.analysis.decisions.find(item => item.platform === 'Instagram' && item.parameter === 'postingSlot'), { value: '10:00 AM Asia/Calcutta', method: 'analytics', metricIds: value.context.metrics.map(item => item.observationId), confidence: 'low' })
  assert.throws(() => validateAnalysisResult(value.analysis, value.pack, value.context, complete.analytics), /Posting slots must be low-confidence test hypotheses/)
})

test('old completed analyses with unsupported posting slots become needs review without mutating saved history or legacy hashes', async () => {
  const value = fixture()
  const before = await buildCompletePackage(repositoryFor(value), 'audit-owner', value.pack, now)
  assert.equal(before.analysis.status, 'completed')
  assert.equal(before.decisions.length, 60)
  const legacyHash = completeInputHash(value.pack, value.context, value.profiles)
  Object.assign(value.analysis.decisions.find(item => item.parameter === 'postingSlot'), { value: '10:00 AM Asia/Calcutta', method: 'evidence', evidenceIds: ['E1'], confidence: 'low', rationale: 'A test hypothesis without comparable timing evidence.' })
  const saved = structuredClone(value.analysis)
  const complete = await buildCompletePackage(repositoryFor(value), 'audit-owner', value.pack, now)
  assert.equal(complete.analysis.status, 'needs_review')
  assert.equal(complete.analysis.stale, false, 'Policy review is distinct from changed input hashes')
  assert.match(complete.analysis.error, /best publishing time/)
  assert.equal(complete.sections.find(item => item.id === 'decisions').status, 'unavailable')
  assert.deepEqual(complete.decisions, [])
  assert.ok(complete.prompts.every(item => item.status !== 'ready'))
  assert.deepEqual(value.analysis, saved, 'Stored provider decisions are not silently rewritten')
  assert.equal(completeInputHash(value.pack, value.context, value.profiles), legacyHash)
  assert.match(analysisRequest(value.pack, value.context, complete.analytics).system, /For postingSlot always use method hypothesis and confidence low/)
})

test('missing adaptations, failed quality and errored receipts never make sections ready', async () => {
  const value = fixture()
  value.pack.content.strategy.platforms = value.pack.content.strategy.platforms.filter(item => item.platform !== 'LinkedIn')
  value.pack.assurance = { status: 'failed', eligible: false, checks: [{ status: 'failed' }] }
  value.pack.review = { issues: ['A saved assertion needs correction.'] }
  const result = await buildCompletePackage(repositoryFor({ ...value, publications: [{ id: 'failed-receipt', packageId: value.pack.id, accountId: 'account-youtube', platform: 'YouTube', status: 'failed', providerState: 'ERROR', contentHash: contentHash(value.pack), releaseUrl: null }] }), 'audit-owner', value.pack, now)
  assert.notEqual(result.sections.find(item => item.id === 'platforms').status, 'ready')
  assert.notEqual(result.sections.find(item => item.id === 'quality').status, 'ready')
  assert.notEqual(result.sections.find(item => item.id === 'posting').status, 'ready')
  assert.equal(result.platforms.find(item => item.platform === 'LinkedIn').status, 'unavailable')
})

test('unresolved AI values and missing production tools cannot become ready external prompts', async () => {
  const value = fixture()
  value.context.productionTools = {}
  for (const decision of value.analysis.decisions) if (['aspectRatio', 'visualStyle', 'coverApproach'].includes(decision.parameter)) { decision.value = 'Unavailable'; decision.missing = ['No supported production setting supplied.'] }
  const result = await buildCompletePackage(repositoryFor(value), 'audit-owner', value.pack, now)
  assert.ok(result.prompts.length)
  assert.ok(result.prompts.every(card => card.status !== 'ready'))
  assert.notEqual(result.sections.find(item => item.id === 'prompts').status, 'ready')
})

test('production prompts bind selected brand, tool, sources and duration without changing saved content', async () => {
  const value = fixture(); const originalHash = contentHash(value.pack)
  const result = await buildCompletePackage(repositoryFor(value), 'audit-owner', value.pack, now)
  const video = result.prompts.find(card => card.platform === 'YouTube' && card.kind === 'video')
  assert.match(video.prompt, /Approved cobalt and white editorial brand/)
  assert.match(video.prompt, /Approved video tool/)
  assert.match(video.prompt, /30 seconds/)
  assert.ok(video.sources.some(source => source.id === 'E1' && source.url === 'https://example.com/announcement'))
  assert.equal(contentHash(value.pack), originalHash)
})

test('changing a selected account profile invalidates previously bound AI decisions', async () => {
  const value = fixture(); const storedHash = completeInputHash(value.pack, value.context, value.profiles)
  value.profiles[0].audience = 'A materially different audience'
  assert.notEqual(completeInputHash(value.pack, value.context, value.profiles), storedHash)
  const result = await buildCompletePackage(repositoryFor({ ...value, storedHash }), 'audit-owner', value.pack, now)
  assert.equal(result.analysis.stale, true)
  assert.equal(result.decisions.length, 0)
  assert.ok(result.prompts.every(card => card.status !== 'ready'))
})

test('expired policy references cannot leave external prompts labelled current and ready', async () => {
  const value = fixture()
  const result = await buildCompletePackage(repositoryFor(value), 'audit-owner', value.pack, new Date('2027-01-01T00:00:00.000Z'))
  assert.ok(result.rules.every(rule => rule.policyStatus === 'review_due'))
  assert.ok(result.analysis.stale || result.prompts.every(card => card.status !== 'ready'))
})

test('analysis request redacts account secrets and treats supplied URLs as untrusted input', () => {
  const value = fixture(); value.profiles[0].secretServerKey = 'must-never-reach-ai'
  const request = analysisRequest(value.pack, value.context, { observations: [], comparisons: [] }, value.profiles)
  assert.equal(JSON.stringify(request).includes('must-never-reach-ai'), false)
  assert.match(request.system, /untrusted data/)
  assert.match(request.system, /Do not publish, fetch URLs/)
  assert.equal(completeContextSchema.safeParse({ marketObservations: [{ id: 'bad-link', url: 'javascript:alert(1)', observedAt: now.toISOString(), summary: 'Not a permitted source URL.' }] }).success, false)
})
