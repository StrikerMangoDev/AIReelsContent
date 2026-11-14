import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { costScopeHash } from '../budget/policy.js'
import { demoOwner, demoBudgetOwner, demoSourceCampaignHash, demoSerialLeaseId, demoStageRequestId, assertDemoSourceContinuation, createDemoGenerator } from '../automation/demo.js'
import { freeCampaignRunId } from '../automation/campaign.js'
import { runAccountAutomation } from '../automation/runner.js'
import { createAutomationServices, assessAutomationRelease } from '../automation/services.js'
import { createPublishingService } from '../publishing/router.js'
import { settingsSchema, platforms } from '../studio/content.js'
import { contentHash } from '../studio/approval.js'
import { workflowDestinationSchema } from '../studio/strategy-workflow.js'
import { renderLocalMedia } from '../media/render.js'
import { ratingsFixture } from './fixtures/finalization.js'
import { vertexWifAudience, vertexWifServiceAccount } from '../providers/vertex-fallback.js'

const id = value => createHash('sha256').update(value).digest('hex').slice(0, 32)
const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted and independent deployment results have not been established.'
function content(platform) {
  const body = 'The publisher announced a limited developer preview [C1].'
  return { website: { title: 'AI developer preview', body }, claims: [{ id: 'C1', text: 'The publisher announced a limited developer preview', evidenceId: 'E1', quote: excerpt, status: 'attributed' }], strategy: { angle: 'Explain the limited preview', audience: 'AI learners', whyNow: 'Explain the publisher material', factCheck: 'Keep source qualifications', language: 'English', languageReason: 'Account preference', voice: 'Female', voiceReason: 'Editorial choice', delivery: 'Clear', keywords: ['developer preview'], platforms: [{ platform, headline: body, hook: body, body, alternativeHook: body, cta: 'Read the source', hashtags: [], thumbnail: 'Original text layout', format: ['Instagram', 'YouTube'].includes(platform) ? 'video' : 'post', retentionPlan: 'Explain scope', testPlan: 'Observe matching windows' }], experiments: [{ variable: 'Opening', variantA: 'Preview first', variantB: 'Limits first', metric: 'Reach', decisionRule: 'Compare similar posts' }] } }
}
function workflow(platform, accountId, at) {
  return { brand: 'Approved editorial desk', platformAccounts: [{ platform, accountId }], workflow: { version: 'strategy-workflow-v1', destinations: [workflowDestinationSchema.parse({ platform, accountId, goal: { primary: 'reach', kpi: 'reach', targetAction: 'Read the limited preview', reviewAfterHours: 48 }, audienceQuestions: [{ id: 'q', question: 'What does this preview make available?', source: 'editorial-hypothesis', sourceUrl: 'https://example.com/preview', occurrences: 0, audience: 'AI learners; demand unmeasured', observedAt: at, hypothesis: true, basisNote: 'Source-backed editorial test only; no real audience question or measured demand was observed.', anonymized: true }], researchLog: [{ id: 'fact', type: 'fact', url: 'https://example.com/preview', observedAt: at, observation: 'The publisher announced a limited preview.', interpretation: 'A qualified explanation may be useful.', response: 'Preserve qualifications.', confidence: 'medium', hypothesis: false, questionIds: [] }, { id: 'question', type: 'audience', url: 'https://example.com/preview', observedAt: at, observation: 'An editorial explanatory question was inferred, not observed.', interpretation: 'Audience fit is untested.', response: 'Test the explanation.', confidence: 'low', hypothesis: true, questionIds: ['q'] }], candidates: [{ id: 'idea', topic: 'AI developer preview', angle: 'Explain limitations', rationale: 'Controlled editorial test fixture, not measured demand.', researchIds: ['fact', 'question'], questionIds: ['q'], selected: true, scores: { topicFit: 3, audienceUsefulness: 3, brandFit: 3, evidence: 4, timing: 3, effort: 1, risk: 1 } }], trendDecision: { mode: 'not_relevant', reason: 'Evergreen explanation; no trend measurement claimed.' }, keywords: [{ phrase: 'developer preview', placements: ['caption'], rationale: 'Accurately describes the topic.', researchIds: ['fact'] }], community: { owner: demoOwner, responseGuidance: 'Use public cited resources.', escalationOwner: demoOwner, escalationRules: 'Escalate sensitive or personalized requests.', cases: [] }, expertReview: { required: false, status: 'not_required' } })] } }
}
function fixture({ unknownCode = 429 } = {}) {
  const repository = createRepository(':memory:'); const owner = demoOwner; const at = new Date(); const demoId = 'controlled-paid-continuation'
  const profiles = []; const sourceRuns = []; const bindings = []
  const sourceCampaign = { id: 'revoked-free-source', version: 'free-one-off-campaign-v1', status: 'active', actorUid: owner, createdAt: new Date(+at - 60000).toISOString(), expiresAt: new Date(+at + 3600000).toISOString(), referenceUrl: 'https://example.com/preview', topic: 'AI developer preview', accountIds: [], profileBindings: [], freeOnly: true, paidBudgetMicros: 0, maxRuns: 5 }
  for (const platform of platforms) {
    const accountId = `continuation-${platform}`
    const profile = repository.studioPut(owner, 'account_profile', id(accountId), { accountId, platform, enabled: true, automationConsent: true, audience: 'AI learners', tone: 'Clear', contentPillars: ['AI'], weeklyBrief: 'Explain source-supported AI previews and their limits.', timezone: 'UTC', weeklyCadence: 0, dailyNews: false, maxDailyPosts: 2, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: owner, consentedAt: new Date(+at - 60000).toISOString(), paidBudgetMicros: 0 } }, 0)
    profiles.push(profile); sourceCampaign.accountIds.push(accountId); sourceCampaign.profileBindings.push({ profileId: profile.id, accountId, profileHash: costScopeHash(profile, null) })
  }
  const activeSource = repository.studioPut(owner, 'automation_campaign', sourceCampaign.id, sourceCampaign, 0)
  const originalHash = demoSourceCampaignHash(activeSource)
  for (const profile of profiles) {
    const originalRunId = freeCampaignRunId(owner, sourceCampaign.id, profile.accountId)
    const original = repository.studioPut(owner, 'package', id(`source-${profile.platform}`), { title: 'AI developer preview', status: 'completed', createdBy: owner, settings: settingsSchema.parse({ platform: profile.platform, outputs: ['website'] }), evidence: [{ id: 'E1', url: 'https://example.com/preview', hash: createHash('sha256').update(excerpt).digest('hex'), excerpt, retrievedAt: at.toISOString() }], content: { website: { title: 'Saved source draft', body: 'The publisher announced a limited developer preview [C1].' }, claims: content(profile.platform).claims }, review: { issues: [] } }, 0)
    const unknown = profile.platform === 'Instagram'; const jobId = id(`source-job-${profile.platform}`)
    if (unknown) { const admitted = repository.studioJobReserve(owner, jobId, 'a'.repeat(64), 20, { operation: 'generation', generationProvider: 'free', packageId: original.id }); const running = repository.studioJobUpdate(owner, jobId, { status: 'running' }, admitted.job.revision, 'reserved'); repository.studioJobUpdate(owner, jobId, { status: 'dispatch_unknown', result: null, error: `Provider outcome needs reconciliation. Diagnostics: {"code":"MODEL_HTTP_ERROR","name":"Error","httpStatus":${unknownCode}}` }, running.revision, 'running') }
    const source = repository.studioPut(owner, 'automation_run', originalRunId, { campaignId: sourceCampaign.id, campaignHash: originalHash, campaignReferenceUrl: sourceCampaign.referenceUrl, campaignTopic: sourceCampaign.topic, profileHash: costScopeHash(profile, null), accountId: profile.accountId, platform: profile.platform, actorUid: owner, paidBudgetMicros: 0, packageId: original.id, stage: unknown ? 'generate' : 'review', status: unknown ? 'dispatch_unknown' : 'blocked', jobId: unknown ? jobId : null, stages: unknown ? [{ stage: 'generate', requestId: jobId, jobId, status: 'dispatch_unknown' }] : [] }, 0)
    sourceRuns.push(source)
    const runId = id(`new-paid-${profile.platform}`); const packageId = id(`new-paid-package-${profile.platform}`)
    const clone = repository.studioPut(owner, 'package', packageId, { ...original, id: packageId, automaticReview: null, independentReview: null, approval: null, mediaApproval: null, mediaReview: null }, 0)
    repository.studioPut(owner, 'complete_context', clone.id, { packageId: clone.id, context: workflow(profile.platform, profile.accountId, at.toISOString()) }, 0)
    const binding = { runId, accountId: profile.accountId, profileId: profile.id, profileHash: costScopeHash(profile, null), packageId: clone.id, sourceContentHash: contentHash(clone) }
    bindings.push(binding)
    repository.studioPut(owner, 'automation_run', runId, { packageId, platform: profile.platform, accountId: profile.accountId, actorUid: owner, profileHash: binding.profileHash, demoAuthorizationId: demoId, demoSourceContentHash: binding.sourceContentHash, contentHash: binding.sourceContentHash, localDate: at.toISOString().slice(0, 10), slot: { kind: 'evergreen-demo', index: 0 }, stage: 'generate', status: 'pending', paidBudgetMicros: 0, freeOnly: false, stages: [] }, 0)
  }
  const savedSource = repository.studioPut(owner, 'automation_campaign', sourceCampaign.id, { ...activeSource, status: 'revoked' }, activeSource.revision)
  const authorization = repository.studioPut(owner, 'automation_demo', demoId, { version: 'five-account-paid-demo-v1', status: 'active', owner, actorUid: owner, currency: 'USD', totalLimitMicros: 5000000, projectId: 'cs-project-bvfzp2zn', provider: 'vertex', model: 'gemini-3.8-flash', authorizedAt: new Date().toISOString(), expiresAt: new Date(+at + 3600000).toISOString(), allowedStages: ['generate', 'review'], runs: bindings, sourceCampaignContinuation: { sourceCampaignId: savedSource.id, sourceCampaignHash: demoSourceCampaignHash(savedSource), sourceRunIds: sourceRuns.map(run => run.id) } }, 0)
  repository.budgetConfigure('USD', 'historical-paid', 5000000, 5000000)
  for (const [requestId, amount, settled] of [['old-unknown-one', 1277952, false], ['old-unknown-two', 1405748, false], ['old-spent', 173881, true]]) { const reservation = repository.budgetReserve('historical-paid', requestId, 'a'.repeat(64), { currency: 'USD', upperBoundMicros: amount, priceVersion: 'controlled-historical', priceExpiresAt: new Date(+at + 3600000).toISOString(), kind: 'generation' }); const dispatched = repository.budgetTransition('historical-paid', requestId, reservation.reservation.revision, 'dispatch'); repository.budgetTransition('historical-paid', requestId, dispatched.revision, settled ? 'settle' : 'unknown', settled ? amount : undefined) }
  repository.budgetConfigure('USD', demoBudgetOwner(owner, demoId), 5000000, 5000000)
  return { repository, owner, profiles, sourceRuns, authorization, demoId, at, bindings }
}

