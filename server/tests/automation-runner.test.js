import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { planAccountWeek, runAccountAutomation, runRegisteredAutomation } from '../automation/runner.js'
import { contentHash } from '../studio/approval.js'
import { automaticTextPolicyVersion } from '../automation/review.js'
import { createHash } from 'node:crypto'
import { demoStageRequestId } from '../automation/demo.js'
import { createDemoFixture } from './fixtures/demo.js'
import { costScopeHash } from '../budget/policy.js'

const now = new Date('2026-11-09T06:00:00.000Z')
function profileFixture(repository, accountId = 'account-one') {
  return repository.studioPut('alice', 'account_profile', accountId, { accountId, platform: 'LinkedIn', timezone: 'Asia/Calcutta', audience: 'Developers', tone: 'Factual', weeklyBrief: 'Explain current source-backed AI developments and their limitations', contentPillars: ['AI research'], weeklyCadence: 3, maxDailyPosts: 1, dailyNews: true, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice', paidBudgetMicros: 0 } }, 0)
}
function servicesFixture(repository, calls) {
  const record = phase => ctx => { calls.push({ phase, requestId: ctx.requestId, freeOnly: ctx.freeOnly, paidBudgetMicros: ctx.paidBudgetMicros }); return ctx }
  return {
    research: async ctx => { record('research')(ctx); return { reportId: 'real-report-reference', topics: [{ title: 'A supported development', evidenceHash: 'actual-source-hash', evidenceIds: ['E1'] }] } },
    generate: async ctx => { record('generate')(ctx); return repository.studioPut(ctx.owner, 'package', `pack-${ctx.profile.accountId}`, { content: { website: { title: 'Controlled fixture content' } } }, 0) },
    review: async ctx => { record('review')(ctx); return { eligible: true, method: 'controlled-fixture-review' } },
    render: async ctx => { record('render')(ctx); return { assets: [{ id: `asset-${ctx.profile.accountId}` }] } },
    publish: async ctx => { record('publish')(ctx); return { id: `receipt-${ctx.profile.accountId}`, status: 'published', providerPostId: `provider-${ctx.profile.accountId}`, releaseUrl: 'https://example.com/controlled-test-receipt' } },
  }
}

test('weekly plans use local dates, preserve weekly cadence and fit news within remaining daily capacity', () => {
  const plan = planAccountWeek({ timezone: 'Asia/Calcutta', weeklyCadence: 3, dailyNews: true, maxDailyPosts: 1 }, new Date('2026-11-08T20:00:00Z'))
  assert.equal(plan.localDate, '2026-11-09'); assert.equal(plan.weekStart, '2026-11-09')
  assert.equal(plan.days.length, 7); assert.equal(plan.days[0].slots[0].kind, 'weekly'); assert.equal(plan.days[0].deferredSlots, 1)
  assert.equal(plan.days.flatMap(day => day.slots).filter(slot => slot.kind === 'weekly').length, 3)
  assert.equal(plan.days.flatMap(day => day.slots).filter(slot => slot.kind === 'news').length, 4)
  assert.ok(plan.days.every(day => day.slots.length <= 1))
  const spaced = planAccountWeek({ weeklyCadence: 3, dailyNews: false, maxDailyPosts: 1 }, now)
  assert.deepEqual(spaced.days.flatMap((day, index) => day.slots.length ? [index] : []), [0, 2, 4])
})

test('account runner executes actual injected stages once, keeps source identity and recurring paid ceiling zero', async () => {
  const repository = createRepository(':memory:'); const calls = []; const profile = profileFixture(repository)
  try {
    const services = servicesFixture(repository, calls)
    const first = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(first.results[0].status, 'completed'); assert.equal(first.results[0].providerPostId, 'provider-account-one')
    assert.deepEqual(calls.map(call => call.phase), ['research', 'generate', 'review', 'render', 'publish'])
    assert.ok(calls.every(call => call.freeOnly && call.paidBudgetMicros === 0 && /^[a-f0-9-]{36}$/.test(call.requestId)))
    assert.equal(first.results[0].topic.evidenceHash, 'actual-source-hash')
    const repeat = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(repeat.results[0].id, first.results[0].id); assert.equal(calls.length, 5)
    const tomorrow = new Date(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const duplicateTopic = await runAccountAutomation({ repository, owner: 'alice', profile, services, now: tomorrow })
    assert.equal(duplicateTopic.results[0].status, 'blocked'); assert.match(duplicateTopic.results[0].error, /repeats/); assert.equal(calls.length, 6)
  } finally { repository.close() }
})

test('uncertain generation, changed consent, existing daily posts and pending receipts never cause blind retries', async () => {
  const repository = createRepository(':memory:'); const calls = []; let profile = profileFixture(repository)
  try {
    const services = servicesFixture(repository, calls)
    services.generate = async _ctx => { calls.push({ phase: 'generate' }); throw new Error('timeout with sensitive data that must not be recorded') }
    const failed = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(failed.results[0].status, 'dispatch_unknown'); assert.doesNotMatch(failed.results[0].error, /sensitive/)
    await runAccountAutomation({ repository, owner: 'alice', profile, services, now }); assert.equal(calls.length, 2)
    profile = profileFixture(repository, 'account-two')
    await repository.studioPut('alice', 'social_publication', 'existing-unknown', { accountId: profile.accountId, status: 'dispatch_unknown', publishAt: now.toISOString() }, 0)
    const capped = await runAccountAutomation({ repository, owner: 'alice', profile, services: servicesFixture(repository, []), now }); assert.equal(capped.results[0].status, 'skipped')
    profile = profileFixture(repository, 'account-three'); const laterCalls = []; const later = servicesFixture(repository, laterCalls)
    later.generate = async ctx => { const pack = await servicesFixture(repository, laterCalls).generate(ctx); await repository.studioPut('alice', 'account_profile', profile.id, { ...profile, automationConsent: false }, profile.revision); return pack }
    const revoked = await runAccountAutomation({ repository, owner: 'alice', profile, services: later, now }); assert.equal(revoked.results[0].status, 'blocked'); assert.equal(laterCalls.length, 2)
    profile = profileFixture(repository, 'account-four'); const waitingCalls = []; const waiting = servicesFixture(repository, waitingCalls)
    waiting.publish = async ctx => ({ id: `receipt-${ctx.profile.accountId}`, status: 'submitted', providerPostId: 'actual-provider-receipt' })
    waiting.readback = async () => ({ status: 'published', providerPostId: 'actual-provider-receipt', releaseUrl: 'https://example.com/readback' })
    const pending = await runAccountAutomation({ repository, owner: 'alice', profile, services: waiting, now }); assert.equal(pending.results[0].status, 'awaiting_receipt')
    const reconciled = await runAccountAutomation({ repository, owner: 'alice', profile, services: waiting, now }); assert.equal(reconciled.results[0].status, 'completed'); assert.equal(waitingCalls.length, 4)
  } finally { repository.close() }
})

test('registered scheduler uses only explicitly consented profiles and defers beyond its bounded batch', async () => {
  const repository = createRepository(':memory:'); const calls = []
  try {
    profileFixture(repository); profileFixture(repository, 'account-two')
    await repository.studioPut('__automation_registry__', 'automation_owner', 'registered', { ownerScope: 'alice', enabled: true }, 0)
    const result = await runRegisteredAutomation({ repository, services: servicesFixture(repository, calls), now, limit: 1 })
    assert.equal(result.outcomes.length, 1); assert.equal(result.deferred, true); assert.equal(calls.length, 5)
    const next = await runRegisteredAutomation({ repository, services: servicesFixture(repository, calls), now, limit: 1 })
    assert.equal(next.outcomes.length, 1); assert.notEqual(next.outcomes[0].accountId, result.outcomes[0].accountId); assert.equal(calls.length, 10)
    const unauthorized = await runAccountAutomation({ repository, owner: 'alice', profile: { ...profileFixture(repository, 'account-three'), automaticPolicy: { consentedBy: 'not-owner' } }, services: servicesFixture(repository, calls), now })
    assert.equal(unauthorized.status, 'blocked'); assert.equal(calls.length, 10)
  } finally { repository.close() }
})

test('completed durable jobs resume interrupted stages by readback without a second dispatch', async () => {
  const repository = createRepository(':memory:'); const calls = []; const profile = profileFixture(repository)
  const services = servicesFixture(repository, calls)
  let dispatches = 0; let actualJob
  services.generate = async ctx => {
    dispatches++
    actualJob = { requestId: ctx.requestId, result: repository.studioPut('alice', 'package', 'recovered-pack', { content: { website: { title: 'Durably saved result' } } }, 0) }
    throw new Error('Response lost after the durable job completed')
  }
  let readbacks = 0
  services.reconcile = async ctx => { readbacks++; assert.equal(ctx.phase, 'generate'); assert.equal(ctx.requestId, actualJob.requestId); return actualJob.result }
  try {
    const first = await runAccountAutomation({ repository, owner: 'alice', profile, services, now }); assert.equal(first.results[0].status, 'dispatch_unknown')
    const second = await runAccountAutomation({ repository, owner: 'alice', profile, services, now }); assert.equal(second.results[0].status, 'completed')
    assert.equal(second.results[0].packageId, 'recovered-pack'); assert.equal(dispatches, 1); assert.equal(readbacks, 1)
  } finally { repository.close() }
})

test('one-stage invocations persist the next stage and continue without repeating completed provider work', async () => {
  const repository = createRepository(':memory:'); const calls = []; const profile = profileFixture(repository)
  const services = servicesFixture(repository, calls)
  try {
    for (const [index, phase] of ['research', 'generate', 'review', 'render', 'publish'].entries()) {
      const result = await runAccountAutomation({ repository, owner: 'alice', profile, services, now, maxSlots: 1, maxStages: 1 })
      assert.equal(calls.length, index + 1)
      assert.equal(calls[index].phase, phase)
      assert.equal(result.deferred, phase !== 'publish')
      assert.equal(result.results[0].status, phase === 'publish' ? 'completed' : 'pending')
    }
    const repeat = await runAccountAutomation({ repository, owner: 'alice', profile, services, now, maxStages: 1 })
    assert.equal(repeat.results[0].status, 'completed'); assert.equal(repeat.deferred, false); assert.equal(calls.length, 5)
  } finally { repository.close() }
})

test('review operation identity binds actual generated content and retains legacy reconciliation identity', async () => {
  const repository = createRepository(':memory:'); const calls = []; const profile = profileFixture(repository)
  const services = servicesFixture(repository, calls)
  const execute = () => runAccountAutomation({ repository, owner: 'alice', profile, services, now, maxStages: 1 })
  try {
    await execute()
    const generated = (await execute()).results[0]
    const pack = repository.studioGet('alice', 'package', generated.packageId)
    assert.equal(generated.contentHash, contentHash(pack))
    let run = (await execute()).results[0]
    const originalReviewId = calls.at(-1).requestId
    run = repository.studioPut('alice', 'automation_run', run.id, { ...run, stage: 'review', status: 'pending' }, run.revision)
    run = (await execute()).results[0]
    assert.equal(calls.at(-1).requestId, originalReviewId, 'same content keeps its existing review operation identity')
    const updated = repository.studioPut('alice', 'package', pack.id, { ...pack, content: { website: { title: 'A genuinely changed saved draft' } } }, pack.revision)
    run = repository.studioPut('alice', 'automation_run', run.id, { ...run, stage: 'review', status: 'pending', contentHash: contentHash(updated), qualityRevision: { version: 1 } }, run.revision)
    run = (await execute()).results[0]
    const changedReviewId = calls.at(-1).requestId
    assert.notEqual(changedReviewId, originalReviewId)
    assert.equal(run.qualityRevision.version, 1, 'new review identity never resets the bounded quality revision')
    repository.studioPut('alice', 'automation_run', run.id, { ...run, stage: 'review', status: 'pending', contentHash: contentHash(pack) }, run.revision)
    run = (await execute()).results[0]
    assert.notEqual(calls.at(-1).requestId, changedReviewId, 'content changes independently of the quality revision discriminator')
    const legacy = { ...run, stage: 'review', status: 'dispatch_unknown' }; delete legacy.contentHash; delete legacy.qualityRevision
    repository.studioPut('alice', 'automation_run', run.id, legacy, run.revision)
    const hex = createHash('sha256').update(`${run.id}:review:${automaticTextPolicyVersion}`).digest('hex')
    const legacyId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
    let reconciled = 0
    services.reconcile = async ctx => { reconciled++; assert.equal(ctx.requestId, legacyId); return { status: 'dispatch_unknown' } }
    const before = calls.length
    assert.equal((await execute()).results[0].status, 'dispatch_unknown')
    assert.equal(calls.length, before); assert.equal(reconciled, 1)
  } finally { repository.close() }
})

test('a changed content hash cannot redispatch an uncertain publication', async () => {
  const repository = createRepository(':memory:'); const calls = []; const profile = profileFixture(repository)
  const services = servicesFixture(repository, calls); let publishes = 0; let publicationRequestId
  services.publish = async ctx => { publishes++; publicationRequestId = ctx.requestId; return { id: 'uncertain-receipt', status: 'dispatch_unknown' } }
  services.reconcile = async ctx => { assert.equal(ctx.phase, 'publish'); assert.equal(ctx.requestId, publicationRequestId); return { status: 'dispatch_unknown' } }
  try {
    const first = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    const run = first.results[0]
    repository.studioPut('alice', 'automation_run', run.id, { ...run, contentHash: 'different-content-hash' }, run.revision)
    const next = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(next.results[0].status, 'dispatch_unknown'); assert.equal(publishes, 1)
  } finally { repository.close() }
})

test('explicit demo stages use scoped IDs and cannot start automatic paid quality or timeout replacements', async () => {
  const repository = createRepository(':memory:'); const calls = []; const profile = profileFixture(repository)
  const services = servicesFixture(repository, calls)
  try {
    const first = await runAccountAutomation({ repository, owner: 'alice', profile, services, now, maxStages: 1 })
    let run = first.results[0]
    run = repository.studioPut('alice', 'automation_run', run.id, { ...run, demoAuthorizationId: 'controlled-demo', demoSourceContentHash: 'a'.repeat(64) }, run.revision)
    const writingId = demoStageRequestId(run, 'generate')
    const generated = await runAccountAutomation({ repository, owner: 'alice', profile, services, now, maxStages: 1 })
    assert.equal(calls.at(-1).requestId, writingId)
    const reviewId = demoStageRequestId(generated.results[0], 'review')
    assert.notEqual(reviewId, writingId)
    assert.notEqual(demoStageRequestId({ ...generated.results[0], contentHash: 'b'.repeat(64) }, 'review'), reviewId)
    services.review = async ctx => { calls.push({ phase: 'review', requestId: ctx.requestId }); return { status: 'needs_revision', eligible: false, repairable: true, reviewResult: {}, reviewId: 'actual-review', contentHash: ctx.run.contentHash, issues: ['A material qualification is missing.'] } }
    const rejected = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(calls.at(-1).requestId, reviewId)
    assert.equal(rejected.results[0].status, 'blocked'); assert.equal(rejected.results[0].qualityRevision, undefined)
    assert.equal(calls.filter(call => call.phase === 'generate').length, 1)
    assert.equal(calls.filter(call => call.phase === 'publish').length, 0)
  } finally { repository.close() }
})

test('queued publications continue automatic readback until native publication without a second create', async () => {
  const repository = createRepository(':memory:'); const calls = []; const profile = profileFixture(repository)
  const services = servicesFixture(repository, calls); let creates = 0; let readbacks = 0
  services.publish = async () => { creates++; return { id: 'queued-receipt', status: 'scheduled', providerPostId: 'actual-provider-id', releaseUrl: null } }
  services.readback = async ctx => { readbacks++; assert.equal(ctx.run.publicationId, 'queued-receipt'); return { id: 'queued-receipt', status: readbacks === 1 ? 'scheduled' : 'published', providerPostId: 'actual-provider-id', releaseUrl: readbacks === 1 ? null : 'https://example.com/native-post' } }
  try {
    const queued = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(queued.results[0].status, 'awaiting_receipt'); assert.equal(queued.results[0].publicationId, 'queued-receipt'); assert.equal(queued.results[0].releaseUrl, null)
    const pending = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(pending.results[0].status, 'awaiting_receipt'); assert.equal(pending.results[0].providerPostId, 'actual-provider-id'); assert.equal(pending.results[0].releaseUrl, null)
    const published = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(published.results[0].status, 'completed'); assert.equal(published.results[0].releaseUrl, 'https://example.com/native-post')
    await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(creates, 1); assert.equal(readbacks, 2)
  } finally { repository.close() }
})

async function evergreenDemoFixture(repository) {
  const fixture = await createDemoFixture(repository); const context = fixture.contexts[0]
  const at = new Date('2026-11-10T06:00:00Z')
  const profile = repository.studioPut(fixture.owner, 'account_profile', context.profile.id, { ...context.profile, platform: 'LinkedIn', timezone: 'Asia/Calcutta', weeklyCadence: 3, dailyNews: true, maxDailyPosts: 1 }, context.profile.revision)
  const profileHash = costScopeHash(profile, null)
  const run = repository.studioPut(fixture.owner, 'automation_run', context.run.id, { ...context.run, profileHash, actorUid: fixture.owner, localDate: '2026-11-10', slot: { kind: 'evergreen-demo', index: 0 }, stage: 'generate', status: 'pending', stages: [], topic: { title: 'Evergreen source-backed explanation', eventDate: null } }, context.run.revision)
  const authorization = repository.studioPut(fixture.owner, 'automation_demo', fixture.demoId, { ...fixture.authorization, authorizedAt: new Date(at.getTime() - 1000).toISOString(), expiresAt: new Date(at.getTime() + 3600000).toISOString(), runs: fixture.authorization.runs.map(binding => binding.runId === run.id ? { ...binding, profileHash } : binding) }, fixture.authorization.revision)
  return { ...fixture, profile, run, authorization, at }
}

test('today’s explicitly authorized evergreen demo uses its saved run without relabelling news or changing blocked history', async () => {
  const repository = createRepository(':memory:'); const calls = []
  try {
    const fixture = await evergreenDemoFixture(repository); const { owner, profile, run, at } = fixture
    const newsId = createHash('sha256').update(`${profile.accountId}:2026-11-10:news:0`).digest('hex').slice(0, 32)
    const oldNews = repository.studioPut(owner, 'automation_run', newsId, { accountId: profile.accountId, localDate: '2026-11-10', slot: { kind: 'news', index: 0 }, status: 'blocked', stage: 'research' }, 0)
    repository.studioPut('__automation_registry__', 'automation_owner', owner, { ownerScope: owner, enabled: true }, 0)
    const services = servicesFixture(repository, calls)
    services.generate = async ctx => { calls.push({ phase: 'generate', requestId: ctx.requestId }); const pack = repository.studioGet(owner, 'package', run.packageId); return repository.studioPut(owner, 'package', pack.id, { ...pack, content: { website: { title: 'A qualified evergreen explanation' } } }, pack.revision) }
    const result = await runRegisteredAutomation({ repository, services, now: at, limit: 1 })
    assert.equal(result.outcomes[0].results[0].id, run.id)
    assert.equal(result.outcomes[0].results[0].slot.kind, 'evergreen-demo')
    assert.equal(result.outcomes[0].results[0].topic.eventDate, null)
    assert.deepEqual(calls.map(call => call.phase), ['generate', 'review', 'render', 'publish'])
    assert.deepEqual(repository.studioGet(owner, 'automation_run', newsId), oldNews)
  } finally { repository.close() }
})

test('expired, blocked or mismatched current-day evergreen demos hold without a free fallback and do not block future days', async () => {
  for (const invalid of ['expired', 'mismatched', 'blocked']) {
    const repository = createRepository(':memory:'); const calls = []
    try {
      const { owner, profile, run, authorization, demoId, at } = await evergreenDemoFixture(repository)
      repository.studioPut(owner, 'automation_demo', demoId, { ...authorization, ...(invalid === 'expired' ? { expiresAt: new Date(at.getTime() - 1).toISOString() } : invalid === 'blocked' ? { status: 'blocked' } : { runs: authorization.runs.map(binding => binding.runId === run.id ? { ...binding, sourceContentHash: 'f'.repeat(64) } : binding) }) }, authorization.revision)
      const outcome = await runAccountAutomation({ repository, owner, profile, services: servicesFixture(repository, calls), now: at, maxStages: 1 })
      assert.equal(outcome.results[0].id, run.id)
      assert.equal(outcome.results[0].status, 'held')
      assert.deepEqual(calls, [])
      assert.equal(repository.studioGet(owner, 'automation_run', run.id).revision, run.revision)
      const tomorrow = new Date(at.getTime() + 86400000)
      const future = await runAccountAutomation({ repository, owner, profile, services: servicesFixture(repository, calls), now: tomorrow, maxStages: 1 })
      assert.notEqual(future.results[0].id, run.id)
      assert.deepEqual(calls.map(call => call.phase), ['research'])
    } finally { repository.close() }
  }
})

test('an existing uncertain daily publication blocks evergreen demo spending before any stage', async () => {
  const repository = createRepository(':memory:'); const calls = []
  try {
    const { owner, profile, run, at } = await evergreenDemoFixture(repository)
    repository.studioPut(owner, 'social_publication', 'existing-held-post', { accountId: profile.accountId, status: 'dispatch_unknown', publishAt: at.toISOString() }, 0)
    const result = await runAccountAutomation({ repository, owner, profile, services: servicesFixture(repository, calls), now: at })
    assert.equal(result.results[0].status, 'skipped'); assert.equal(calls.length, 0)
    assert.equal(repository.studioGet(owner, 'automation_run', run.id).revision, run.revision)
  } finally { repository.close() }
})
