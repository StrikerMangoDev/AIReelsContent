import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { planAccountWeek, runAccountAutomation, runRegisteredAutomation } from '../automation/runner.js'

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