test('fresh paid clones run generation, separate review, actual local media and bounded HTTPS receipt readback on all five platforms without rewriting free history or holds', { timeout: 120000 }, async () => {
  const h = fixture(); const files = new Map(); const posts = []; let calls = 0
  const original = h.sourceRuns.map(run => JSON.stringify(h.repository.studioGet(h.owner, 'automation_run', run.id)))
  const config = { CONTENT_VERTEX_FALLBACK: 'false', VERTEX_WIF_AUDIENCE: vertexWifAudience, VERTEX_WIF_SERVICE_ACCOUNT: vertexWifServiceAccount }
  const provider = { upload: async (_bytes, asset) => ({ id: asset.id, path: `https://uploads.postiz.com/${asset.id}` }), create: async input => { const value = input.posts[0]; const postId = `post-${posts.length}`; const platform = h.profiles.find(profile => profile.accountId === value.integration.id)?.platform; const nativeBase = { Facebook: 'https://www.facebook.com/posts/', Instagram: 'https://www.instagram.com/reel/', X: 'https://x.com/fixture/status/', LinkedIn: 'https://www.linkedin.com/feed/update/', YouTube: 'https://www.youtube.com/watch?v=' }[platform]; posts.push({ id: postId, content: value.value[0].content, state: 'PUBLISHED', releaseURL: `${nativeBase}${postId}`, integration: value.integration }); return { postId, integration: value.integration.id } }, list: async () => posts }
  const publisher = createPublishingService({ repository: h.repository, provider, readFile: async assetId => files.get(assetId), config: () => ({ enabled: true, accounts: h.profiles.map(profile => ({ ownerScope: h.owner, accountId: profile.accountId, platform: profile.platform, provider: ({ Facebook: 'facebook', Instagram: 'instagram-standalone', X: 'x', LinkedIn: 'linkedin', YouTube: 'youtube' })[profile.platform], ...(profile.platform === 'YouTube' ? { settings: { type: 'public', selfDeclaredMadeForKids: 'no' } } : {}) })) }), assessReady: context => assessAutomationRelease({ ...context, readFile: async assetId => files.get(assetId) }) })
  const services = createAutomationServices(h.repository, { publisher, render: (kind, pack) => renderLocalMedia(kind, pack, { durationSeconds: 8 }), saveFile: async (assetId, bytes) => files.set(assetId, bytes), readFile: async assetId => files.get(assetId), write: async (_evidence, settings, details, generate) => { assert.equal(details.strategyWorkflow.destinations[0].goal.kpi, 'reach'); return generate({ input: { platform: settings.platform }, schema: {}, system: 'Controlled paid writing fixture', maxTokens: 500 }) }, demoGenerate: (context, options) => createDemoGenerator(context, { ...options, config, request: async input => { calls++; const result = context.phase === 'generate' ? content(input.input.platform) : { claims: [{ id: 'C1', verdict: 'supported', evidenceIds: ['E1'], supportQuote: excerpt, reason: 'The captured publisher passage supports this attributed limited-preview claim.' }], ratings: ratingsFixture(), checks: { semanticSupport: true, contradictionsResolved: true, scopePreserved: true, promisesAligned: true, privacySafe: true, audienceClaimsSupported: true, provenanceClear: true }, issues: [], summary: 'Controlled separate evaluator fixture preserves source scope and attribution.' }; return { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 0 }, candidates: [{ finishReason: 'STOP' }], text: JSON.stringify(result) } } }) })
  try {
    const originalPublish = services.publish
    let blockedPublication
    services.publish = async context => {
      if (!blockedPublication && context.profile.platform === 'Facebook') {
        blockedPublication = context.requestId
        throw Object.assign(new Error('Controlled local workflow rejection before any external operation.'), { preDispatch: true, publicMessage: 'Controlled local workflow gate requires a fresh check.' })
      }
      if (context.profile.platform === 'Facebook') assert.equal(context.requestId, blockedPublication, 'Recovery retains the exact stable publication request')
      return originalPublish(context)
    }
    const savedSource = h.repository.studioGet(h.owner, 'automation_campaign', h.authorization.sourceCampaignContinuation.sourceCampaignId)
    assert.equal(demoSourceCampaignHash(savedSource), h.authorization.sourceCampaignContinuation.sourceCampaignHash, 'Exact revoked source hash')
    assert.equal(savedSource.status, 'revoked'); assert.equal(savedSource.actorUid, h.authorization.actorUid)
    assert.equal(Date.parse(savedSource.createdAt) <= Date.parse(h.authorization.authorizedAt), true)
    assert.deepEqual([...savedSource.accountIds].sort(), h.authorization.runs.map(run => run.accountId).sort())
    await assertDemoSourceContinuation(h.repository, h.owner, h.authorization)
    for (const profile of h.profiles) {
      let output
      for (let stage = 0; stage < 4; stage++) { output = await runAccountAutomation({ repository: h.repository, owner: h.owner, profile, services }); assert.equal(output.results[0].status, stage === 3 ? profile.platform === 'Facebook' ? 'blocked' : 'awaiting_receipt' : 'pending', `${profile.platform} ${stage}: ${JSON.stringify(output)} job: ${JSON.stringify(h.repository.studioJobGet(h.owner, output.results[0].stages?.at(-1)?.jobId))}`) }
      if (profile.platform === 'Facebook') {
        assert.equal(output.results[0].stageFailure.preDispatch, true)
        output = await runAccountAutomation({ repository: h.repository, owner: h.owner, profile, services })
        assert.equal(output.results[0].status, 'awaiting_receipt', JSON.stringify(output))
        const recovery = h.repository.studioGet(h.owner, 'automation_recovery', output.results[0].preDispatchRecovery.recoveryId)
        assert.equal(recovery.previousRun.status, 'blocked')
        assert.equal(recovery.previousRun.stage, 'publish')
        assert.equal(recovery.requestId, blockedPublication)
      }
      assert.ok(output.deferred, 'Submitted post starts bounded readback')
      output = await runAccountAutomation({ repository: h.repository, owner: h.owner, profile, services, now: new Date(Date.now() + 10001) })
      assert.equal(output.results[0].status, 'completed', JSON.stringify(output)); assert.match(output.results[0].releaseUrl, /^https:/)
    }
    assert.equal(calls, 10); assert.equal(posts.length, 5)
    assert.deepEqual(h.sourceRuns.map(run => JSON.stringify(h.repository.studioGet(h.owner, 'automation_run', run.id))), original)
    assert.equal(h.repository.budgetSummary('historical-paid').heldMicros, 2683700)
    assert.equal(h.repository.budgetSummary('historical-paid').settledMicros, 173881)
    assert.equal(h.repository.budgetSummary(demoBudgetOwner(h.owner, h.demoId)).heldMicros, 0)
    assert.equal(h.repository.budgetSummary(demoBudgetOwner(h.owner, h.demoId)).settledMicros, 4500)
  } finally { h.repository.close() }
})

