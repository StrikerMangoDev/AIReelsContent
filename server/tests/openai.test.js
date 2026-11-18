import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { generateJson, readFreeGenerationReceipt } from '../providers/llm.js'
import express from 'express'
import { once } from 'node:events'
import { workspaceAuth } from '../studio/workspaces.js'
import { generateOpenAIJson, withModelBudget, strictOpenAISchema, restoreOptionalFields } from '../providers/openai.js'
import { vertexFallbackAllowed } from '../providers/vertex-fallback.js'
import { generateOpenRouterDemoJson } from '../providers/openrouter-demo.js'

const config = { CONTENT_TEXT_PROVIDER: 'openai', CONTENT_LIVE_FREE_CALLS: 'true', OPENAI_API_KEY: 'not-a-real-key', OPENAI_MODEL: 'gpt-6-luna' }
const schema = { type: 'object', properties: { answer: { type: 'string' }, note: { type: 'string' } }, required: ['answer'], additionalProperties: false }
const input = { system: 'Answer using the supplied evidence.', input: { evidence: 'Source passage.' }, schema, maxTokens: 1000 }
const response = (patch = {}) => ({ ok: true, json: async () => ({ model: 'gpt-6-luna', status: 'completed', usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 20 } }, output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: '{"answer":"Source passage.","note":null}' }] }], ...patch }) })
function fixture(limit = 5000000) { const repository = createRepository(':memory:'); repository.budgetConfigure('USD', 'alice', limit, limit); return { repository, owner: 'alice', requestId: 'test-operation', sequence: 0 } }

test('Responses adapter preserves the JSON entry point, controls and exact monetary accounting', async () => {
  const scope = fixture(); let calls = 0
  const value = await withModelBudget(scope, () => generateJson(input, { config, preferTools: true, request: async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses')
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 1000)
    assert.deepEqual(body.reasoning, { effort: 'none' }); assert.equal(body.text.format.strict, true)
    assert.deepEqual(body.text.format.schema.required, ['answer', 'note']); assert.equal(body.tools, undefined)
    return response()
  } }))
  assert.deepEqual(value, { answer: 'Source passage.' }); assert.equal(calls, 1)
  assert.equal(scope.repository.budgetSummary('alice').settledMicros, 29)
  assert.equal(scope.repository.budgetGet('alice', 'openai:test-operation:1').status, 'settled')
  scope.repository.close()
})

test('missing context, free-only operations, missing credentials and exhausted budgets never dispatch', async () => {
  const request = () => assert.fail('Must not dispatch')
  await assert.rejects(generateOpenAIJson(input, { config, request }), /authenticated/)
  const scope = fixture(0)
  await assert.rejects(generateOpenAIJson(input, { config, scope, request }), /budget exhausted/)
  await assert.rejects(generateOpenAIJson(input, { config, scope: { ...scope, allowPaid: false }, request }), /free-only/)
  await assert.rejects(generateOpenAIJson(input, { config: { ...config, OPENAI_API_KEY: '' }, scope, request }), /not configured/)
  await assert.rejects(generateOpenAIJson({ ...input, input: { text: 'x'.repeat(200000) } }, { config, scope, request }), /short-context/)
  scope.repository.close()
})

test('HTTP errors, transport timeouts and missing usage retain monetary holds without retry', async () => {
  for (const request of [async () => ({ ok: false, status: 429 }), async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }, async () => response({ usage: undefined })]) {
    const scope = fixture(); let calls = 0
    try { await generateOpenAIJson(input, { config, scope, request: (...args) => { calls++; return request(...args) } }) } catch (error) { assert.ok(['MODEL_HTTP_ERROR', 'MODEL_TIMEOUT'].includes(error.code)) }
    assert.equal(calls, 1); assert.equal(scope.repository.budgetGet('alice', 'openai:test-operation:1').status, 'dispatch_unknown')
    assert.ok(scope.repository.budgetSummary('alice').heldMicros > 0); scope.repository.close()
  }
})

test('incomplete, refused and invalid JSON outputs never become usable drafts', async () => {
  for (const patch of [{ status: 'incomplete' }, { output: [{ type: 'message', status: 'completed', content: [{ type: 'refusal', refusal: 'No' }] }] }, { output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: '{partial' }] }] }]) {
    const scope = fixture()
    await assert.rejects(generateOpenAIJson(input, { config, scope, request: async () => response(patch) }), error => ['MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code))
    assert.equal(scope.repository.budgetGet('alice', 'openai:test-operation:1').status, 'settled'); scope.repository.close()
  }
})

