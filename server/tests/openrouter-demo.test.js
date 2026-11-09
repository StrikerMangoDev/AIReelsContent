import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { createDemoFixture } from './fixtures/demo.js'
import { createDemoGenerator, assertDemoAuthorization, demoBudgetOwner } from '../automation/demo.js'
import { generateOpenRouterDemoJson, openRouterDemoModel, openRouterDemoCallUpperBoundMicros } from '../providers/openrouter-demo.js'
import { reserveCost } from '../budget/policy.js'

const config = { OPENROUTER_API_KEY: 'controlled-test-key-only', CONTENT_VERTEX_FALLBACK: 'false' }
const input = { system: 'Return the controlled JSON fixture.', input: { topic: 'Controlled source material.' }, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, maxTokens: 12000 }
const response = patch => ({ id: 'gen-123-demo', model: openRouterDemoModel, choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { is_byok: false, cost: 0.000825, cost_details: { upstream_inference_cost: 9 } }, ...patch })
async function fixture(repository) {
  const value = await createDemoFixture(repository)
  const authorization = await repository.studioPut(value.owner, 'automation_demo', value.demoId, { ...value.authorization, provider: 'openrouter', model: openRouterDemoModel, priceExpiresAt: value.authorization.expiresAt }, value.authorization.revision)
  return { ...value, authorization, budgetOwner: demoBudgetOwner(value.owner, value.demoId) }
}

test('scoped OpenRouter demo uses exact native model/price cap, settles full account cost and leaves Vertex disabled', async () => {
  const repository = createRepository(':memory:')
  try {
    const value = await fixture(repository); let calls = 0
    const admitted = await assertDemoAuthorization(value.contexts[0])
    assert.equal(admitted.model, openRouterDemoModel); assert.equal(admitted.requiredQuoteMicros, 1405748)
    const generate = createDemoGenerator(value.contexts[0], { config, request: async (url, init) => {
      calls++; assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(init.method, 'POST')
      const body = JSON.parse(init.body)
      assert.equal(body.model, openRouterDemoModel); assert.equal(body.max_tokens, 8000)
      assert.deepEqual(body.provider, { require_parameters: true, allow_fallbacks: false, max_price: { prompt: 0.825, completion: 4.125, request: 0 } })
      assert.deepEqual(body.response_format.json_schema.schema, input.schema); assert.equal(body.response_format.json_schema.strict, true)
      assert.deepEqual(body.plugins, []); assert.deepEqual(body.tools, []); assert.equal(body.tool_choice, 'none'); assert.equal(body.cache_control, undefined)
      assert.equal(repository.budgetSummary(value.budgetOwner).heldMicros, openRouterDemoCallUpperBoundMicros)
      return Response.json(response())
    } })
    assert.deepEqual(await generate(input), { ok: true }); assert.equal(calls, 1)
    assert.equal(repository.budgetSummary(value.budgetOwner).settledMicros, 825, 'use usage.cost, never upstream cost or estimated token prices')
    assert.equal(repository.budgetSummary(value.owner).limitMicros, 0)
    await assert.rejects(createDemoGenerator(value.contexts[0], { config, request: async () => { calls++; return Response.json(response()) } })(input), /already exists/)
    assert.equal(calls, 1)
  } finally { repository.close() }
})

test('one exact generation metadata readback can settle missing BYOK flag without retrying the paid POST', async () => {
  const repository = createRepository(':memory:')
  try {
    const value = await fixture(repository); let posts = 0; let reads = 0
    const generate = createDemoGenerator(value.contexts[0], { config, request: async (url, init) => {
      if (init.method === 'POST') { posts++; return Response.json(response({ usage: { cost: 0 } })) }
      reads++; assert.equal(url, 'https://openrouter.ai/api/v1/generation?id=gen-123-demo')
      return Response.json({ data: { id: 'gen-123-demo', model: openRouterDemoModel, cancelled: false, is_byok: false, total_cost: 0.002 } })
    } })
    assert.deepEqual(await generate(input), { ok: true })
    assert.equal(posts, 1); assert.equal(reads, 1); assert.equal(repository.budgetSummary(value.budgetOwner).settledMicros, 2000)
  } finally { repository.close() }
})

test('BYOK or unavailable accounting keeps protected holds including historical Vertex exposure under the absolute five-dollar cap', async () => {
  const repository = createRepository(':memory:')
  try {
    const value = await fixture(repository)
    repository.budgetConfigure('USD', 'old-vertex-demo', 5000000, 5000000)
    const old = await reserveCost(repository, { owner: 'old-vertex-demo', requestId: 'original-403-hold', scope: { original: true }, quote: { currency: 'USD', upperBoundMicros: 1277952, kind: 'generation', priceVersion: 'original-vertex-bound', priceExpiresAt: value.authorization.expiresAt } })
    let hold = repository.budgetTransition('old-vertex-demo', old.reservation.id, old.reservation.revision, 'dispatch')
    hold = repository.budgetTransition('old-vertex-demo', hold.id, hold.revision, 'unknown')
    let posts = 0
    const request = async (_url, init) => { assert.equal(init.method, 'POST'); posts++; return Response.json(response({ usage: { is_byok: true, cost: 0 } })) }
    await createDemoGenerator(value.contexts[0], { config, request })(input)
    await createDemoGenerator(value.contexts[1], { config, request })(input)
    await assert.rejects(createDemoGenerator(value.contexts[2], { config, request })(input), /budget exhausted/)
    assert.equal(posts, 2)
    assert.equal(repository.budgetSummary(value.budgetOwner).heldMicros, 2811496)
    assert.equal(repository.budgetGet('old-vertex-demo', hold.id).status, 'dispatch_unknown')
    assert.ok(repository.budgetSummary(value.budgetOwner).heldMicros + hold.quote.upperBoundMicros <= 5000000)
  } finally { repository.close() }
})

test('402 blocks the whole scoped demo, malformed accounting never settles, and rejected output remains rejected', async () => {
  const repository = createRepository(':memory:')
  try {
    const value = await fixture(repository); let calls = 0
    await assert.rejects(createDemoGenerator(value.contexts[0], { config, request: async () => { calls++; return new Response('private provider error body', { status: 402 }) } })(input), error => error.code === 'MODEL_HTTP_ERROR' && error.status === 402 && !error.message.includes('private'))
    assert.equal((await repository.studioGet(value.owner, 'automation_demo', value.demoId)).status, 'blocked')
    await assert.rejects(createDemoGenerator(value.contexts[1], { config, request: async () => { calls++; return Response.json(response()) } })(input), { code: 'BUDGET_BLOCKED' })
    assert.equal(calls, 1)
    assert.equal(repository.budgetSummary(value.budgetOwner).heldMicros, 1405748)
  } finally { repository.close() }
  for (const usage of [{ is_byok: false }, { is_byok: false, cost: null }, { is_byok: false, cost: '0' }, { is_byok: false, cost: -1 }]) {
    const repo = createRepository(':memory:')
    try {
      repo.budgetConfigure('USD', 'accounting-test', 5000000, 5000000)
      await assert.rejects(generateOpenRouterDemoJson(input, { repository: repo, owner: 'accounting-test', requestId: 'invalid-json', priceExpiresAt: new Date(Date.now() + 60000).toISOString(), config, request: async () => Response.json(response({ usage, choices: [{ finish_reason: 'stop', message: { content: '{"partial":' } }] })) }), { code: 'MODEL_JSON_INVALID' })
      assert.equal(repo.budgetGet('accounting-test', 'invalid-json').status, 'dispatch_unknown')
    } finally { repo.close() }
  }
})
