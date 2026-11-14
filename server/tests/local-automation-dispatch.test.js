import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { automationRegistryOwner } from '../automation/runner.js'
import { localAutomationDispatcher } from '../automation/local-dispatch.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const flush = async () => { for (let i = 0; i < 8; i++) await tick() }
function fixture({ owner = 'alice', actor = 'alice', accountIds = ['account-one'], status = 'queued' } = {}) {
  const repository = createRepository(':memory:')
  if (owner.startsWith('ws:')) repository.studioPut('__workspace_control__', 'workspace', owner, { members: [{ uid: actor, role: 'owner' }] }, 0)
  const profiles = accountIds.map((accountId, index) => repository.studioPut(owner, 'account_profile', `profile-${index}`, { accountId, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: actor, paidBudgetMicros: 0 } }, 0))
  repository.studioPut(automationRegistryOwner, 'automation_owner', owner, { enabled: true }, 0)
  const request = repository.studioPut(owner, 'automation_request', randomUUID(), { status, actorUid: actor, accountIds }, 0)
  const input = { owner, actorUid: actor, requestId: request.id, accountIds }
  const options = { repository, enabled: 'true', host: '127.0.0.1', nodeEnv: 'development', config: { CONTENT_ACCOUNT_AUTOMATION: 'true' } }
  const current = () => repository.studioGet(owner, 'automation_request', request.id)
  const update = (kind, id, patch, scope = owner) => { const previous = repository.studioGet(scope, kind, id); return repository.studioPut(scope, kind, id, { ...previous, ...patch }, previous.revision) }
  return { repository, owner, actor, request, profiles, input, options, current, update }
}
function dispatchFor(value, run, extra = {}) {
  let finished
  const done = new Promise(resolve => { finished = resolve })
  const reports = []
  const dispatch = localAutomationDispatcher({ ...value.options, run, pause: async () => {}, ...extra, report: entry => { reports.push(entry); finished(); extra.report?.(entry) } })
  return { dispatch, reports, done: async () => { await done; await flush() } }
}

test('local account dispatch requires separate opt-in, owner automation flag, loopback and a non-hosted development process', () => {
  const value = fixture()
  try {
    for (const override of [{ enabled: undefined }, { enabled: 'false' }, { host: '0.0.0.0' }, { host: '127.0.0.2' }, { nodeEnv: 'production' }, { vercel: '1' }, { config: { CONTENT_ACCOUNT_AUTOMATION: 'false' } }]) assert.equal(localAutomationDispatcher({ ...value.options, ...override }), undefined)
    assert.equal(typeof localAutomationDispatcher(value.options), 'function')
    assert.equal(value.current().status, 'queued')
  } finally { value.repository.close() }
})

test('explicit local admission runs only its queued request, continues bounded stages and ignores duplicates without scanning backlog', async () => {
  const value = fixture(); let calls = 0
  try {
    const old = value.repository.studioPut(value.owner, 'automation_request', randomUUID(), { status: 'queued', actorUid: value.actor, accountIds: value.input.accountIds }, 0)
    const h = dispatchFor(value, async args => {
      calls++; assert.equal(args.owner, value.owner); assert.equal(args.requestId, value.request.id); assert.equal(args.profileId, value.profiles[0].id)
      return { results: [{ id: 'saved-run', status: calls < 3 ? 'pending' : 'completed' }], deferred: calls < 3 }
    })
    await flush(); assert.equal(calls, 0)
    assert.equal(h.dispatch(value.input), undefined)
    h.dispatch(value.input)
    await h.done()
    assert.equal(calls, 3); assert.equal(value.current().status, 'completed')
    assert.equal(value.current().outcomes.length, 1, 'Keep the latest account outcome rather than duplicating every stage payload')
    assert.equal(value.repository.studioGet(value.owner, 'automation_request', old.id).status, 'queued')
    assert.equal(value.repository.studioList(value.owner, 'social_publication').length, 0, 'A completed local execution is not a fabricated publication receipt')
  } finally { value.repository.close() }
})

