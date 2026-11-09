import test from 'node:test'
import assert from 'node:assert/strict'
import { generateJson } from '../providers/llm.js'
import { generateContent, settingsSchema } from '../studio/content.js'
import { reviewAutomaticText, assessAutomaticText } from '../automation/review.js'
import { ratingsFixture } from './fixtures/finalization.js'
import { env } from '../config/env.js'

const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-super-vl:free' }
const excerpt = 'The publisher announced a limited developer preview for text and images. Availability remains restricted and independent outcomes are not established.'
const evidence = [{ id: 'E1', hash: 'source-hash', url: 'https://example.com/preview', retrievedAt: new Date().toISOString(), excerpt }]
const settings = settingsSchema.parse({ outputs: ['website'] })
function adapter(makeData) {
  return request => generateJson(request, { config, acceptCompleteJsonAtLength: true, request: async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[1].content)
    return Response.json({ id: 'gen-123-length-review', choices: [{ finish_reason: 'length', message: { content: JSON.stringify(makeData(input)) + '   \n' } }], usage: { completion_tokens: 6000, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })
  } })
}

test('complete JSON acceptance cannot bypass generation schema or source passage validation', async () => {
  for (const invalid of ['schema', 'passage']) {
    let calls = 0
    const generate = adapter(input => {
      calls++
      return { website: { title: invalid === 'schema' ? 42 : 'A preview', body: 'A limited preview [C1].' }, claims: [{ id: 'C1', text: 'A limited preview', evidenceId: 'E1', passageId: invalid === 'passage' ? `P${'0'.repeat(24)}` : input.passages[0].id, status: 'attributed' }] }
    })
    await assert.rejects(generateContent(evidence, settings, {}, generate), { code: 'EVIDENCE_VALIDATION' })
    assert.equal(calls, 2, 'only the existing correction allowance is used')
  }
})

test('automatic evaluator persists a schema-validated length receipt without inventing human approval', async () => {
  const pack = { id: 'controlled-pack', settings, evidence, content: { website: { title: 'Developer preview', body: 'The publisher announced a limited preview [C1].' }, claims: [{ id: 'C1', text: 'A limited preview', evidenceId: 'E1', quote: excerpt, status: 'attributed' }] } }
  const profile = { enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice', consentedAt: new Date(Date.now() - 1000).toISOString() } }
  const reviewData = { claims: [{ id: 'C1', evidenceIds: ['E1'], verdict: 'supported', supportQuote: excerpt, reason: 'The saved source explicitly describes this limited publisher preview.' }], ratings: ratingsFixture(), checks: { semanticSupport: true, contradictionsResolved: true, scopePreserved: true, promisesAligned: true, privacySafe: true, audienceClaimsSupported: true, provenanceClear: true }, issues: [], summary: 'Controlled automated review fixture, not a real content acceptance.' }
  pack.automaticReview = await reviewAutomaticText(pack, profile, { generate: adapter(() => reviewData) })
  assert.equal(pack.automaticReview.status, 'passed')
  assert.equal(pack.automaticReview.method, 'automated-model-review')
  assert.equal(pack.automaticReview.providerReceipt.finishReason, 'length')
  assert.equal(pack.automaticReview.providerReceipt.schemaValidated, true)
  assert.equal(pack.automaticReview.providerReceipt.billingVerified, false)
  assert.equal(pack.automaticReview.providerReceipt.providerReportedCost, 0)
  assert.equal(pack.independentReview, undefined)
  assert.equal(assessAutomaticText(pack, profile).eligible, true)
  pack.automaticReview.providerReceipt = { ...pack.automaticReview.providerReceipt, schemaValidated: false }
  assert.equal(assessAutomaticText(pack, profile).eligible, false)
  const rejected = await reviewAutomaticText(pack, profile, { generate: adapter(() => ({ ...reviewData, ratings: {} })) })
  assert.equal(rejected.status, 'blocked'); assert.equal(rejected.providerReceipt, undefined)
  const previousFetch = globalThis.fetch
  const previousConfig = { key: env.OPENROUTER_API_KEY, model: env.LLM_MODEL, capability: env.CONTENT_LIVE_FREE_CALLS }
  try {
    env.OPENROUTER_API_KEY = 'controlled-test-only'; env.LLM_MODEL = config.LLM_MODEL; env.CONTENT_LIVE_FREE_CALLS = 'true'
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.response_format, undefined)
      assert.equal(body.tool_choice.function.name, 'submit_json')
      assert.equal(body.tools[0].function.strict, true)
      assert.ok(body.tools[0].function.parameters.properties.ratings)
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 })
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'submit_json', arguments: JSON.stringify(reviewData) } }] } }] })
    }
    const toolReviewed = await reviewAutomaticText(pack, profile)
    assert.equal(toolReviewed.status, 'passed'); assert.equal(toolReviewed.providerReceipt, undefined)
  } finally { globalThis.fetch = previousFetch; env.OPENROUTER_API_KEY = previousConfig.key; env.LLM_MODEL = previousConfig.model; env.CONTENT_LIVE_FREE_CALLS = previousConfig.capability }
})
