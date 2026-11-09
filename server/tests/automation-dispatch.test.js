import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutomationHandler, dispatchAutomation } from '../../api/automation.js'
import { automationRegistryOwner } from '../automation/runner.js'
import { env } from '../config/env.js'

const secret = 'acceptance-test-only-automation-secret'
function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value }, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
}
const request = (method = 'POST', body = { owner: 'owner-a', profileId: 'profile-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1' }, authorization = `Bearer ${secret}`) => ({ method, body, headers: { authorization } })
const config = { CRON_SECRET: secret, CONTENT_ACCOUNT_AUTOMATION: 'true' }

test('automation rejects unauthorized, disabled and unregistered work before execution', async () => {
  let reads = 0; let runs = 0
  const repository = { studioGet: async () => { reads++; return null } }
  const handler = createAutomationHandler({ repository, config, retain: () => assert.fail('No work should be retained'), execute: async () => { runs++ } })
  for (const token of ['', 'Bearer wrong', `Bearer ${secret} `]) {
    const reply = response(); await handler(request('POST', undefined, token), reply)
    assert.equal(reply.statusCode, 401)
  }
  assert.equal(reads, 0); assert.equal(runs, 0)
  const disabled = createAutomationHandler({ repository, config: { ...config, CONTENT_ACCOUNT_AUTOMATION: 'false' }, execute: async () => { runs++ } })
  const reply = response(); await disabled(request(), reply); assert.equal(reply.statusCode, 503)
  assert.equal(reads, 0); assert.equal(runs, 0)
  const denied = response(); await handler(request(), denied); assert.equal(denied.statusCode, 403)
  assert.equal(runs, 0)
})

test('automation requires current account consent and rejects forged body capabilities', async () => {
  let runs = 0
  const registry = { enabled: true, ownerScope: 'owner-a' }
  let profile = { id: 'profile-a', accountId: 'account-a', enabled: false, automationConsent: true }
  const repository = { studioGet: async (owner, kind) => owner === automationRegistryOwner && kind === 'automation_owner' ? registry : profile }
  const handler = createAutomationHandler({ repository, config, retain: () => assert.fail('Denied work must not be retained'), execute: async () => { runs++ } })
  const disabled = response(); await handler(request(), disabled); assert.equal(disabled.statusCode, 403)
  profile = { ...profile, enabled: true, automationConsent: false }
  const noConsent = response(); await handler(request(), noConsent); assert.equal(noConsent.statusCode, 403)
  for (const body of [{ owner: '', profileId: 'profile-a' }, { owner: 'owner-a', profileId: '' }, { owner: 'owner-a', profileId: 'profile-a', requestId: 'x'.repeat(101) }, { owner: 'owner-a', profileId: 'profile-a', repository: { forged: true } }]) {
    const invalid = response(); await handler(request('POST', body), invalid); assert.equal(invalid.statusCode, 400)
  }
  assert.equal(runs, 0)
})

test('GET fanout admits enabled owners and POST retains exactly one stage before deferred continuation', async () => {
  const retained = []; const dispatched = []; const executed = []
  const profile = { id: 'profile-a', accountId: 'account-a', enabled: true, automationConsent: true }
  const repository = {
    studioList: async (owner, kind) => { assert.equal(owner, automationRegistryOwner); assert.equal(kind, 'automation_owner'); return [{ enabled: true, ownerScope: 'owner-a' }, { enabled: false, ownerScope: 'disabled' }, { enabled: true, ownerScope: 'owner-b' }, { enabled: true }] },
    studioGet: async (owner, kind, id) => kind === 'automation_owner' ? { enabled: true, ownerScope: owner } : (assert.equal(id, 'profile-a'), profile),
  }
  let finish
  const handler = createAutomationHandler({ repository, config, retain: promise => retained.push(promise), dispatch: async (input, repo, retain) => { assert.equal(repo, repository); dispatched.push(input); if (!input.accountIds) retain(Promise.resolve()) }, execute: input => { executed.push(input); return new Promise(resolve => { finish = resolve }) } })
  const get = response(); await handler(request('GET'), get)
  assert.equal(get.statusCode, 202); assert.equal(get.body.workspaces, 2)
  assert.deepEqual(dispatched.map(item => item.owner), ['owner-a', 'owner-b']); assert.equal(retained.length, 2)
  retained.length = 0; dispatched.length = 0
  const post = response(); await handler(request(), post)
  assert.equal(post.statusCode, 202); assert.equal(executed.length, 1); assert.equal(retained.length, 1)
  assert.equal(executed[0].repository, repository); assert.equal(dispatched.length, 0)
  finish({ deferred: true }); await retained[0]
  assert.deepEqual(dispatched, [{ owner: 'owner-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1', accountIds: ['account-a'] }])
})

test('dispatcher retains owner/account-specific network work without waiting for transport', async () => {
  const prior = { CONTENT_ACCOUNT_AUTOMATION: env.CONTENT_ACCOUNT_AUTOMATION, CRON_SECRET: env.CRON_SECRET }
  env.CONTENT_ACCOUNT_AUTOMATION = 'true'; env.CRON_SECRET = secret
  const retained = []; const calls = []; let finish
  try {
    const repository = { studioList: async () => [{ id: 'profile-a', accountId: 'account-a', enabled: true, automationConsent: true }, { id: 'profile-b', accountId: 'account-b', enabled: true, automationConsent: true }, { id: 'profile-c', accountId: 'account-a', enabled: false, automationConsent: true }] }
    await dispatchAutomation({ owner: 'owner-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1', accountIds: ['account-a'] }, repository, promise => retained.push(promise), (url, options) => { calls.push({ url, options }); return new Promise(resolve => { finish = resolve }) })
    assert.equal(calls.length, 1); assert.equal(retained.length, 1)
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`)
    assert.deepEqual(JSON.parse(calls[0].options.body), { owner: 'owner-a', profileId: 'profile-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1' })
    finish({ ok: true }); await retained[0]
  } finally { Object.assign(env, prior) }
})