test('source mutation, unrelated active campaigns, inherited packages, orphan publication receipts and unconfirmed unknown jobs cannot authorize paid continuation', async () => {
  for (const defect of ['source-hash', 'active-campaign', 'same-package', 'orphan-receipt', 'unknown-not-429', 'profile']) {
    const h = fixture({ unknownCode: defect === 'unknown-not-429' ? 500 : 429 })
    try {
      let authorization = h.authorization
      if (defect === 'source-hash') authorization = { ...authorization, sourceCampaignContinuation: { ...authorization.sourceCampaignContinuation, sourceCampaignHash: '0'.repeat(64) } }
      if (defect === 'active-campaign') h.repository.studioPut(h.owner, 'automation_campaign', 'other', { status: 'active', accountIds: [h.profiles[0].accountId] }, 0)
      if (defect === 'same-package') authorization = { ...authorization, runs: authorization.runs.map((run, index) => index ? run : { ...run, packageId: h.sourceRuns[0].packageId }) }
      if (defect === 'orphan-receipt') h.repository.studioPut(h.owner, 'social_publication', 'orphan', { packageId: id(`${h.sourceRuns[0].id}:package`), status: 'dispatch_unknown' }, 0)
      if (defect === 'profile') h.repository.studioPut(h.owner, 'account_profile', h.profiles[0].id, { ...h.profiles[0], tone: 'Changed' }, h.profiles[0].revision)
      await assert.rejects(assertDemoSourceContinuation(h.repository, h.owner, authorization), undefined, defect)
    } finally { h.repository.close() }
  }
})