test('durable claim prevents two local dispatcher instances from executing the same request', async () => {
  const value = fixture(); let entered; let release; let calls = 0
  const started = new Promise(resolve => { entered = resolve }); const held = new Promise(resolve => { release = resolve })
  try {
    const run = async () => { calls++; entered(); await held; return { results: [{ status: 'completed' }] } }
    const first = dispatchFor(value, run); const second = dispatchFor(value, run)
    first.dispatch(value.input); second.dispatch(value.input)
    await started; await flush(); assert.equal(calls, 1)
    release(); await first.done(); await flush()
    assert.equal(value.current().status, 'completed'); assert.equal(calls, 1)
  } finally { release(); value.repository.close() }
})

test('all selected account profiles finish independently without replacing their saved request scope', async () => {
  const value = fixture({ accountIds: ['account-one', 'account-two', 'account-three', 'account-four', 'account-five'] }); const calls = []
  try {
    const h = dispatchFor(value, async ({ profileId }) => { calls.push(profileId); return { results: [{ id: `${profileId}-run`, status: 'completed' }] } })
    h.dispatch(value.input); await h.done()
    assert.deepEqual(calls, value.profiles.map(profile => profile.id)); assert.equal(value.current().outcomes.length, 5)
    assert.deepEqual(value.current().accountIds, value.input.accountIds); assert.equal(value.current().status, 'completed')
  } finally { value.repository.close() }
  const changed = fixture({ accountIds: ['first', 'second'] })
  try {
    changed.update('automation_request', changed.request.id, { accountIds: ['first', 'first'] })
    const h = dispatchFor(changed, async () => assert.fail('Duplicate saved IDs cannot substitute an unrequested account'))
    h.dispatch(changed.input); await flush(); assert.equal(changed.current().status, 'queued')
  } finally { changed.repository.close() }
})

test('unconfirmed references and requests already running, uncertain or terminal never start an account stage', async () => {
  for (const status of ['running', 'dispatch_unknown', 'blocked', 'completed', 'queued']) {
    const value = fixture({ status }); let calls = 0
    try {
      const h = dispatchFor(value, async () => { calls++; return {} })
      for (const patch of [{ actorUid: 'another-user' }, { accountIds: ['another-account'] }, { owner: 'another-workspace' }]) h.dispatch({ ...value.input, ...patch })
      if (status !== 'queued') h.dispatch(value.input)
      assert.throws(() => h.dispatch({ ...value.input, accountIds: ['account-one', 'account-one'] }), /Invalid local automation reference/)
      await flush(); assert.equal(calls, 0); assert.equal(value.current().status, status)
    } finally { value.repository.close() }
  }
})

test('missing registry, revoked owner, disabled consent, foreign consent or duplicate account profiles block before execution', async () => {
  for (const change of ['registry', 'owner', 'enabled', 'consent', 'foreign-actor', 'paid-policy', 'duplicate-profile']) {
    const value = fixture({ owner: `ws:${randomUUID()}` }); let calls = 0
    try {
      if (change === 'registry') value.update('automation_owner', value.owner, { enabled: false }, automationRegistryOwner)
      else if (change === 'owner') value.update('workspace', value.owner, { members: [{ uid: value.actor, role: 'editor' }] }, '__workspace_control__')
      else if (change === 'duplicate-profile') value.repository.studioPut(value.owner, 'account_profile', 'duplicate', { ...value.profiles[0] }, 0)
      else value.update('account_profile', value.profiles[0].id, change === 'enabled' ? { enabled: false } : change === 'consent' ? { automationConsent: false } : { automaticPolicy: { ...value.profiles[0].automaticPolicy, ...(change === 'paid-policy' ? { paidBudgetMicros: 5000000 } : { consentedBy: 'another-user' }) } })
      const h = dispatchFor(value, async () => { calls++; return {} }); h.dispatch(value.input); await h.done()
      assert.equal(calls, 0, change); assert.equal(value.current().status, 'blocked', change)
    } finally { value.repository.close() }
  }
})

