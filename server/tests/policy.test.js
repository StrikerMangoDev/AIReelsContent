import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilityAllowed, assertCapability } from '../policy.js'
import { generateJson } from '../providers/llm.js'
import { createCronHandler } from '../http/cron.js'

test('credentials alone cannot authorize provider calls and paid capabilities stay blocked', async () => {
  const config = { OPENROUTER_API_KEY: 'fixture', LLM_MODEL: 'nvidia/test:free' }
  let calls = 0
  await assert.rejects(generateJson({ system: '', input: {}, schema: {} }, { config, request: async () => { calls++; throw new Error('unexpected dispatch') } }), { code: 'CAPABILITY_BLOCKED' })
  assert.equal(calls, 0)
  assert.equal(capabilityAllowed('generation', { ...config, CONTENT_LIVE_FREE_CALLS: 'true' }), true)
  for (const capability of ['media', 'publishing', 'scheduling', 'gemini', 'unknown']) assert.throws(() => assertCapability(capability, { CONTENT_LIVE_FREE_CALLS: 'true' }), { code: 'CAPABILITY_BLOCKED' })
})

test('authenticated cron remains disabled without loading any work', async () => {
  let calls = 0
  const handler = createCronHandler({ secret: 'fixture', loadCollection: async () => { calls++; throw new Error('unexpected work') } })
  const response = { setHeader() {}, status(code) { this.code = code; return this }, json(value) { this.body = value; return this } }
  await handler({ method: 'GET', headers: { authorization: 'Bearer fixture' } }, response)
  assert.equal(response.code, 503)
  assert.equal(calls, 0)
})
