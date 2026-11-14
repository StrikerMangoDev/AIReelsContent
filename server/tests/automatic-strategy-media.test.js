import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { settingsSchema, platforms } from '../studio/content.js'
import { contentHash } from '../studio/approval.js'
import { reviewAutomaticText } from '../automation/review.js'
import { ratingsFixture } from './fixtures/finalization.js'
import { renderLocalMedia } from '../media/render.js'
import { inspectMediaBytes } from '../media/acceptance.js'
import { assessAutomaticStrategyMedia, recordAutomaticStrategyMedia } from '../automation/strategy-media.js'
import { currentAutomaticStrategyMedia } from '../media/strategy-evidence.js'
import { strategyWorkflowSchema, workflowPrepublicationIssues, buildStrategyWorkflow } from '../studio/strategy-workflow.js'
import { createPublishingService, approvedCaption } from '../publishing/router.js'
import { assessAutomationRelease } from '../automation/services.js'

async function fixture(platform) {
  const repository = createRepository(':memory:')
  const now = Date.now(); const at = new Date(now).toISOString(); const accountId = `machine-${platform}`
  const profile = repository.studioPut('owner', 'account_profile', createHash('sha256').update(accountId).digest('hex').slice(0, 32), { accountId, platform, weeklyBrief: 'Explain source-backed AI capabilities with clear limitations.', audience: 'AI learners', tone: 'Clear', contentPillars: ['AI'], maxDailyPosts: 2, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', consentedBy: 'owner', consentedAt: at, scope: 'research-generation-and-social-publishing', paidBudgetMicros: 0 } }, 0)
  const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted and the announcement does not establish broad deployment.'
  const body = 'The publisher announced a limited developer preview [C1].'
  let pack = repository.studioPut('owner', 'package', `pack-${platform}`, { title: 'AI developer preview', createdBy: 'owner', status: 'completed', review: { issues: [] }, settings: settingsSchema.parse({ industry: 'AI', audience: 'AI learners', tone: 'Clear', platform, outputs: ['website', 'platforms'] }), evidence: [{ id: 'E1', url: 'https://example.com/announcement', publisher: 'Example publisher', hash: createHash('sha256').update(excerpt).digest('hex'), excerpt, retrievedAt: at }], content: { website: { title: 'AI developer preview', body }, claims: [{ id: 'C1', text: 'The publisher announced a limited developer preview', quote: excerpt, evidenceId: 'E1', status: 'attributed' }], strategy: { angle: 'Explain the preview and its limits', audience: 'AI learners', whyNow: 'An evergreen explanation', factCheck: 'Preserve source scope', language: 'English', languageReason: 'Account preference', voice: 'Female', voiceReason: 'Editorial choice', delivery: 'Clear', keywords: ['developer preview'], experiments: [{ variable: 'Opening', variantA: 'Preview first', variantB: 'Limitations first', metric: 'Reach', decisionRule: 'Compare same-window observations' }], platforms: [{ platform, headline: body, hook: body, alternativeHook: body, body, cta: 'Read the source', hashtags: [], thumbnail: 'Original text layout', format: ['YouTube', 'Instagram'].includes(platform) ? 'video' : 'post', retentionPlan: 'State the limited scope', testPlan: 'Observe same-window results' }] } } }, 0)
  const review = await reviewAutomaticText(pack, profile, { generate: async () => ({ claims: [{ id: 'C1', verdict: 'supported', evidenceIds: ['E1'], supportQuote: excerpt, reason: 'The selected publisher quotation supports the exact attributed limited-preview claim.' }], ratings: ratingsFixture(), checks: { semanticSupport: true, contradictionsResolved: true, scopePreserved: true, promisesAligned: true, privacySafe: true, audienceClaimsSupported: true, provenanceClear: true }, issues: [], summary: 'Controlled separate evaluator fixture preserves the publisher scope and source qualifications.' }) })
  assert.equal(review.status, 'passed', JSON.stringify(review))
  pack = repository.studioPut('owner', 'package', pack.id, { ...pack, automaticReview: review }, pack.revision)
  const kind = ['YouTube', 'Instagram'].includes(platform) ? 'video' : 'image'
  const result = await renderLocalMedia(kind, pack, { durationSeconds: 8 })
  const asset = repository.studioPut('owner', 'asset', `asset-${platform}`, { id: `asset-${platform}`, kind, status: 'completed', packageId: pack.id, packageContentHash: contentHash(pack), createdBy: 'owner', mime: result.mime, bytes: result.bytes.length, sha256: result.technicalReport.sha256, technicalReport: result.technicalReport, provenance: result.provenance, captions: result.captions }, 0)
  const inspection = inspectMediaBytes(asset, result.bytes)
  const destination = strategyWorkflowSchema.parse({ version: 'strategy-workflow-v1', destinations: [{ platform, accountId, goal: { primary: 'reach', kpi: 'reach', targetAction: 'Read the scoped preview', reviewAfterHours: 48 }, audienceQuestions: [{ id: 'question', question: 'Who can use the preview?', source: 'community', sourceUrl: 'https://news.ycombinator.com/item?id=1', occurrences: 1, audience: 'Public discussion participant; not an account-follower sample', observedAt: at, anonymized: true }], researchLog: [{ id: 'fact', type: 'fact', url: 'https://example.com/announcement', observedAt: at, observation: 'A limited preview was announced.', interpretation: 'Its limits may be useful to explain.', response: 'Use qualified attribution.', confidence: 'medium', hypothesis: false, questionIds: [] }, { id: 'public-question', type: 'audience', url: 'https://news.ycombinator.com/item?id=1', observedAt: at, observation: 'One public participant asked about preview access.', interpretation: 'A possible audience-need hypothesis only.', response: 'Test an availability explanation.', confidence: 'low', hypothesis: true, questionIds: ['question'] }], trendDecision: { mode: 'not_relevant', reason: 'Evergreen explanation; no measured trend is claimed.' }, candidates: [{ id: 'candidate', topic: 'AI developer preview', angle: 'Explain scope', rationale: 'A public question suggests a useful test, not proven demand.', researchIds: ['fact', 'public-question'], questionIds: ['question'], selected: true, scores: { topicFit: 4, audienceUsefulness: 3, brandFit: 4, evidence: 4, timing: 3, effort: 1, risk: 1 } }], keywords: [{ phrase: 'developer preview', placements: ['caption'], rationale: 'Accurately describes this captured topic.', researchIds: ['fact'] }], expertReview: { required: false, status: 'not_required' }, community: { owner: 'owner', responseGuidance: 'Use cited public resources.', escalationOwner: 'owner', escalationRules: 'Escalate sensitive or personalized professional questions.', cases: [] } }] }).destinations[0]
  const context = { brand: 'Approved editorial desk identity', accountId, platformAccounts: [{ platform, accountId }], workflow: { version: 'strategy-workflow-v1', destinations: [destination] } }
  repository.studioPut('owner', 'complete_context', pack.id, { packageId: pack.id, context }, 0)
  return { repository, profile, pack, asset, inspection, bytes: result.bytes, context, destination }
}

test('actual local media provides a separately labelled machine path through all five shared publishing gates without forged human attestations', { timeout: 120000 }, async () => {
  for (const platform of platforms) {
    const h = await fixture(platform)
    try {
      const evidence = await recordAutomaticStrategyMedia(h.repository, 'owner', h.pack, h.profile, [h.asset], [h.inspection])
      assert.equal(evidence.eligible, true, `${platform}: ${evidence.issues.join('; ')}`)
      const machine = [{ record: evidence, profile: h.profile, assets: [h.asset] }]
      assert.deepEqual(workflowPrepublicationIssues(h.pack, h.context, platform, h.profile.accountId, new Date(), machine), [])
      assert.ok(workflowPrepublicationIssues(h.pack, h.context, platform, h.profile.accountId).length, 'manual workflow never borrows a machine alternative implicitly')
      const report = buildStrategyWorkflow(h.pack, h.context, new Date(), [], machine).destinations[0]
      assert.match(report.steps.find(step => step.id === 'creative').detail, /Actual phone playback.*not performed/)
      assert.equal(h.destination.checklist, undefined); assert.equal(h.context.attestations, undefined)
      let uploads = 0; let creates = 0
      const service = createPublishingService({ repository: h.repository, readFile: async () => h.bytes, config: () => ({ enabled: true, accounts: [{ ownerScope: 'owner', accountId: h.profile.accountId, platform, provider: ({ X: 'x', Instagram: 'instagram-standalone', YouTube: 'youtube', Facebook: 'facebook', LinkedIn: 'linkedin' })[platform], ...(platform === 'YouTube' ? { settings: { type: 'public', selfDeclaredMadeForKids: 'no' } } : {}) }] }), assessReady: args => assessAutomationRelease({ ...args, readFile: async () => h.bytes }), provider: { upload: async () => { uploads++; return { id: 'controlled-upload', path: 'https://uploads.postiz.com/controlled-file' } }, create: async () => { creates++; return { postId: 'controlled-post', integration: h.profile.accountId } } } })
      const input = { requestId: randomUUID(), revision: h.pack.revision, accountId: h.profile.accountId, platform, mode: 'now', caption: approvedCaption(h.pack, platform), assetIds: [h.asset.id], automatic: true, confirmed: true }
      assert.equal((await service.publish({ owner: 'owner', actorUid: 'owner', packageId: h.pack.id, input })).status, 201)
      assert.equal(uploads, 1); assert.equal(creates, 1)
      assert.equal((await service.publish({ owner: 'owner', actorUid: 'owner', packageId: h.pack.id, input })).status, 200)
      assert.equal(creates, 1)
    } finally { h.repository.close() }
  }
})

test('machine evidence fails closed after byte, render-report, model-review, account, source, content or expiry changes and cannot replace required expertise', { timeout: 120000 }, async () => {
  const h = await fixture('LinkedIn')
  try {
    const record = assessAutomaticStrategyMedia(h.pack, h.profile, [h.asset], [h.inspection])
    assert.ok(currentAutomaticStrategyMedia(record, h.pack, h.profile, [h.asset]))
    const jsonbRecord = { ...record, assets: record.assets.map(asset => Object.fromEntries(Object.entries(asset).reverse())) }
    assert.ok(currentAutomaticStrategyMedia(jsonbRecord, h.pack, h.profile, [h.asset]), 'JSONB object key order preserves the same bound asset values')
    const changedJsonbRecord = { ...jsonbRecord, assets: jsonbRecord.assets.map(asset => ({ ...asset, bytes: asset.bytes + 1 })) }
    assert.equal(currentAutomaticStrategyMedia(changedJsonbRecord, h.pack, h.profile, [h.asset]), null, 'Changed values still invalidate evidence')
    for (const [name, pack, profile, asset, now] of [
      ['content', { ...h.pack, content: { ...h.pack.content, website: { ...h.pack.content.website, title: 'Changed content' } } }, h.profile, h.asset],
      ['account', h.pack, { ...h.profile, tone: 'Changed voice' }, h.asset],
      ['review', { ...h.pack, automaticReview: { ...h.pack.automaticReview, status: 'needs_revision' } }, h.profile, h.asset],
      ['bytes', h.pack, h.profile, { ...h.asset, sha256: '0'.repeat(64) }],
      ['report', h.pack, h.profile, { ...h.asset, technicalReport: { ...h.asset.technicalReport, layoutVerification: null } }],
      ['source', { ...h.pack, evidence: h.pack.evidence.map(source => ({ ...source, retrievedAt: '2000-01-01T00:00:00Z' })) }, h.profile, h.asset],
      ['expiry', h.pack, h.profile, h.asset, Date.now() + 86400001],
    ]) assert.equal(currentAutomaticStrategyMedia(record, pack, profile, [asset], { now: now || Date.now() }), null, name)
    const changed = Buffer.from(h.bytes); changed[20] ^= 1
    assert.equal(assessAutomaticStrategyMedia(h.pack, h.profile, [h.asset], [inspectMediaBytes(h.asset, changed)]).eligible, false)
    h.destination.expertReview = { required: true, status: 'pending' }
    assert.ok(workflowPrepublicationIssues(h.pack, h.context, 'LinkedIn', h.profile.accountId, new Date(), [{ record, profile: h.profile, assets: [h.asset] }]).some(issue => issue.includes('review')))
    assert.equal(strategyWorkflowSchema.safeParse({ version: 'strategy-workflow-v1', destinations: [{ ...h.destination, machineAssessment: record }] }).success, false, 'Clients cannot submit trusted machine evidence as editable workflow context')
  } finally { h.repository.close() }
})
