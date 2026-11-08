import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { generateVertexJson, vertexSchema } from '../providers/vertex-fallback.js'
import { generateContent, reviewContent } from '../studio/content.js'

const config = { CONTENT_VERTEX_FALLBACK: 'true', VERTEX_FALLBACK_MODEL: 'gemini-3.8-flash', VERTEX_FALLBACK_PROJECT: 'approved-project', VERTEX_FALLBACK_CREDENTIALS: 'never-read-in-mock', VERTEX_FALLBACK_APPROVED_UNTIL: new Date(Date.now() + 3600000).toISOString() }
const input = { system: 'Return data', input: {}, schema: { type: 'object' }, maxTokens: 1000 }

test('Vertex fallback requires approval, monetary admission and unique dispatch; usage settles while failures retain holds', async () => {
  const repository = createRepository(':memory:')
  let calls = 0; let checks = 0
  const options = { repository, owner: 'alice', requestId: 'vertex-test-1', config, beforeAttempt: async () => { checks++ }, request: async () => { calls++; return { text: '{"ok":true}', candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, thoughtsTokenCount: 0 } } } }
  try {
    await assert.rejects(generateVertexJson(input, options), /budget exhausted/)
    assert.equal(calls, 0)
    repository.budgetConfigure('USD', 'alice', 500000, 500000)
    await assert.rejects(generateVertexJson(input, { ...options, config: { ...config, CONTENT_VERTEX_FALLBACK: 'false' } }), /not authorized/)
    await assert.rejects(generateVertexJson(input, { ...options, config: { ...config, VERTEX_FALLBACK_APPROVED_UNTIL: '2000-01-01' } }), /not authorized/)
    assert.deepEqual(await generateVertexJson(input, options), { ok: true })
    assert.equal(checks, 1); assert.equal(calls, 1)
    assert.equal(repository.budgetGet('alice', options.requestId).actualMicros, 825)
    await assert.rejects(generateVertexJson(input, options), /already exists/)
    assert.equal(calls, 1)
    await assert.rejects(generateVertexJson(input, { ...options, requestId: 'vertex-failed', request: async () => { throw new Error('private provider payload') } }), error => !error.message.includes('private') && error.code === 'VERTEX_REQUEST_FAILED')
    assert.equal(repository.budgetGet('alice', 'vertex-failed').status, 'dispatch_unknown')
    assert.ok(repository.budgetSummary('alice').heldMicros > 0)
    await assert.rejects(generateVertexJson(input, { ...options, requestId: 'vertex-invalid', request: async () => { throw Object.assign(new Error('Invalid request'), { status: 400 }) } }), error => error.code === 'VERTEX_REQUEST_FAILED')
    assert.equal(repository.budgetGet('alice', 'vertex-invalid').actualMicros, 0)
  } finally { repository.close() }
})

test('Vertex grammar keeps structure without unsupported constraint complexity; server schema remains intact', () => {
  const schema = { $schema: 'schema', type: 'object', required: ['claims'], properties: { claims: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1, pattern: '^C' } } } }
  assert.deepEqual(vertexSchema(schema), { type: 'object', required: ['claims'], properties: { claims: { type: 'array', items: { type: 'string' } } } })
  assert.equal(schema.properties.claims.maxItems, 30)
  assert.deepEqual(vertexSchema({ type: 'string', const: 'attributed' }), { type: 'string', enum: ['attributed'] })
})

test('publisher headline citations cannot turn daily forecasts into weekly ones or invent publication dates', () => {
  const evidence = [{ id: 'E1', type: 'news-feed-excerpt', excerpt: 'Horoscopes Today, October 25, 2026 USA Today' }]
  const claims = [{ id: 'C1', text: 'USA Today published horoscopes for October 25, 2026.', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }]
  const base = { claims, script: 'USA Today published daily horoscopes for October 25, 2026 [C1].', hooks: ['Daily horoscope headlines [C1].'] }
  assert.deepEqual(reviewContent(base, evidence, { outputs: ['script'] }).issues, [])
  assert.ok(reviewContent({ ...base, hooks: ['The weekly horoscope lineup from USA Today [C1].'] }, evidence).issues.some(issue => issue.includes('daily horoscope')))
  assert.ok(reviewContent({ ...base, script: 'USA Today published daily horoscopes on October 24 [C1].' }, evidence).issues.some(issue => issue.includes('dates and numbers')))
  const strategy = { angle: 'Report the headline', audience: 'Readers', whyNow: 'An editorial idea', factCheck: 'Headline only', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Clear', keywords: ['horoscopes'], platforms: [{ platform: 'Instagram', headline: 'Daily horoscope [C1]', hook: 'Daily horoscope [C1]', body: 'Weekly horoscope for October 24 [C1]', alternativeHook: 'Daily headline [C1]', cta: 'Read the source', hashtags: [], thumbnail: 'Headline card', format: 'Post', retentionPlan: 'Test clarity', testPlan: 'Compare two hooks' }] }
  const issues = reviewContent({ ...base, strategy }, evidence).issues
  assert.ok(issues.some(issue => issue.startsWith('Instagram body:') && issue.includes('daily horoscope')))
  assert.ok(issues.some(issue => issue.startsWith('Instagram body:') && issue.includes('dates and numbers')))
})

test('fallback receives the same evidence contract only after a free-provider failure or a saved prior failure', async () => {
  const evidence = [{ id: 'E1', excerpt: 'The publisher announced a preview with limited access.' }]
  let freeCalls = 0; let vertexCalls = 0
  const fallback = async request => { vertexCalls++; return { script: 'The publisher announced a preview [C1].', hooks: ['A publisher preview [C1]'], claims: [{ id: 'C1', text: 'The publisher announced a preview', evidenceId: 'E1', passageId: request.input.passages[0].id, status: 'attributed' }] } }
  const free = async () => { freeCalls++; throw Object.assign(new Error('Gateway timeout'), { code: 'MODEL_HTTP_ERROR', status: 504 }) }
  const result = await generateContent(evidence, { outputs: ['script'] }, {}, free, { fallback })
  assert.equal(result.claims[0].quote, evidence[0].excerpt)
  assert.equal(freeCalls, 1); assert.equal(vertexCalls, 1)
  await generateContent(evidence, { outputs: ['script'] }, {}, free, { fallback, startWithFallback: true })
  assert.equal(freeCalls, 1); assert.equal(vertexCalls, 2)
})
