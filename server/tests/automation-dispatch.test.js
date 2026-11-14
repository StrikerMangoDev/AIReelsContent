import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutomationHandler, dispatchAutomation } from '../../api/automation.js'
import { automationRegistryOwner } from '../automation/runner.js'
import { env } from '../config/env.js'

const secret = 'acceptance-test-only-automation-secret'
function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value }, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this }, end() { return this } }
}
const request = (method = 'POST', body = { owner: 'owner-a', profileId: 'profile-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1' }, authorization = `Bearer ${secret}`) => ({ method, body, headers: { authorization } })
const config = { CRON_SECRET: secret, CONTENT_ACCOUNT_AUTOMATION: 'true' }

test('HEAD authenticates federation only with cron authorization and cannot execute, dispatch or access storage', async () => {
  let authentications = 0
  const forbidden = () => assert.fail('Preflight cannot perform automation or repository work')
  const options = { repository: new Proxy({}, { get: forbidden }), config, execute: forbidden, dispatch: forbidden, retain: forbidden, authenticateVertex: async value => { assert.equal(value, config); authentications++ } }
  const handler = createAutomationHandler(options)
  const denied = response(); await handler(request('HEAD', undefined, 'Bearer wrong'), denied); assert.equal(denied.statusCode, 401); assert.equal(authentications, 0)
  const disabled = response(); await createAutomationHandler({ ...options, config: { ...config, CONTENT_ACCOUNT_AUTOMATION: 'false' } })(request('HEAD'), disabled); assert.equal(disabled.statusCode, 503); assert.equal(authentications, 0)
  const ready = response(); await handler(request('HEAD'), ready); assert.equal(ready.statusCode, 204); assert.equal(authentications, 1); assert.equal(ready.body, undefined)
  const failed = response(); await createAutomationHandler({ ...options, authenticateVertex: async () => { throw Object.assign(new Error('secret token and private body'), { authFailure: { phase: 'oidc_exchange', code: 'ETIMEDOUT', httpStatus: 504, private: 'secret' } }) } })(request('HEAD'), failed)
  assert.equal(failed.statusCode, 503); assert.equal(failed.headers['X-Vertex-Auth-Phase'], 'oidc_exchange'); assert.equal(failed.headers['X-Vertex-Auth-Code'], 'ETIMEDOUT'); assert.equal(failed.headers['X-Vertex-Auth-Status'], '504'); assert.equal(JSON.stringify(failed).includes('secret'), false)
})

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

test('GET fanout and POST await durable queue admission without executing inline', async () => {
  const dispatched = []; let inlineRuns = 0
  const profile = { id: 'profile-a', accountId: 'account-a', enabled: true, automationConsent: true }
  const repository = { studioList: async () => [{ enabled: true, ownerScope: 'owner-a' }], studioGet: async (_owner, kind) => kind === 'automation_owner' ? { enabled: true } : profile }
  const handler = createAutomationHandler({ repository, config, retain: () => {}, maintenance: async () => {}, execute: () => { inlineRuns++ }, dispatch: async input => { dispatched.push(input) } })
  const get = response(); await handler(request('GET'), get); assert.equal(get.statusCode, 202)
  const post = response(); await handler(request(), post); assert.equal(post.statusCode, 202)
  assert.equal(inlineRuns, 0)
  assert.deepEqual(dispatched, [{ owner: 'owner-a' }, { owner: 'owner-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1', accountIds: ['account-a'] }])
})

test('dispatcher durably admits references with stable dedupe and rejects transport failure visibly', async () => {
  const prior = { CONTENT_ACCOUNT_AUTOMATION: env.CONTENT_ACCOUNT_AUTOMATION, CRON_SECRET: env.CRON_SECRET }
  env.CONTENT_ACCOUNT_AUTOMATION = 'true'; env.CRON_SECRET = secret
  try {
    const calls = []
    const repository = { studioList: async () => [{ id: 'profile-a', accountId: 'account-a', enabled: true, automationConsent: true }, { id: 'profile-b', accountId: 'account-b', enabled: true, automationConsent: true }] }
    const input = { owner: 'owner-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1', accountIds: ['account-a'] }
    const publish = async (...args) => { calls.push(args); return { messageId: 'controlled-message' } }
    await dispatchAutomation(input, repository, () => assert.fail('Queue admission is awaited'), publish)
    await dispatchAutomation(input, repository, () => {}, publish)
    assert.equal(calls.length, 2); assert.equal(calls[0][0], 'content-account-automation-v1'); assert.equal(calls[0][1].owner, input.owner); assert.equal(calls[0][1].profileId, 'profile-a'); assert.equal(calls[0][1].requestId, input.requestId)
    assert.equal(calls[0][2].retentionSeconds, 86400); assert.equal(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey)
    await assert.rejects(dispatchAutomation(input, repository, () => {}, async () => { throw new Error('transport') }), /Durable automation admission failed/)
  } finally { Object.assign(env, prior) }
})

test('new deployment can readmit the same saved job without deduplicating against an acknowledged older release', async () => {
  const previous = { enabled: env.CONTENT_ACCOUNT_AUTOMATION, secret: env.CRON_SECRET, deployment: process.env.VERCEL_DEPLOYMENT_ID }
  env.CONTENT_ACCOUNT_AUTOMATION = 'true'; env.CRON_SECRET = secret
  try {
    const keys = []; const refs = []
    const repository = { studioList: async () => [{ id: 'profile-a', accountId: 'account-a', enabled: true, automationConsent: true }] }
    const publish = async (_topic, ref, options) => { keys.push(options.idempotencyKey); refs.push(ref); return {} }
    const input = { owner: 'owner-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1' }
    for (const deployment of ['release-one', 'release-one', 'release-two']) { process.env.VERCEL_DEPLOYMENT_ID = deployment; await dispatchAutomation(input, repository, () => {}, publish) }
    assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2])
    assert.ok(refs.every(ref => ref.requestId === input.requestId && ref.profileId === 'profile-a'))
  } finally { env.CONTENT_ACCOUNT_AUTOMATION = previous.enabled; env.CRON_SECRET = previous.secret; if (previous.deployment === undefined) delete process.env.VERCEL_DEPLOYMENT_ID; else process.env.VERCEL_DEPLOYMENT_ID = previous.deployment }
})
