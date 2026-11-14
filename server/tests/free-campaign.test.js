import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { platforms } from '../studio/content.js'
import { costScopeHash } from '../budget/policy.js'
import { runAccountAutomation, runRegisteredAutomation } from '../automation/runner.js'
import { freeCampaignSchema, freeCampaignRunId, currentFreeCampaign, assertFreeCampaign } from '../automation/campaign.js'

let now = new Date()
function fixture() {
  const repository = createRepository(':memory:')
  const profiles = platforms.map(platform => repository.studioPut('alice', 'account_profile', `profile-${platform}`, { accountId: `account-${platform}`, platform, timezone: 'Asia/Calcutta', audience: `${platform} audience`, tone: 'Clear', weeklyBrief: 'Explain the approved publisher announcement and its limits.', contentPillars: ['AI'], weeklyCadence: 0, dailyNews: false, maxDailyPosts: 1, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice', paidBudgetMicros: 0 } }, 0))
  const accounts = profiles.map(profile => ({ ownerScope: 'alice', accountId: profile.accountId, platform: profile.platform, provider: profile.platform.toLowerCase(), name: profile.platform }))
  const previous = process.env.POSTIZ_ACCOUNTS_JSON; process.env.POSTIZ_ACCOUNTS_JSON = JSON.stringify(accounts)
  const data = { id: 'new-topic-campaign', version: 'free-one-off-campaign-v1', status: 'active', actorUid: 'alice', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(), referenceUrl: 'https://www.anthropic.com/approved-publisher-reference', topic: 'An approved AI announcement', accountIds: profiles.map(item => item.accountId), profileBindings: profiles.map(item => ({ profileId: item.id, accountId: item.accountId, profileHash: costScopeHash(item, null) })), freeOnly: true, paidBudgetMicros: 0, maxRuns: 5 }
  const campaign = repository.studioPut('alice', 'automation_campaign', data.id, freeCampaignSchema.parse(data), 0)
  now = new Date(campaign.createdAt)
  const calls = []
  const record = (phase, ctx) => { assert.equal(ctx.freeOnly, true); assert.equal(ctx.paidBudgetMicros, 0); assert.equal(ctx.run.campaignId, data.id); assert.equal(ctx.run.campaignReferenceUrl, data.referenceUrl); assert.equal(ctx.run.campaignTopic, data.topic); calls.push(`${ctx.profile.platform}:${phase}`) }
  const services = {
    research: async ctx => { record('research', ctx); return { reportId: `research-${ctx.profile.accountId}`, topics: [{ title: ctx.run.campaignTopic, evidenceHash: 'captured-source-hash', evidenceIds: ['E1'] }] } },
    generate: async ctx => { record('generate', ctx); return repository.studioPut('alice', 'package', `package-${ctx.profile.accountId}`, { content: { website: { title: 'Controlled announcement' } } }, 0) },
    review: async ctx => { record('review', ctx); return { eligible: true } },
    render: async ctx => { record('render', ctx); return { assets: [{ id: `asset-${ctx.profile.accountId}` }] } },
    publish: async ctx => { record('publish', ctx); return { id: `receipt-${ctx.profile.accountId}`, status: 'published', providerPostId: `controlled-${ctx.profile.accountId}`, releaseUrl: `https://${{ Facebook: 'facebook.com', Instagram: 'instagram.com', X: 'x.com', LinkedIn: 'linkedin.com', YouTube: 'youtube.com' }[ctx.profile.platform]}/controlled-post` } },
  }
  return { repository, profiles, accounts, data, campaign, services, calls, close() { repository.close(); if (previous === undefined) delete process.env.POSTIZ_ACCOUNTS_JSON; else process.env.POSTIZ_ACCOUNTS_JSON = previous } }
}

test('free campaign runs one stable five-stage pipeline per platform despite old blocked daily slots and preserves zero paid ceiling', async () => {
  const h = fixture()
  try {
    for (const profile of h.profiles) {
      h.repository.studioPut('alice', 'automation_run', `old-${profile.id}`, { accountId: profile.accountId, localDate: new Intl.DateTimeFormat('en-CA', { timeZone: profile.timezone }).format(now), slot: { kind: 'news', index: 0 }, status: 'blocked', stage: 'research' }, 0)
      for (let stage = 0; stage < 5; stage++) {
        const result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now, maxStages: 1 })
        assert.equal(result.results[0].id, freeCampaignRunId('alice', h.data.id, profile.accountId))
        assert.equal(result.results[0].status, stage === 4 ? 'completed' : 'pending')
        assert.equal(result.deferred, stage !== 4)
      }
      const count = h.calls.length
      const repeat = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
      assert.equal(repeat.results[0].status, profile === h.profiles.at(-1) ? 'held' : 'completed'); assert.equal(h.calls.length, count)
      assert.equal(h.repository.studioGet('alice', 'automation_run', `old-${profile.id}`).status, 'blocked')
    }
    assert.equal(h.calls.length, 25)
    assert.equal(h.repository.studioList('alice', 'automation_run').filter(item => item.campaignId === h.data.id).length, 5)
    assert.equal(h.repository.studioGet('alice', 'automation_campaign', h.data.id).status, 'completed')
    assert.equal(h.repository.studioGet('alice', 'automation_campaign', h.data.id).completion, 'all_published')
  } finally { h.close() }
})

test('campaign rejects unbounded, paid, duplicate, private-reference and cross-owner scopes', async () => {
  const h = fixture()
  try {
    for (const patch of [
      { freeOnly: false }, { paidBudgetMicros: 1 }, { maxRuns: 6 }, { expiresAt: new Date(Date.parse(h.data.createdAt) + 25 * 3600000).toISOString() },
      { accountIds: [h.data.accountIds[0], h.data.accountIds[0]] },
      { referenceUrl: 'https://127.0.0.1/private' }, { referenceUrl: 'https://[::1]/private' }, { referenceUrl: 'https://localhost/private' }, { referenceUrl: 'https://user:password@example.com/private' },
    ]) assert.equal(freeCampaignSchema.safeParse({ ...h.data, ...patch }).success, false)
    h.repository.studioPut('outsider', 'automation_campaign', h.data.id, h.data, 0)
    const foreign = await currentFreeCampaign({ repository: h.repository, owner: 'outsider', profile: h.profiles[0], now, accounts: h.accounts })
    assert.equal(foreign.held, true)
    const mismatched = await currentFreeCampaign({ repository: h.repository, owner: 'alice', profile: { ...h.profiles[0], tone: 'Changed' }, now, accounts: h.accounts })
    assert.equal(mismatched.held, true)
  } finally { h.close() }
})

test('revocation, expiry, changed bindings and conflicting campaigns hold instead of dispatching an ordinary fallback', async () => {
  for (const defect of ['revoked', 'expired', 'future', 'binding', 'conflict', 'mapping']) {
    const h = fixture()
    try {
      if (defect === 'binding') { const p = h.profiles[4]; h.repository.studioPut('alice', 'account_profile', p.id, { ...p, tone: 'Changed after authorization' }, p.revision) }
      else if (defect === 'mapping') process.env.POSTIZ_ACCOUNTS_JSON = JSON.stringify(h.accounts.slice(0, 4))
      else if (defect === 'conflict') h.repository.studioPut('alice', 'automation_campaign', 'another-campaign', { ...h.data, id: 'another-campaign' }, 0)
      else h.repository.studioPut('alice', 'automation_campaign', h.campaign.id, { ...h.campaign, ...(defect === 'revoked' ? { status: 'revoked' } : defect === 'expired' ? { expiresAt: new Date(now.getTime() - 1000).toISOString() } : { expiresAt: new Date(now.getTime() + 25 * 3600000).toISOString() }) }, h.campaign.revision)
      const result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile: { ...h.profiles[0], dailyNews: true }, services: h.services, now })
      assert.equal(result.results[0].status, 'held', defect); assert.equal(h.calls.length, 0)
    } finally { h.close() }
  }
})