test('one demo-wide stage lease defers bounded concurrent admissions and preserves every paid hold', async () => {
  const h = fixture(); let dispatched = 0; let release; let entered
  const started = new Promise(resolve => { entered = resolve })
  const services = { research: async () => ({}), generate: async context => { dispatched++; assert.ok(context.demoLease); entered(); await new Promise(resolve => { release = resolve }); return { package: h.repository.studioGet(h.owner, 'package', context.run.packageId) } }, review: async () => ({}), render: async () => ({}), publish: async () => ({}) }
  try {
    const first = runAccountAutomation({ repository: h.repository, owner: h.owner, profile: h.profiles[0], services })
    await started
    const second = await runAccountAutomation({ repository: h.repository, owner: h.owner, profile: h.profiles[1], services })
    assert.equal(second.deferred, true); assert.equal(second.retryAfterMs, 5000); assert.equal(dispatched, 1)
    release(); await first
    const key = id(`${h.demoId}:${h.bindings[1].runId}`)
    const previous = h.repository.studioGet(h.owner, 'automation_demo_wait', key)
    h.repository.studioPut(h.owner, 'automation_demo_wait', key, { ...previous, attempts: 90 }, previous.revision)
    const lease = demoSerialLeaseId(h.owner, h.demoId); h.repository.acquireLease(lease, 'other-worker', 270000)
    const exhausted = await runAccountAutomation({ repository: h.repository, owner: h.owner, profile: h.profiles[1], services })
    assert.equal(exhausted.deferred, false); assert.equal(exhausted.results[0].status, 'held'); assert.equal(dispatched, 1)
    assert.equal(h.repository.budgetSummary('historical-paid').heldMicros, 2683700)
  } finally { h.repository.close() }
})

