import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { runAccountAutomation } from '../automation/runner.js'
import { createAutomationServices } from '../automation/services.js'
import { automaticTextPolicyVersion } from '../automation/review.js'
import { contentHash } from '../studio/approval.js'
import { settingsSchema } from '../studio/content.js'
import { env } from '../config/env.js'

const now = new Date('2026-11-09T06:00:00Z')
function profile(repository) {
  return repository.studioPut('owner', 'account_profile', 'profile', { accountId: 'account', platform: 'LinkedIn', timezone: 'Asia/Calcutta', audience: 'Developers', tone: 'Factual', weeklyBrief: 'Explain source-backed AI developments and limitations.', contentPillars: ['AI'], weeklyCadence: 3, maxDailyPosts: 1, dailyNews: false, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'owner', consentedAt: now.toISOString(), paidBudgetMicros: 0 } }, 0)
}
function stages(calls, outcome) {
  return {
    research: async ctx => { calls.push(['research', ctx.requestId]); return { reportId: 'report', topics: [{ title: 'Supported topic', evidenceHash: 'hash', evidenceIds: ['E1'] }] } },
    generate: async ctx => { calls.push(['generate', ctx.requestId, ctx]); return { id: 'pack', content: { website: { title: 'Draft' } } } },
    review: async ctx => { calls.push(['review', ctx.requestId]); return outcome(ctx) },
    render: async ctx => { calls.push(['render', ctx.requestId, ctx]); return { assets: [{ id: 'new-asset' }] } },
    publish: async ctx => { calls.push(['publish', ctx.requestId, ctx]); return { id: 'publication', status: 'published', providerPostId: 'native-receipt' } },
  }
}
const findings = { status: 'needs_revision', eligible: false, repairable: true, reviewResult: { issues: ['Qualify the unsupported comparison.'] }, reviewId: 'actual-review', contentHash: 'old-content-hash', issues: ['Qualify the unsupported comparison.'] }

test('one recorded quality failure defers repair, changes downstream IDs and never reuses old assets', async () => {
  const repository = createRepository(':memory:'); const calls = []; const p = profile(repository)
  try {
    const services = stages(calls, ctx => ctx.run.qualityRevision ? { status: 'passed', eligible: true } : findings)
    const first = await runAccountAutomation({ repository, owner: 'owner', profile: p, services, now })
    assert.equal(first.deferred, true)
    const failed = first.results[0]
    assert.equal(failed.stage, 'generate'); assert.equal(failed.qualityRevision.version, 1)
    assert.match(failed.qualityRevision.instruction, /unsupported comparison/)
    assert.deepEqual(calls.map(call => call[0]), ['research', 'generate', 'review'])
    const versionedReviewHash = createHash('sha256').update(`${failed.id}:review:${automaticTextPolicyVersion}:content:${failed.contentHash}`).digest('hex')
    assert.equal(calls[2][1].replaceAll('-', ''), versionedReviewHash.slice(0, 32))
    await repository.studioPut('owner', 'automation_run', failed.id, { ...failed, assetIds: ['stale-asset'] }, failed.revision)
    const second = await runAccountAutomation({ repository, owner: 'owner', profile: p, services, now })
    assert.equal(second.results[0].status, 'completed')
    assert.notEqual(calls[1][1], calls[3][1]); assert.notEqual(calls[2][1], calls[4][1])
    const repairedReviewHash = createHash('sha256').update(`${failed.id}:review:${automaticTextPolicyVersion}:content:${second.results[0].contentHash}:quality:1`).digest('hex')
    assert.equal(calls[4][1].replaceAll('-', ''), repairedReviewHash.slice(0, 32))
    assert.equal(calls[3][2].replacementOf, undefined)
    assert.equal(calls[6][2].run.assetIds[0], 'new-asset')
    assert.equal(calls.filter(call => call[0] === 'research').length, 1)
  } finally { repository.close() }
})

test('repair is capped once and unknown or invalid reviews never start a repair', async () => {
  for (const outcome of [findings, { status: 'dispatch_unknown' }, { status: 'blocked', issues: ['Invalid provider JSON'], repairable: false }, { ...findings, reviewResult: null }]) {
    const repository = createRepository(':memory:'); const calls = []; const p = profile(repository)
    try {
      const services = stages(calls, () => outcome)
      const first = await runAccountAutomation({ repository, owner: 'owner', profile: p, services, now })
      if (outcome === findings) {
        const second = await runAccountAutomation({ repository, owner: 'owner', profile: p, services, now })
        assert.equal(second.results[0].status, 'blocked'); assert.equal(calls.filter(call => call[0] === 'generate').length, 2)
      } else assert.equal(first.results[0].qualityRevision, undefined)
      assert.equal(calls.filter(call => ['render', 'publish'].includes(call[0])).length, 0)
    } finally { repository.close() }
  }
})