test('campaign authorization is rechecked between stages and daily publication caps are not increased', async () => {
  const h = fixture()
  try {
    const profile = h.profiles[0]
    const original = h.services.research
    h.services.research = async ctx => { const result = await original(ctx); const record = h.repository.studioGet('alice', 'automation_campaign', h.data.id); h.repository.studioPut('alice', 'automation_campaign', record.id, { ...record, status: 'revoked' }, record.revision); return result }
    const revoked = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
    assert.equal(revoked.results[0].status, 'blocked'); assert.deepEqual(h.calls, [`${profile.platform}:research`])
    const run = h.repository.studioGet('alice', 'automation_run', freeCampaignRunId('alice', h.data.id, profile.accountId))
    await assert.rejects(assertFreeCampaign({ repository: h.repository, owner: 'alice', profile, run, actorUid: 'alice' }, { now, accounts: h.accounts }), /inactive/)
  } finally { h.close() }
  const capped = fixture()
  try {
    const profile = capped.profiles[0]
    capped.repository.studioPut('alice', 'social_publication', 'existing', { accountId: profile.accountId, status: 'dispatch_unknown', createdAt: now.toISOString() }, 0)
    const outcome = await runAccountAutomation({ repository: capped.repository, owner: 'alice', profile, services: capped.services, now })
    assert.equal(outcome.results[0].status, 'skipped'); assert.equal(capped.calls.length, 0)
  } finally { capped.close() }
})