test('paid publication recovery never retries uncertain or receipted posts, changed consent, failed checks or an already attempted recovery', async () => {
  for (const defect of ['receipt', 'orphan-receipt', 'publish-stage', 'provider-id', 'uncertain', 'checks-failed', 'already-recovered', 'revoked', 'once-only']) {
    const h = fixture(); let checks = 0; let publishes = 0
    try {
      const binding = h.bindings[0]; const original = h.repository.studioGet(h.owner, 'automation_run', binding.runId)
      const run = h.repository.studioPut(h.owner, 'automation_run', original.id, { ...original, status: defect === 'uncertain' ? 'dispatch_unknown' : 'blocked', stage: 'publish', error: 'The stage was blocked before dispatch.', assetIds: ['controlled-asset'], stages: [{ stage: 'render', status: 'completed' }], ...(defect === 'publish-stage' ? { stages: [{ stage: 'render', status: 'completed' }, { stage: 'publish', status: 'failed' }] } : {}), ...(defect === 'provider-id' ? { providerPostId: 'possible-provider-side-effect' } : {}), ...(defect === 'already-recovered' ? { preDispatchRecovery: { version: 1, recoveryId: 'existing' } } : {}) }, original.revision)
      if (['receipt', 'orphan-receipt'].includes(defect)) h.repository.studioPut(h.owner, 'social_publication', 'any-existing-receipt', { packageId: defect === 'receipt' ? run.packageId : id(`${run.id}:package`), status: 'blocked' }, 0)
      if (defect === 'revoked') h.repository.studioPut(h.owner, 'automation_demo', h.demoId, { ...h.authorization, status: 'revoked' }, h.authorization.revision)
      const services = { research: async () => ({}), generate: async () => ({}), review: async () => ({}), render: async () => ({}), recoverPublication: async () => { checks++; return { eligible: defect !== 'checks-failed' } }, publish: async () => { publishes++; throw Object.assign(new Error('Controlled second local rejection'), { preDispatch: true }) } }
      await runAccountAutomation({ repository: h.repository, owner: h.owner, profile: h.profiles[0], services })
      const saved = h.repository.studioGet(h.owner, 'automation_run', run.id)
      if (defect === 'once-only') {
        assert.equal(publishes, 1); assert.ok(saved.preDispatchRecovery)
        await runAccountAutomation({ repository: h.repository, owner: h.owner, profile: h.profiles[0], services })
        assert.equal(publishes, 1); assert.equal(checks, 1)
        assert.equal(h.repository.studioList(h.owner, 'automation_recovery').length, 1)
      } else { assert.equal(publishes, 0, defect); assert.equal(saved.preDispatchRecovery?.recoveryId, defect === 'already-recovered' ? 'existing' : undefined, defect) }
    } finally { h.repository.close() }
  }
})

