import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createAutomationServices } from '../automation/services.js'
import { demoOwner, demoBudgetOwner, demoStageRequestId } from '../automation/demo.js'
import { contentHash } from '../studio/approval.js'
import { costScopeHash } from '../budget/policy.js'
import { settingsSchema } from '../studio/content.js'
import { runAccountAutomation } from '../automation/runner.js'
import { reviewAutomaticText } from '../automation/review.js'
import { createDemoFixture } from './fixtures/demo.js'
import { ratingsFixture } from './fixtures/finalization.js'

function contentFixture(excerpt, body = 'The publisher announced a limited developer preview [C1].') { return { website: { title: 'Developer preview', body }, claims: [{ id: 'C1', text: 'The publisher announced a limited developer preview', evidenceId: 'E1', quote: excerpt, status: 'attributed' }], strategy: { angle: 'Limited preview', audience: 'Developers', whyNow: 'A preview', factCheck: 'Check scope', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Clear', keywords: ['AI'], platforms: [{ platform: 'X', headline: 'Developer preview [C1]', hook: 'A preview [C1]', body, cta: 'Read the source', hashtags: [], thumbnail: 'Original diagram', format: 'Post', retentionPlan: 'Clear scope', alternativeHook: 'Developer preview [C1]', testPlan: 'Observe clicks' }], experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Clicks', decisionRule: 'Comparable views' }] } } }

for (const provider of ['vertex', 'openrouter']) for (const baseline of ['saved-draft', 'empty']) test(`${provider} scoped demo accepts ${baseline} baselines and preserves actual provider/model provenance`, async () => {
  const repository = createRepository(':memory:'); const owner = demoOwner
  const runId = 'a'.repeat(32); const packageId = createHash('sha256').update(`${runId}:package`).digest('hex').slice(0, 32)
  const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted and independent deployment results have not been established.'
  const body = 'The publisher announced a limited developer preview [C1].'
  const content = contentFixture(excerpt, body)
  let paidCalls = 0; let writes = 0
  const services = createAutomationServices(repository, { demoGenerate: () => async () => { paidCalls++; return { controlled: true } }, write: async (_evidence, settings, details, generate) => { writes++; assert.equal(details.previousContent, null); assert.deepEqual(settings.outputs, ['platforms', 'website']); await generate({ input: {}, schema: {} }); return content } })
  try {
    const profile = repository.studioPut(owner, 'account_profile', 'profile-a', { accountId: 'account-a', platform: 'X', enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: owner, consentedAt: new Date(Date.now() - 60000).toISOString(), paidBudgetMicros: 0 } }, 0)
    const oldContent = baseline === 'empty' ? null : { ...content, website: { title: 'Previous saved title', body } }
    const pack = repository.studioPut(owner, 'package', packageId, { settings: settingsSchema.parse({ outputs: ['website'] }), content: oldContent, evidence: [{ id: 'E1', hash: 'source-hash', url: 'https://example.com/update', excerpt, retrievedAt: new Date().toISOString() }], status: 'completed', createdBy: owner, jobId: 'original-unknown' }, 0)
    const old = repository.studioJobReserve(owner, 'original-unknown', 'a'.repeat(64), 20, { operation: 'generation', packageId })
    const running = repository.studioJobUpdate(owner, old.job.id, { status: 'running' }, old.job.revision, 'reserved')
    repository.studioJobUpdate(owner, old.job.id, { status: 'dispatch_unknown' }, running.revision, 'running')
    let run = repository.studioPut(owner, 'automation_run', runId, { packageId, accountId: profile.accountId, profileHash: costScopeHash(profile, null), demoAuthorizationId: 'controlled-demo', demoSourceContentHash: contentHash(pack), contentHash: contentHash(pack), status: 'generate_running', stage: 'generate' }, 0)
    const binding = { runId, accountId: profile.accountId, profileId: profile.id, profileHash: costScopeHash(profile, null), packageId, sourceContentHash: contentHash(pack) }
    const model = provider === 'openrouter' ? 'google/gemini-3.8-flash' : 'gemini-3.8-flash'
    repository.studioPut(owner, 'automation_demo', run.demoAuthorizationId, { version: 'five-account-paid-demo-v1', status: 'active', owner, actorUid: owner, currency: 'USD', totalLimitMicros: 5000000, projectId: provider === 'vertex' ? 'cs-project-bvfzp2zn' : 'ai-vertical-495712', ...(provider === 'openrouter' ? { provider, priceExpiresAt: new Date(Date.now() + 1800000).toISOString() } : {}), model, authorizedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), allowedStages: ['generate', 'review'], runs: [binding, ...['b', 'c', 'd', 'e'].map(key => ({ ...binding, runId: key.repeat(32), accountId: `account-${key}` }))] }, 0)
    repository.budgetConfigure('USD', demoBudgetOwner(owner, run.demoAuthorizationId), 5000000, 5000000)
    const context = { owner, actorUid: owner, profile, run, requestId: demoStageRequestId(run, 'generate') }
    const result = await services.generate(context)
    assert.equal(result.status, 'completed'); assert.equal(writes, 1); assert.equal(paidCalls, 1)
    assert.equal(result.package.content.website.title, 'Developer preview')
    assert.notEqual(result.jobId, old.job.id)
    assert.equal(repository.studioJobGet(owner, old.job.id).status, 'dispatch_unknown')
    assert.equal(repository.studioJobGet(owner, result.jobId).scope.generationProvider, `${provider}-demo`)
    assert.equal(repository.studioJobGet(owner, result.jobId).scope.model, model)
    assert.equal(repository.budgetGet(owner, result.jobId), null, 'paid writing has no misleading free-only monetary reservation')
    run = repository.studioPut(owner, 'automation_run', run.id, { ...run, contentHash: contentHash(result.package), status: 'review_running', stage: 'review' }, run.revision)
    const reviewed = await services.review({ ...context, run, requestId: demoStageRequestId(run, 'review') })
    assert.equal(reviewed.status, 'blocked', 'the controlled invalid evaluator payload never approves release')
    assert.equal(repository.studioGet(owner, 'package', packageId).automaticReview.model, model)
    repository.studioPut(owner, 'account_profile', profile.id, { ...profile, tone: 'Changed after authorization' }, profile.revision)
    await assert.rejects(services.review({ ...context, run, requestId: demoStageRequestId(run, 'review') }), error => error.preDispatch === true)
    assert.equal(paidCalls, 2)
  } finally { repository.close() }
})