test('registered automation discovers a free campaign even when ordinary calendar has no slots', async () => {
  const h = fixture()
  try {
    h.repository.studioPut('__automation_registry__', 'automation_owner', 'alice', { ownerScope: 'alice', enabled: true }, 0)
    const outcome = await runRegisteredAutomation({ repository: h.repository, services: h.services, now, limit: 5 })
    assert.equal(outcome.outcomes.length, 5); assert.equal(h.calls.length, 25)
  } finally { h.close() }
})

test('campaign submission automatically requests bounded delayed readback until a native published URL without another create', async () => {
  const h = fixture()
  try {
    const profile = h.profiles[0]; let creates = 0; let reads = 0
    h.services.publish = async () => { creates++; return { id: 'receipt', status: 'submitted', providerPostId: 'provider-post' } }
    h.services.readback = async () => { reads++; return { status: reads === 1 ? 'scheduled' : 'published', providerPostId: 'provider-post', releaseUrl: reads === 1 ? null : 'https://www.facebook.com/native-published-post' } }
    let result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
    assert.equal(result.results[0].status, 'awaiting_receipt'); assert.equal(result.deferred, true); assert.equal(result.retryAfterMs, 10000)
    result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
    assert.equal(reads, 0, 'Backoff cannot be bypassed by an early invocation')
    result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now: new Date(now.getTime() + 10000) })
    assert.equal(reads, 1); assert.equal(result.results[0].status, 'awaiting_receipt'); assert.equal(result.retryAfterMs, 10000)
    result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now: new Date(now.getTime() + 20000) })
    assert.equal(result.results[0].status, 'completed'); assert.equal(result.results[0].releaseUrl, 'https://www.facebook.com/native-published-post'); assert.equal(result.deferred, false)
    assert.equal(result.results[0].receiptPolling.attempts, 2); assert.equal(creates, 1)
  } finally { h.close() }
})

test('eight campaign readback attempts retain unavailable or draft provider state and do not create again', async () => {
  const h = fixture()
  try {
    const profile = h.profiles[0]; let creates = 0; let reads = 0
    h.services.publish = async () => { creates++; return { id: 'receipt', status: 'submitted', providerPostId: 'provider-post' } }
    h.services.readback = async () => { reads++; if (reads % 2) throw new Error('Uncertain provider readback'); return { status: 'draft', providerPostId: 'provider-post', releaseUrl: null } }
    await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
    let result
    for (let index = 1; index <= 8; index++) result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now: new Date(now.getTime() + index * 10000) })
    assert.equal(reads, 8); assert.equal(creates, 1); assert.equal(result.results[0].status, 'awaiting_receipt'); assert.equal(result.deferred, false)
    assert.equal(result.results[0].receiptPolling.attempts, 8); assert.equal(result.results[0].releaseUrl, null)
    await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now: new Date(now.getTime() + 90000) })
    assert.equal(reads, 8); assert.equal(creates, 1)
  } finally { h.close() }
})

test('campaign revocation before receipt polling preserves the pending post and prevents a readback or resubmit', async () => {
  const h = fixture()
  try {
    const profile = h.profiles[0]; let reads = 0; let creates = 0
    h.services.publish = async () => { creates++; return { id: 'receipt', status: 'submitted', providerPostId: 'provider-post' } }
    h.services.readback = async () => { reads++; return { status: 'published', releaseUrl: 'https://www.facebook.com/post' } }
    const first = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
    const campaign = h.repository.studioGet('alice', 'automation_campaign', h.data.id)
    h.repository.studioPut('alice', 'automation_campaign', campaign.id, { ...campaign, status: 'revoked' }, campaign.revision)
    const result = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now: new Date(now.getTime() + 10000) })
    assert.equal(result.results[0].status, 'held'); assert.equal(reads, 0); assert.equal(creates, 1)
    assert.equal(h.repository.studioGet('alice', 'automation_run', first.results[0].id).status, 'awaiting_receipt')
  } finally { h.close() }
})