test('one paid generation rate retry requires exact zero settlement and provider proof, waits sixty seconds and uses a new stable operation', async t => {
  for (const defect of ['missing-proof', 'charged', 'unknown-cost', 'wrong-account', 'receipt', 'valid']) {
    const h = fixture(); let calls = 0
    try {
      const binding = h.bindings[0]; const original = h.repository.studioGet(h.owner, 'automation_run', binding.runId)
      const jobId = demoStageRequestId(original, 'generate'); const requestId = `demo:${jobId}:0`
      const admitted = h.repository.studioJobReserve(h.owner, jobId, 'b'.repeat(64), 20, { operation: 'generation', generationProvider: 'vertex-demo', demoId: h.demoId, packageId: original.packageId, contentHash: original.demoSourceContentHash, profileHash: original.profileHash })
      const running = h.repository.studioJobUpdate(h.owner, jobId, { status: 'running' }, admitted.job.revision, 'reserved')
      h.repository.studioJobUpdate(h.owner, jobId, { status: 'dispatch_unknown', result: null, error: 'Paid demo writing did not complete. Diagnostics: {"code":"VERTEX_REQUEST_FAILED","httpStatus":429}' }, running.revision, 'running')
      const budgetOwner = demoBudgetOwner(h.owner, h.demoId)
      const reserved = h.repository.budgetReserve(budgetOwner, requestId, 'b'.repeat(64), { currency: 'USD', upperBoundMicros: 1277952, priceVersion: 'fixture', priceExpiresAt: h.authorization.expiresAt, kind: 'generation' })
      const dispatched = h.repository.budgetTransition(budgetOwner, requestId, reserved.reservation.revision, 'dispatch')
      h.repository.budgetTransition(budgetOwner, requestId, dispatched.revision, defect === 'unknown-cost' ? 'unknown' : 'settle', defect === 'charged' ? 1 : 0)
      const failed = h.repository.studioPut(h.owner, 'automation_run', original.id, { ...original, status: 'dispatch_unknown', jobId, stages: [{ stage: 'generate', requestId: jobId, jobId, status: 'dispatch_unknown' }] }, original.revision)
      if (defect !== 'missing-proof') h.repository.studioPut(h.owner, 'provider_rejection', jobId, { version: 'vertex-http-rejection-v1', jobId, requestId, runId: defect === 'wrong-account' ? 'other-run' : original.id, packageId: original.packageId, demoAuthorizationId: h.demoId, provider: 'vertex', projectId: 'cs-project-bvfzp2zn', model: 'gemini-3.8-flash', httpStatus: 429, actualMicros: 0, noOutput: true, settledAt: new Date().toISOString(), evidenceHash: 'e'.repeat(64), evidencePath: 'controlled-rejection-fixture' }, 0)
      if (defect === 'receipt') h.repository.studioPut(h.owner, 'social_publication', 'possible-post', { packageId: original.packageId, status: 'blocked' }, 0)
      const services = { research: async () => ({}), review: async () => ({}), render: async () => ({}), publish: async () => ({}), generate: async context => {
        assert.notEqual(context.requestId, jobId)
        const generate = createDemoGenerator({ ...context, repository: h.repository, phase: 'generate' }, { config: { VERTEX_WIF_AUDIENCE: vertexWifAudience, VERTEX_WIF_SERVICE_ACCOUNT: vertexWifServiceAccount }, request: async () => { calls++; return { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 }, candidates: [{ finishReason: 'STOP' }], text: '{}' } } })
        await generate({ input: {}, schema: {}, system: 'Controlled retry fixture', maxTokens: 10 })
        return { status: 'completed', package: h.repository.studioGet(h.owner, 'package', context.run.packageId) }
      } }
      const waiting = await runAccountAutomation({ repository: h.repository, owner: h.owner, profile: h.profiles[0], services })
      assert.equal(calls, 0)
      if (defect === 'valid') {
        assert.equal(waiting.continuationPending, true)
        const pending = h.repository.studioGet(h.owner, 'automation_run', original.id)
        assert.ok(Date.parse(pending.providerRateRetry.notBefore) >= Date.parse(failed.updatedAt) + 60000)
        const future = Date.parse(pending.providerRateRetry.notBefore) + 1
        t.mock.timers.enable({ apis: ['Date'], now: future })
        const resumed = await runAccountAutomation({ repository: h.repository, owner: h.owner, profile: h.profiles[0], services })
        assert.equal(resumed.results[0].status, 'pending', JSON.stringify(resumed)); assert.equal(calls, 1)
        assert.equal(h.repository.studioJobGet(h.owner, jobId).status, 'dispatch_unknown')
        assert.equal(h.repository.studioList(h.owner, 'automation_recovery').length, 1)
        t.mock.timers.reset()
      } else assert.equal(h.repository.studioGet(h.owner, 'automation_run', original.id).providerRateRetry, undefined, defect)
    } finally { t.mock.timers.reset(); h.repository.close() }
  }
})
