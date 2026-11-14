import test from 'node:test'
import assert from 'node:assert/strict'
import { generateJson } from '../providers/llm.js'
import { safeJobFailure } from '../studio/job-worker.js'
import { reviewAutomaticText } from '../automation/review.js'
import { settingsSchema } from '../studio/content.js'

const config = { OPENROUTER_API_KEY: 'controlled-test-only', CONTENT_LIVE_FREE_CALLS: 'true', LLM_MODEL: 'nvidia/nemotron-3.5-super-vl:free' }
const input = { system: 'Return the controlled JSON instance.', input: {}, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } }
const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted to invited developers, and independent outcomes are not established.'
const pack = { createdBy: 'owner', settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [{ id: 'E1', hash: 'source-hash', url: 'https://example.com/announcement', excerpt, retrievedAt: new Date().toISOString() }], content: { claims: [{ id: 'C1', text: 'The publisher announced a limited developer preview', quote: excerpt, evidenceId: 'E1', status: 'attributed' }], website: { title: 'Developer preview', body: 'The publisher announced a limited developer preview [C1].' } } }
const profile = { enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'owner', consentedAt: new Date(Date.now() - 1000).toISOString() } }

test('HTTP 429 preserves bounded retry/reset hints and allowlisted provenance through evaluator diagnostics without retaining private error bodies or retrying', async () => {
  let calls = 0
  const reset = Date.now() + 60000
  const generate = request => generateJson(request, { config, request: async () => {
    calls++
    return Response.json({ error: { code: 429, message: 'private-token-and-provider-description', metadata: { limit_source: 'openrouter_free_model_daily_requests', provider_code: 429, error_type: 'rate_limit_exceeded', raw: 'private-provider-payload' } } }, { status: 429, headers: { 'Retry-After': '45', 'X-RateLimit-Limit': '50', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset) } })
  } })
  const review = await reviewAutomaticText(pack, profile, { generate })
  assert.equal(review.status, 'blocked'); assert.equal(calls, 1, JSON.stringify(review.issues))
  assert.equal(review.result, null)
  assert.equal(review.responseFailure.code, 'MODEL_HTTP_ERROR'); assert.equal(review.responseFailure.httpStatus, 429)
  assert.equal(review.responseFailure.retryAfterSeconds, 45); assert.equal(review.responseFailure.rateLimitResetAt, new Date(reset).toISOString())
  assert.equal(review.responseFailure.rateLimitLimit, 50); assert.equal(review.responseFailure.rateLimitRemaining, 0)
  assert.equal(review.responseFailure.limitSource, 'openrouter_free_model_daily_requests'); assert.equal(review.responseFailure.rateLimitProviderCode, 429)
  assert.equal(review.responseFailure.rateLimitErrorType, 'rate_limit_exceeded')
  assert.doesNotMatch(JSON.stringify(review), /private-token|private-provider/)
})

test('unrecognized metadata, malformed dates, excessive retry delays and oversized error responses remain private and do not authorize retries', async () => {
  for (const body of [JSON.stringify({ error: { message: 'secret-api-key', metadata: { limit_source: 'secret-unrecognized-source', provider_code: 'secret-string', error_type: 'secret-type' } } }), 'private-body'.repeat(2000), 'not-json-secret']) {
    let calls = 0
    await assert.rejects(generateJson(input, { config, request: async () => { calls++; return new Response(body, { status: 429, headers: { 'Retry-After': '999999999', 'X-RateLimit-Limit': '-1', 'X-RateLimit-Remaining': 'not-a-count', 'X-RateLimit-Reset': 'private-reset-value' } }) } }), error => {
      const safe = safeJobFailure(error)
      assert.equal(safe.httpStatus, 429); assert.equal(safe.retryAfterSeconds, undefined); assert.equal(safe.rateLimitResetAt, undefined)
      assert.equal(safe.limitSource, undefined); assert.equal(safe.rateLimitProviderCode, undefined); assert.equal(safe.rateLimitErrorType, undefined)
      assert.doesNotMatch(JSON.stringify(safe), /secret|private-/)
      return true
    })
    assert.equal(calls, 1)
  }
})

test('standard Retry-After HTTP dates are normalized without copying raw text and non-429 errors cannot carry rate-limit retry hints', async () => {
  await assert.rejects(generateJson(input, { config, request: async () => new Response('', { status: 429, headers: { 'Retry-After': new Date(Date.now() + 60000).toUTCString() } }) }), error => {
    assert.ok(error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 60)
    assert.equal(typeof safeJobFailure(error).retryAfterSeconds, 'number')
    return true
  })
  assert.equal(safeJobFailure({ code: 'MODEL_HTTP_ERROR', status: 500, retryAfterSeconds: 30, limitSource: 'provider' }).retryAfterSeconds, undefined)
  assert.equal(safeJobFailure({ code: 'MODEL_TIMEOUT', status: 429, retryAfterSeconds: 30 }).retryAfterSeconds, undefined)
})

test('a stalled 429 error body cannot delay known rejection indefinitely or become an unknown model dispatch', async () => {
  const start = Date.now(); let cancelled = false
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')); }, cancel() { cancelled = true } })
  await assert.rejects(generateJson(input, { config, request: async () => new Response(body, { status: 429, headers: { 'Retry-After': '30' } }) }), error => error.code === 'MODEL_HTTP_ERROR' && error.status === 429 && error.retryAfterSeconds === 30)
  assert.equal(cancelled, true)
  assert.ok(Date.now() - start < 5000)
})