test('concurrent campaign receipt workers share a lease and retain backoff instead of issuing duplicate polls', async () => {
  const h = fixture()
  try {
    const profile = h.profiles[0]; let reads = 0; let started; let finish
    const entered = new Promise(resolve => { started = resolve })
    h.services.publish = async () => ({ id: 'receipt', status: 'submitted', providerPostId: 'provider-post' })
    h.services.readback = async () => { reads++; started(); return new Promise(resolve => { finish = resolve }) }
    await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
    const pollNow = new Date(now.getTime() + 10000)
    const first = runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now: pollNow })
    await entered
    const second = await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now: pollNow })
    assert.equal(reads, 1); assert.equal(second.results[0].status, 'awaiting_receipt'); assert.equal(second.retryAfterMs, 10000)
    finish({ status: 'published', providerPostId: 'provider-post', releaseUrl: 'https://www.facebook.com/native-post' })
    assert.equal((await first).results[0].status, 'completed'); assert.equal(reads, 1)
  } finally { h.close() }
})

async function failedCampaignFixture() {
  const h = fixture()
  h.services.generate = async () => { throw Object.assign(new Error('Confirmed validation failure; no publication was attempted.'), { preDispatch: true }) }
  for (const profile of h.profiles) await runAccountAutomation({ repository: h.repository, owner: 'alice', profile, services: h.services, now })
  assert.equal(h.repository.studioGet('alice', 'automation_campaign', h.data.id).completion, 'finished_with_blocks')
  const replacement = { ...h.data, id: 'replacement-campaign', supersedesCampaignId: h.data.id, createdAt: new Date().toISOString() }
  h.repository.studioPut('alice', 'automation_campaign', replacement.id, freeCampaignSchema.parse(replacement), 0)
  now = new Date()
  return h
}

test('an explicit single-level replacement may supersede a completed all-account failure with no publication side effects', async () => {
  const h = await failedCampaignFixture()
  try {
    const prior = h.repository.studioGet('alice', 'automation_campaign', h.data.id)
    const runs = h.repository.studioList('alice', 'automation_run')
    const selection = await currentFreeCampaign({ repository: h.repository, owner: 'alice', profile: h.profiles[0], now, accounts: h.accounts })
    assert.equal(selection.campaign.id, 'replacement-campaign')
    assert.equal(selection.campaign.supersedesCampaignId, h.data.id)
    assert.notEqual(selection.runId, runs[0].id)
    assert.deepEqual(h.repository.studioGet('alice', 'automation_campaign', h.data.id), prior)
    assert.deepEqual(h.repository.studioList('alice', 'automation_run'), runs, 'Supersession never resets old runs')
    assert.equal(h.repository.studioList('alice', 'social_publication').length, 0)
  } finally { h.close() }
})

test('publication attempts, uncertain runs, changed old authorization and replacement chains cannot be superseded', async () => {
  for (const defect of ['published-id', 'publication-record', 'orphan-publication-record', 'unknown', 'old-source-edited', 'old-policy-edited', 'chain', 'unrelated-active']) {
    const h = await failedCampaignFixture()
    try {
      const run = h.repository.studioList('alice', 'automation_run')[0]
      if (defect === 'published-id') h.repository.studioPut('alice', 'automation_run', run.id, { ...run, providerPostId: 'provider-post' }, run.revision)
      if (defect === 'unknown') h.repository.studioPut('alice', 'automation_run', run.id, { ...run, status: 'dispatch_unknown' }, run.revision)
      if (defect === 'publication-record') {
        h.repository.studioPut('alice', 'automation_run', run.id, { ...run, packageId: 'old-package' }, run.revision)
        h.repository.studioPut('alice', 'social_publication', 'old-receipt', { packageId: 'old-package', status: 'blocked' }, 0)
      }
      if (defect === 'orphan-publication-record') h.repository.studioPut('alice', 'social_publication', 'orphan-receipt', { packageId: createHash('sha256').update(`${run.id}:package`).digest('hex').slice(0, 32), status: 'dispatch_unknown' }, 0)
      if (defect === 'old-source-edited' || defect === 'old-policy-edited' || defect === 'chain') {
        const old = h.repository.studioGet('alice', 'automation_campaign', h.data.id)
        h.repository.studioPut('alice', 'automation_campaign', old.id, { ...old, ...(defect === 'old-source-edited' ? { referenceUrl: 'https://example.com/changed-after-failure' } : defect === 'old-policy-edited' ? { profileBindings: old.profileBindings.map((item, index) => index ? item : { ...item, profileHash: '0'.repeat(64) }) } : { supersedesCampaignId: 'a-prior-campaign' }) }, old.revision)
      }
      if (defect === 'unrelated-active') h.repository.studioPut('alice', 'automation_campaign', 'other-active', { ...h.data, id: 'other-active' }, 0)
      const selection = await currentFreeCampaign({ repository: h.repository, owner: 'alice', profile: h.profiles[0], now, accounts: h.accounts })
      assert.equal(selection.held, true, defect)
    } finally { h.close() }
  }
})
