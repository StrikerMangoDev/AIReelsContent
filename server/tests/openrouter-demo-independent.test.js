import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { reserveCost } from '../budget/policy.js'
import { generateOpenRouterDemoJson, openRouterDemoModel, openRouterDemoCallUpperBoundMicros } from '../providers/openrouter-demo.js'
import { createDemoFixture } from './fixtures/demo.js'
import { assertDemoAuthorization } from '../automation/demo.js'

const config = { OPENROUTER_API_KEY: 'mock-not-a-real-key' }
const input = { system: 'Return JSON', input: { text: 'QA fixture' }, schema: { type: 'object' }, maxTokens: 100 }
const completion = usage => ({ id: 'gen-independent', model: openRouterDemoModel, usage, choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] })
const response = body => ({ ok: true, status: 200, json: async () => body })
function options(repository, requestId, request, owner = 'demo-owner') {
  return { repository, owner, requestId, config, request, priceExpiresAt: new Date(Date.now() + 3600000).toISOString() }
}

test('independent OpenRouter QA uses total account cost and sends only the exact price-capped text request', async () => {
  const repository = createRepository(':memory:'); let posts = 0
  repository.budgetConfigure('USD', 'demo-owner', 5000000, 5000000)
  try {
    const result = await generateOpenRouterDemoJson(input, options(repository, 'priced', async (url, init) => {
      posts++; assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(init.method, 'POST')
      const body = JSON.parse(init.body)
      assert.equal(body.model, openRouterDemoModel); assert.deepEqual(body.provider.max_price, { prompt: 0.825, completion: 4.125, request: 0 })
      assert.equal(body.provider.allow_fallbacks, false)
      assert.deepEqual(body.plugins, []); assert.deepEqual(body.tools, []); assert.equal(body.tool_choice, 'none')
      assert.equal(JSON.stringify(body).includes('cache_control'), false)
      return response(completion({ cost: 0.1234561, is_byok: false, cost_details: { upstream_inference_cost: 0.000001 } }))
    }))
    assert.deepEqual(result, { ok: true }); assert.equal(posts, 1)
    assert.equal(repository.budgetGet('demo-owner', 'priced').actualMicros, 123457)
  } finally { repository.close() }
})

test('independent OpenRouter QA never substitutes upstream cost or ambiguous receipt metadata for a bill', async () => {
  const cases = [
    { usage: { cost: 0.001, is_byok: true } },
    { usage: { cost: 0.001 }, metadata: { id: 'gen-independent', model: openRouterDemoModel, cancelled: false, total_cost: 0.001 } },
    { usage: { cost: 0.001 }, metadata: { id: 'gen-other', model: openRouterDemoModel, cancelled: false, is_byok: false, total_cost: 0.001 } },
    { usage: { cost: 0.001 }, metadata: { id: 'gen-independent', model: 'wrong/model', cancelled: false, is_byok: false, total_cost: 0.001 } },
    { usage: { cost_details: { upstream_inference_cost: 0.001 } }, metadataStatus: 404 },
  ]
  for (const [index, entry] of cases.entries()) {
    const repository = createRepository(':memory:'); let posts = 0; let gets = 0
    repository.budgetConfigure('USD', 'demo-owner', 5000000, 5000000)
    try {
      await generateOpenRouterDemoJson(input, options(repository, `unknown-${index}`, async (_url, init) => {
        if (init.method === 'POST') { posts++; return response(completion(entry.usage)) }
        gets++; return entry.metadataStatus ? { ok: false, status: entry.metadataStatus } : response({ data: entry.metadata })
      }))
      assert.equal(posts, 1); assert.equal(gets, entry.usage.is_byok === true ? 0 : 1)
      assert.equal(repository.budgetGet('demo-owner', `unknown-${index}`).status, 'dispatch_unknown')
      assert.equal(repository.budgetSummary('demo-owner').heldMicros, openRouterDemoCallUpperBoundMicros)
    } finally { repository.close() }
  }
})

test('independent OpenRouter QA preserves the prior Vertex unknown hold under the same absolute five-dollar cap', async () => {
  const repository = createRepository(':memory:'); let posts = 0
  try {
    repository.budgetConfigure('USD', 'old-vertex-owner', 5000000, 5000000)
    let { reservation } = await reserveCost(repository, { owner: 'old-vertex-owner', requestId: 'historical-403', scope: { provider: 'vertex' }, quote: { currency: 'USD', upperBoundMicros: 1277952, priceVersion: 'historical-fixture', priceExpiresAt: new Date(Date.now() + 3600000).toISOString(), kind: 'generation' } })
    reservation = repository.budgetTransition('old-vertex-owner', reservation.id, reservation.revision, 'dispatch')
    repository.budgetTransition('old-vertex-owner', reservation.id, reservation.revision, 'unknown')
    repository.budgetConfigure('USD', 'demo-owner', 5000000, 5000000)
    const request = async () => { posts++; throw Object.assign(new Error('Timed out'), { name: 'TimeoutError' }) }
    for (let index = 0; index < 2; index++) await assert.rejects(() => generateOpenRouterDemoJson(input, options(repository, `timeout-${index}`, request)), error => error.code === 'MODEL_TIMEOUT')
    await assert.rejects(() => generateOpenRouterDemoJson(input, options(repository, 'over-cap', request)), /budget exhausted/)
    assert.equal(posts, 2)
    assert.equal(repository.budgetSummary('old-vertex-owner').heldMicros, 1277952)
    assert.equal(repository.budgetSummary('demo-owner').heldMicros, openRouterDemoCallUpperBoundMicros * 2)
    assert.ok(1277952 + repository.budgetSummary('demo-owner').heldMicros <= 5000000)
  } finally { repository.close() }
})

test('independent OpenRouter QA rejects mixed authorization provider/model pairs before dispatch', async () => {
  const repository = createRepository(':memory:')
  try {
    const { owner, demoId, contexts } = await createDemoFixture(repository)
    let record = await repository.studioGet(owner, 'automation_demo', demoId)
    record = await repository.studioPut(owner, 'automation_demo', demoId, { ...record, provider: 'openrouter', model: 'gemini-3.8-flash', priceExpiresAt: record.expiresAt }, record.revision)
    await assert.rejects(() => assertDemoAuthorization(contexts[0]), error => error.code === 'BUDGET_BLOCKED' && error.preDispatch === true)
    await repository.studioPut(owner, 'automation_demo', demoId, { ...record, provider: 'vertex', model: openRouterDemoModel }, record.revision)
    await assert.rejects(() => assertDemoAuthorization(contexts[0]), error => error.code === 'BUDGET_BLOCKED' && error.preDispatch === true)
  } finally { repository.close() }
})