test('optional schema mapping retains required nulls, source arrays and rejects dynamic dictionaries before dispatch', () => {
  const nested = { type: 'object', properties: { claims: { type: 'array', items: schema }, note: { type: ['string', 'null'] } }, required: ['claims', 'note'] }
  assert.deepEqual(restoreOptionalFields({ claims: [{ answer: 'Fact [C1]', note: null }], note: null }, nested), { claims: [{ answer: 'Fact [C1]' }], note: null })
  assert.equal(strictOpenAISchema(nested).additionalProperties, false)
  assert.throws(() => strictOpenAISchema({ type: 'object', additionalProperties: { type: 'string' } }), /Dynamic/)
  const platforms = { oneOf: ['Instagram', 'LinkedIn'].map(platform => ({ type: 'object', properties: { platform: { const: platform, type: 'string' }, caption: { type: 'string' } }, required: ['platform'] })) }
  const grammar = strictOpenAISchema(platforms)
  assert.equal(grammar.oneOf, undefined); assert.equal(grammar.anyOf.length, 2)
  assert.deepEqual(restoreOptionalFields({ platform: 'LinkedIn', caption: null }, platforms), { platform: 'LinkedIn' })
})

test('OpenAI selection disables both Vertex and OpenRouter Gemini demonstration paths', async () => {
  assert.equal(vertexFallbackAllowed({ ...config, CONTENT_VERTEX_FALLBACK: 'true' }), false)
  await assert.rejects(generateOpenRouterDemoJson(input, { config, request: () => assert.fail('No Gemini call') }), /disabled/)
})

test('concurrent operation contexts do not cross owner budgets or request identifiers', async () => {
  const a = fixture(); const b = fixture(); b.requestId = 'another-operation'
  await Promise.all([a, b].map(scope => withModelBudget(scope, () => generateJson(input, { config, request: async () => { await new Promise(resolve => setImmediate(resolve)); return response() } }))))
  assert.equal(a.repository.budgetGet('alice', 'openai:another-operation:1'), null)
  assert.equal(b.repository.budgetGet('alice', 'openai:test-operation:1'), null)
  a.repository.close(); b.repository.close()
})

test('cache writes use their documented total rates and missing write detail keeps the cost held', async () => {
  for (const [details, expected] of [[{ cached_tokens: 10, cache_write_tokens: 60, cache_write_tokens_details: { ttl_30m_tokens: 40, ttl_12h_tokens: 20 } }, 34], [{ cache_write_tokens: 60 }, null]]) {
    const scope = fixture()
    await generateOpenAIJson(input, { config, scope, request: async () => response({ usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: details } }) })
    const cost = scope.repository.budgetGet('alice', 'openai:test-operation:1')
    assert.equal(cost.status, expected === null ? 'dispatch_unknown' : 'settled')
    if (expected !== null) assert.equal(cost.actualMicros, expected)
    scope.repository.close()
  }
})

test('historical receipt reads never dispatch OpenAI after provider migration', async () => {
  let reads = 0
  await readFreeGenerationReceipt('gen-old', { config: { ...config, OPENROUTER_API_KEY: 'old-read-only-test-key' }, request: async url => {
    reads++; assert.match(url, /^https:\/\/openrouter.ai\/api\/v1\/generation\?/)
    return { ok: true, json: async () => ({ data: { id: 'gen-old', model: 'nvidia/test:free', total_cost: 0, cancelled: false, finish_reason: 'stop' } }) }
  } })
  assert.equal(reads, 1)
})

test('authenticated HTTP workspace middleware admits OpenAI only against that owner budget', async () => {
  const scope = fixture(); let calls = 0
  const app = express()
  app.use(express.json(), ...workspaceAuth(scope.repository, (req, res, next) => { if (!req.headers.authorization) return res.status(401).end(); req.identity = { uid: req.headers.authorization }; next() }))
  app.post('/write', async (_req, res, next) => { try { res.json(await generateJson(input, { config, request: async () => { calls++; return response() } })) } catch (error) { next(error) } })
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.code }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/write`
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401)
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'bob' } })).status, 409)
    const result = await fetch(url, { method: 'POST', headers: { authorization: 'alice' } })
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { answer: 'Source passage.' }); assert.equal(calls, 1)
    assert.equal(scope.repository.budgetSummary('alice').settledMicros, 29)
  } finally { server.close(); scope.repository.close() }
})