test('every continuation rechecks original owner, consent, profile scope and dispatcher flag', async () => {
  for (const change of ['owner', 'consent', 'profile', 'flag']) {
    const value = fixture({ owner: `ws:${randomUUID()}` }); let calls = 0
    try {
      const h = dispatchFor(value, async () => { calls++; return { results: [{ status: 'pending' }], deferred: true } }, { pause: async ms => {
        if (calls !== 1) return
        if (change === 'owner') value.update('workspace', value.owner, { members: [] }, '__workspace_control__')
        else if (change === 'flag') value.options.config.CONTENT_ACCOUNT_AUTOMATION = 'false'
        else value.update('account_profile', value.profiles[0].id, change === 'consent' ? { automationConsent: false } : { weeklyBrief: 'Changed profile scope' })
        assert.equal(ms, 0)
      } })
      h.dispatch(value.input); await h.done()
      assert.equal(calls, 1, change); assert.equal(value.current().status, 'blocked', change)
    } finally { value.repository.close() }
  }
})

test('authorization is rechecked after an asynchronous stage and a superseded request is never overwritten', async () => {
  const value = fixture({ owner: `ws:${randomUUID()}` }); let calls = 0
  try {
    const h = dispatchFor(value, async () => {
      calls++; await tick(); value.update('workspace', value.owner, { members: [] }, '__workspace_control__')
      value.update('automation_request', value.request.id, { status: 'cancelled' })
      return { results: [{ status: 'pending' }], deferred: true }
    })
    h.dispatch(value.input); await h.done()
    assert.equal(calls, 1); assert.equal(value.current().status, 'cancelled')
  } finally { value.repository.close() }
})

test('unknown, held, busy or running stages never trigger a replacement dispatch or pretend publication completed', async () => {
  for (const status of ['dispatch_unknown', 'held', 'busy', 'generate_running', 'blocked', 'failed']) {
    const value = fixture(); let calls = 0
    try {
      const h = dispatchFor(value, async () => { calls++; value.repository.studioPut(value.owner, 'automation_run', 'original-run', { status }, 0); return { results: [{ id: 'original-run', status }], deferred: true } })
      h.dispatch(value.input); await h.done(); h.dispatch(value.input); await flush()
      assert.equal(calls, 1); assert.equal(value.current().status, 'blocked')
      assert.equal(value.repository.studioGet(value.owner, 'automation_run', 'original-run').status, status)
    } finally { value.repository.close() }
  }
})

test('receipt polling uses bounded waits, while unfinished receipt state remains distinct from completion', async () => {
  const value = fixture(); const waits = []; let calls = 0
  try {
    const h = dispatchFor(value, async () => { calls++; return { results: [{ status: 'awaiting_receipt' }], ...(calls === 1 ? { deferred: true, retryAfterMs: 999999999 } : {}) } }, { pause: async ms => waits.push(ms) })
    h.dispatch(value.input); await h.done()
    assert.equal(calls, 2); assert.deepEqual(waits, [0, 30000]); assert.equal(value.current().status, 'awaiting_receipt')
  } finally { value.repository.close() }
})

test('repeated pending stages stop at the hard pass bound and thrown provider details never enter saved errors', async () => {
  const value = fixture(); let calls = 0
  try {
    const h = dispatchFor(value, async () => { calls++; return { results: [{ status: 'pending' }], continuationPending: true } })
    h.dispatch(value.input); await h.done()
    assert.equal(calls, 96); assert.equal(value.current().status, 'blocked')
  } finally { value.repository.close() }
  const failed = fixture()
  try {
    const h = dispatchFor(failed, async () => { throw new Error('private credentials and provider body') }, { report: () => { throw new Error('private logger failure') } })
    h.dispatch(failed.input); await h.done()
    assert.equal(failed.current().status, 'blocked'); assert.equal(JSON.stringify(failed.current()).includes('private'), false)
  } finally { failed.repository.close() }
})