test('recorded deterministic preflight findings can trigger one repair without pretending a model review', async () => {
  const repository = createRepository(':memory:'); const calls = []; const p = profile(repository)
  try {
    const outcome = { ...findings, status: 'blocked', reviewResult: null, preflightIssues: ['The 1% number is absent from its selected quote.'] }
    const result = await runAccountAutomation({ repository, owner: 'owner', profile: p, services: stages(calls, () => outcome), now })
    assert.equal(result.results[0].qualityRevision.reviewId, 'actual-review')
    assert.equal(result.results[0].stage, 'generate')
  } finally { repository.close() }
})

test('real generation replaces failed content with recorded feedback, keeps zero paid scope and adopts only its completed job', async () => {
  const repository = createRepository(':memory:'); const p = profile(repository); const run = { id: 'quality-unit' }
  const id = createHash('sha256').update(`${run.id}:package`).digest('hex').slice(0, 32)
  const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted and independent deployment results have not been established.'
  const content = { website: { title: 'Preview', body: 'A limited developer preview was announced [C1].' }, claims: [{ id: 'C1', text: 'A limited developer preview was announced', quote: excerpt, evidenceId: 'E1', status: 'attributed' }] }
  let calls = 0; let details
  const services = createAutomationServices(repository, { write: async (_evidence, _settings, value) => { calls++; details = value; return content } })
  try {
    let pack = await repository.studioPut('owner', 'package', id, { content, evidence: [{ id: 'E1', hash: 'hash', url: 'https://example.com/update', excerpt, retrievedAt: now.toISOString() }], sourceIds: [], settings: settingsSchema.parse({ outputs: ['website'] }), status: 'completed', createdBy: 'owner', jobId: 'old-job' }, 0)
    const actualReview = { policyVersion: automaticTextPolicyVersion, runId: 'actual-review', status: 'needs_revision', issues: ['Ratings do not meet the release threshold.'], result: { issues: ['Keep the limited preview qualification.'], ratings: { factualAccuracy: { score: 5, rationale: 'The restriction was omitted.' } }, claims: [{ id: 'C1', verdict: 'unsupported', reason: 'The selected quotation restricts availability to the preview.' }] }, contentHash: contentHash(pack) }
    pack = await repository.studioPut('owner', 'package', id, { ...pack, automaticReview: actualReview }, pack.revision)
    const context = { owner: 'owner', profile: p, actorUid: 'owner', requestId: randomUUID(), freeOnly: true, paidBudgetMicros: 0, run: { ...run, qualityRevision: { version: 1, reviewId: actualReview.runId, contentHash: contentHash(pack), instruction: 'Keep the limited preview qualification.' } } }
    const result = await services.generate(context)
    assert.equal(result.status, 'completed'); assert.equal(calls, 1)
    assert.equal(details.revisionInstruction, context.run.qualityRevision.instruction)
    assert.deepEqual(details.previousContent, content)
    assert.deepEqual(details.automaticReviewFeedback, { reviewId: actualReview.runId, contentHash: actualReview.contentHash, issues: [...actualReview.issues, ...actualReview.result.issues], ratings: actualReview.result.ratings, claims: actualReview.result.claims })
    const saved = await repository.studioGet('owner', 'package', id)
    assert.equal(saved.automaticReview, null); assert.equal(saved.jobId, context.requestId)
    const job = await repository.studioJobGet('owner', context.requestId)
    assert.equal(job.scope.qualityRevisionOf, actualReview.runId); assert.equal(job.scope.generationProvider, 'free')
    const adopted = await services.generate(context)
    assert.equal(adopted.id, id); assert.equal(calls, 1)
    await assert.rejects(() => services.generate({ ...context, requestId: randomUUID() }), /actual completed review/)
  } finally { repository.close() }
})

test('automatic review admission uses the configured owner generation allowance', async () => {
  const repository = createRepository(':memory:'); const p = profile(repository); let quota
  try {
    await repository.studioPut('owner', 'package', 'pack', { content: {} }, 0)
    repository.studioReserve = async (_scope, _id, allowance) => { quota = allowance; return { reserved: false } }
    await assert.rejects(() => createAutomationServices(repository).review({ owner: 'owner', profile: p, actorUid: 'owner', requestId: randomUUID(), run: { packageId: 'pack' } }), /allowance is exhausted/)
    assert.equal(quota, env.STUDIO_DAILY_GENERATIONS)
  } finally { repository.close() }
})