test('a recorded failed paid review resumes into exactly one settled correction and fresh review without publishing retries', async () => {
  for (const outcome of ['passed', 'failed-again', 'prior-unknown']) {
    const repository = createRepository(':memory:'); let paidCalls = 0; let writes = 0; let publishes = 0
    try {
      const fixture = await createDemoFixture(repository); const original = fixture.contexts[0]; const owner = fixture.owner
      const at = new Date(); const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Calcutta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
      const profile = repository.studioPut(owner, 'account_profile', original.profile.id, { ...original.profile, platform: 'X', weeklyCadence: 3, dailyNews: true, maxDailyPosts: 1, audience: 'Developers', tone: 'Factual', weeklyBrief: 'Explain source-reported agent safeguards and limitations.', contentPillars: ['AI security'] }, original.profile.revision)
      const profileHash = costScopeHash(profile, null)
      repository.studioPut(owner, 'automation_demo', fixture.demoId, { ...fixture.authorization, runs: fixture.authorization.runs.map(binding => binding.runId === original.run.id ? { ...binding, profileHash } : binding) }, fixture.authorization.revision)
      let pack = repository.studioGet(owner, 'package', original.run.packageId)
      const excerpt = pack.evidence[0].excerpt; const initial = contentFixture(excerpt)
      pack = repository.studioPut(owner, 'package', pack.id, { ...pack, settings: settingsSchema.parse({ platform: 'X', outputs: ['platforms', 'website'] }), content: initial, status: 'completed' }, pack.revision)
      const reviewData = passed => ({ claims: [{ id: 'C1', evidenceIds: ['E1'], verdict: passed ? 'supported' : 'unsupported', supportQuote: passed ? excerpt : null, reason: passed ? 'The selected publisher quotation supports the qualified limited preview claim.' : 'The selected quotation needs its restriction preserved in the saved wording.' }], ratings: ratingsFixture(), checks: { semanticSupport: passed, contradictionsResolved: true, scopePreserved: passed, promisesAligned: true, privacySafe: true, audienceClaimsSupported: true, provenanceClear: true }, issues: passed ? [] : ['Preserve the source qualification and remove unsupported scope.'], summary: passed ? 'The revised copy preserves the selected source qualification and attribution.' : 'The recorded draft requires a source-bound qualification before release.' })
      const actualReview = await reviewAutomaticText(pack, profile, { actorId: owner, model: 'gemini-3.8-flash', generate: async () => reviewData(false) })
      assert.equal(actualReview.status, 'needs_revision')
      pack = repository.studioPut(owner, 'package', pack.id, { ...pack, automaticReview: actualReview }, pack.revision)
      let run = { ...original.run, profileHash, contentHash: contentHash(pack), actorUid: owner, localDate, slot: { kind: 'evergreen-demo', index: 0 }, stage: 'review', status: 'blocked' }
      const initialGenerateId = demoStageRequestId(run, 'generate'); const initialReviewId = demoStageRequestId(run, 'review')
      run.stages = [{ stage: 'review', requestId: initialReviewId, status: 'needs_revision' }]
      run.findings = actualReview.issues
      run = repository.studioPut(owner, 'automation_run', run.id, run, original.run.revision)
      async function settleStage(stageRun, phase, unknown = false) {
        const id = `demo:${demoStageRequestId(stageRun, phase)}:0`; const budgetOwner = demoBudgetOwner(owner, fixture.demoId)
        const reserved = repository.budgetReserve(budgetOwner, id, 'a'.repeat(64), { currency: 'USD', upperBoundMicros: 100, priceVersion: 'controlled-test-receipt', priceExpiresAt: new Date(Date.now() + 3600000).toISOString(), kind: 'generation' })
        const dispatched = repository.budgetTransition(budgetOwner, id, reserved.reservation.revision, 'dispatch')
        repository.budgetTransition(budgetOwner, id, dispatched.revision, unknown ? 'unknown' : 'settle', unknown ? undefined : 1)
      }
      await settleStage(run, 'generate'); await settleStage(run, 'review', outcome === 'prior-unknown')
      const services = createAutomationServices(repository, { demoGenerate: context => async () => { paidCalls++; await settleStage(context.run, context.phase); return context.phase === 'review' ? reviewData(outcome === 'passed') : { fixture: true } }, write: async (_evidence, _settings, details, generate) => { writes++; assert.equal(details.revisionInstruction.includes('qualification'), true); assert.equal(details.automaticReviewFeedback.reviewId, actualReview.runId); assert.deepEqual(details.automaticReviewFeedback.claims, actualReview.result.claims.map(({ id, verdict, reason }) => ({ id, verdict, reason }))); assert.deepEqual(details.previousContent, initial); await generate({ input: {}, schema: {} }); return { ...contentFixture(excerpt), website: { title: 'Qualified developer preview', body: initial.website.body } } }, render: async () => { throw new Error('This test must stop before real media generation') }, publisher: { publish: async () => { publishes++; return { receipt: { id: 'controlled-publication', status: 'published' } } } } })
      const first = await runAccountAutomation({ repository, owner, profile, services, now: at, maxStages: 1 })
      if (outcome === 'prior-unknown') {
        assert.equal(first.results[0].status, 'blocked'); assert.equal(first.results[0].qualityRevision, undefined); assert.equal(paidCalls, 0)
      } else {
        assert.equal(first.results[0].stage, 'generate'); assert.equal(first.results[0].qualityRevision.version, 1); assert.equal(paidCalls, 0, 'reusing the exact recorded failed review does not pay for another evaluator')
        const generated = await runAccountAutomation({ repository, owner, profile, services, now: at, maxStages: 1 })
        assert.notEqual(demoStageRequestId(generated.results[0], 'generate'), initialGenerateId)
        assert.notEqual(demoStageRequestId(generated.results[0], 'review'), initialReviewId)
        const reviewed = await runAccountAutomation({ repository, owner, profile, services, now: at, maxStages: 1 })
        assert.equal(reviewed.results[0].status, outcome === 'passed' ? 'pending' : 'blocked')
        assert.equal(reviewed.results[0].stage, outcome === 'passed' ? 'render' : 'review')
        if (outcome === 'passed') { assert.deepEqual(reviewed.results[0].findings, []); assert.ok(reviewed.results[0].qualityRevision.issues.length) }
        assert.equal(writes, 1); assert.equal(paidCalls, 2)
        assert.equal(repository.studioList(owner, 'automation_demo_review')[0].review.runId, actualReview.runId)
        if (outcome === 'failed-again') { await runAccountAutomation({ repository, owner, profile, services, now: at }); assert.equal(writes, 1); assert.equal(paidCalls, 2) }
      }
      assert.equal(publishes, 0)
      assert.equal(repository.budgetSummary(owner).limitMicros, 0)
    } finally { repository.close() }
  }
})
