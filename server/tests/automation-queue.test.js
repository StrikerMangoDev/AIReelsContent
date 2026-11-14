import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { minimatch } from 'minimatch'
import { createAutomationConsumer, automationQueueRetry } from '../../api/automation-worker.js'

const at = Date.parse('2026-11-12T12:00:00Z')
const message = { owner: 'owner-a', profileId: 'profile-a', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1', enqueuedAt: new Date(at).toISOString() }
const config = { CONTENT_ACCOUNT_AUTOMATION: 'true' }

test('Vercel first matching function configuration preserves the private queue trigger', async () => {
  const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'))
  const keys = Object.keys(config.functions)
  // Vercel fs-detectors getFunction chooses keys.find, rather than merging matching configurations.
  const match = file => keys.find(key => key === file || minimatch(file, key))
  const worker = config.functions[match('api/automation-worker.js')]
  assert.equal(worker.experimentalTriggers[0].type, 'queue/v2beta')
  assert.equal(worker.experimentalTriggers[0].topic, 'content-account-automation-v1')
  assert.equal(worker.experimentalTriggers[0].maxConcurrency, 1)
  assert.equal(worker.experimentalTriggers[0].maxDeliveries, 96)
  for (const file of ['api/automation.js', 'api/studio.js', 'api/auth/me.js']) {
    const ordinary = config.functions[match(file)]
    assert.equal(ordinary.maxDuration, 300)
    assert.equal(ordinary.experimentalTriggers, undefined)
  }
})

test('private queue redelivery continues saved stages and receipt checks without self HTTP or inline delay', async () => {
  const seen = []; let step = 0
  const repository = { studioGet: async (_owner, kind) => kind === 'automation_owner' ? { enabled: true } : { enabled: true, automationConsent: true } }
  const execute = async input => { seen.push(input); return ++step <= 5 ? { deferred: true, retryAfterMs: step === 5 ? 10000 : 1000 } : { deferred: false } }
  const consumer = createAutomationConsumer({ repository, execute, config, now: () => at })
  for (let deliveryCount = 1; deliveryCount <= 5; deliveryCount++) {
    let caught
    try { await consumer(message, { deliveryCount }) } catch (error) { caught = error }
    assert.ok(caught)
    assert.deepEqual(automationQueueRetry(caught, { deliveryCount }), { afterSeconds: deliveryCount === 5 ? 10 : 1 })
  }
  await consumer(message, { deliveryCount: 6 })
  assert.equal(seen.length, 6); assert.ok(seen.every(input => input.owner === message.owner && input.profileId === message.profileId && input.requestId === message.requestId))
})

test('queue rejects forged references, disabled consent, expiry and excessive delivery before execution', async () => {
  let runs = 0; let enabled = true
  const repository = { studioGet: async () => ({ enabled, automationConsent: enabled }) }
  const consumer = createAutomationConsumer({ repository, execute: async () => { runs++; return {} }, config, now: () => at })
  for (const input of [{ ...message, provider: 'forged' }, { ...message, enqueuedAt: new Date(at - 86400000).toISOString() }, { ...message, enqueuedAt: new Date(at + 1).toISOString() }]) await consumer(input, { deliveryCount: 1 })
  await consumer(message, { deliveryCount: 97 }); await consumer(message, {})
  enabled = false; await consumer(message, { deliveryCount: 1 })
  assert.equal(runs, 0)
  assert.deepEqual(automationQueueRetry(new Error('private'), { deliveryCount: 96 }), { acknowledge: true })
  assert.deepEqual(automationQueueRetry(new Error('private'), { deliveryCount: 1 }), { afterSeconds: 30 })
})

test('only an explicit valid pending continuation marker keeps a held paid stage in the queue', async () => {
  const repository = { studioGet: async () => ({ enabled: true, automationConsent: true }) }
  for (const outcome of [{ deferred: false, continuationPending: true, results: [{ status: 'held' }] }, { deferred: false, results: [{ status: 'held' }] }, { deferred: false, results: [{ status: 'blocked' }] }, { deferred: false, results: [{ status: 'dispatch_unknown' }] }]) {
    const consume = createAutomationConsumer({ repository, config, now: () => at, execute: async () => outcome })
    if (outcome.continuationPending) await assert.rejects(consume(message, { deliveryCount: 2 }), error => error.retryAfterMs === 30000)
    else await consume(message, { deliveryCount: 2 })
  }
})
