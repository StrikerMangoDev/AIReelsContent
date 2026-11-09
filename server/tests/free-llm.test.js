import test from 'node:test'
import assert from 'node:assert/strict'
import { generateJson, readFreeGenerationReceipt, generationReceipt } from '../providers/llm.js'
import { researchNiche } from '../studio/intelligence.js'
import { generateMedia } from '../media/provider.js'
import { generateContent } from './helpers/passage-model.js'
import { safeJobFailure } from '../studio/job-worker.js'

test('native complete JSON at length is opt-in, preserves truthful receipt and never repairs partial output', async () => {
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-super-vl:free' }
  const input = { system: 'JSON', input: {}, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } }
  const response = content => async () => Response.json({ id: 'gen-123-complete', choices: [{ finish_reason: 'length', message: { content } }], usage: { prompt_tokens: 12, completion_tokens: 6000, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })
  const full = '{"ok":true}   \n\t'
  await assert.rejects(generateJson(input, { config, request: response(full) }), { code: 'MODEL_INCOMPLETE' })
  const value = await generateJson(input, { config, request: response(full), acceptCompleteJsonAtLength: true })
  assert.deepEqual(value, { ok: true })
  const receipt = generationReceipt(value)
  assert.equal(receipt.finishReason, 'length'); assert.equal(receipt.acceptedCompleteJsonAtLength, true); assert.equal(receipt.schemaValidated, false)
  assert.equal(receipt.generationId, 'gen-123-complete'); assert.equal(receipt.completionTokens, 6000); assert.equal(receipt.providerReportedCost, 0); assert.equal(receipt.billingVerified, false)
  assert.equal(JSON.stringify(value).includes('generationId'), false)
  for (const content of ['{"ok":', '{"ok":true} extra', 'null', '[]', '{}', '{"ok":true,"extra":false}', '{"$schema":"private"}', '{"type":"object","properties":{}}', '```json\n{"ok":true}\n```']) {
    await assert.rejects(generateJson(input, { config, request: response(content), acceptCompleteJsonAtLength: true }), { code: 'MODEL_INCOMPLETE' })
  }
  await assert.rejects(generateJson(input, { config: { ...config, LLM_MODEL: 'nvidia/nemotron-3.5-lightning:free' }, request: response(full), acceptCompleteJsonAtLength: true }), { code: 'MODEL_INCOMPLETE' })
  await assert.rejects(generateJson(input, { config, request: response('{"other":true}'), acceptCompleteJsonAtLength: true }), error => {
    const diagnostic = safeJobFailure(error)
    assert.equal(diagnostic.wholeJsonObject, true); assert.equal(diagnostic.missingExpectedFieldCount, 1); assert.equal(diagnostic.extraFieldCount, 1); assert.equal(diagnostic.fullFence, false)
    assert.equal(JSON.stringify(diagnostic).includes('other'), false)
    return true
  })
})

test('truncated native JSON records bounded usage and output-shape diagnostics without retaining content', async () => {
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-super-vl:free' }
  const cases = [
    { text: '   \n\t', reasoning: 6000, schema: false },
    { text: '{"$schema":"private schema payload"', reasoning: 0, schema: true },
    { text: '{"website":{"title":"private truncated content"', reasoning: 37, schema: false },
  ]
  for (const item of cases) {
    let calls = 0
    await assert.rejects(generateJson({ system: 'JSON', input: {}, schema: {}, maxTokens: 6000 }, { config, request: async () => {
      calls++
      return Response.json({ id: 'gen-123-diagnostics', choices: [{ finish_reason: 'length', message: { content: item.text, reasoning: 'private hidden reasoning' } }], usage: { prompt_tokens: 2500, completion_tokens: 6000, completion_tokens_details: { reasoning_tokens: item.reasoning }, private_metadata: 'private' } })
    } }), error => {
      assert.equal(error.code, 'MODEL_INCOMPLETE'); assert.equal(error.finishReason, 'length')
      assert.equal(error.promptTokens, 2500); assert.equal(error.completionTokens, 6000); assert.equal(error.reasoningTokens, item.reasoning)
      assert.equal(error.outputChars, item.text.length); assert.equal(error.outputNonWhitespaceChars, item.text.replace(/\s/g, '').length)
      assert.equal(error.startsSchemaDefinition, item.schema)
      const safe = safeJobFailure(error)
      assert.equal(safe.reasoningTokens, item.reasoning); assert.equal(safe.outputChars, item.text.length); assert.equal(safe.startsSchemaDefinition, item.schema)
      assert.equal(JSON.stringify(error).includes('private'), false); assert.equal(JSON.stringify(safe).includes('private'), false)
      return true
    })
    assert.equal(calls, 1, 'diagnostics do not retry or accept truncated JSON')
  }
  const safe = safeJobFailure({ code: 'MODEL_INCOMPLETE', promptTokens: -1, completionTokens: '6000', reasoningTokens: { secret: true }, outputChars: 10000001, outputNonWhitespaceChars: 1.5, startsSchemaDefinition: 'private' })
  for (const key of ['promptTokens', 'completionTokens', 'reasoningTokens', 'outputChars', 'outputNonWhitespaceChars', 'startsSchemaDefinition']) assert.equal(safe[key], undefined)
})

test('recovery accepts only matching terminal zero-cost NVIDIA receipts, never unknown or paid outcomes', async () => {
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only' }
  const data = { id: 'gen-123-safe', model: 'nvidia/nemotron-3.5-lightning:free', total_cost: 0, cancelled: false, native_finish_reason: 'length' }
  const call = patch => readFreeGenerationReceipt(data.id, { config, request: async () => Response.json({ data: { ...data, ...patch } }) })
  assert.equal((await call({})).actualMicros, 0)
  for (const patch of [{ id: 'gen-other' }, { model: 'google/paid' }, { total_cost: 1 }, { cancelled: true }, { native_finish_reason: 'unknown' }, { native_finish_reason: undefined }]) await assert.rejects(call(patch), /not verified/)
  await assert.rejects(readFreeGenerationReceipt('invalid-id', { config }), /unavailable/)
})

test('generation prompt treats misleading research summaries as leads and preserves each cited source period', async () => {
  const evidence = [{ id: 'E1', excerpt: 'Horoscopes Today, October 25, 2026 - USA Today.' }]
  const context = { opportunity: { title: 'Four weekly horoscopes', whatChanged: 'All four cover October 25-31.', angle: 'Magazine and celebrity weekly comparison' } }
  let calls = 0
  const result = await generateContent(evidence, { outputs: ['script'] }, context, async request => {
    calls++
    assert.match(request.system, /whatChanged.*untrusted editorial leads, never as factual evidence/)
    assert.match(request.system, /daily item must not be called weekly or grouped into a weekly set/)
    assert.match(request.system, /preserve the dates, period, population and scope of each cited claim/)
    assert.match(request.system, /citation marker does not permit prose that contradicts its claim/)
    assert.match(request.system, /Do not infer publisher categories, mechanisms, consensus or causal explanations/)
    assert.deepEqual(request.input.evidence, evidence)
    assert.equal(request.input.context.opportunity.whatChanged, context.opportunity.whatChanged)
    return { hooks: ['A daily horoscope [C1]'], script: 'USA Today lists a daily horoscope for October 25, 2026. [C1]', claims: [{ id: 'C1', text: 'USA Today daily horoscope for October 25, 2026.', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }] }
  })
  assert.equal(calls, 1); assert.match(result.script, /daily/)
  assert.equal(result.claims[0].quote, evidence[0].excerpt)
})

test('native JSON-capable free model receives the exact schema with the same zero-price ceiling', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
  const result = await generateJson({ system: 'JSON', input: {}, schema }, { config: { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-super-vl:free' }, request: async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.tools, undefined); assert.equal(body.tool_choice, undefined)
    assert.deepEqual(body.response_format.json_schema.schema, schema)
    assert.equal(body.response_format.json_schema.strict, true)
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 })
    assert.deepEqual(body.reasoning, { enabled: false, effort: 'none' })
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] })
  } })
  assert.deepEqual(result, { ok: true })
})

test('native-capable model uses the existing named-tool protocol only when explicitly preferred', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-super-vl:free' }
  for (const name of ['submit_json', 'unrequested_action']) {
    const call = generateJson({ system: 'JSON', input: {}, schema }, { config, preferTools: true, request: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.response_format, undefined)
      assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'submit_json' } })
      assert.deepEqual(body.tools[0].function.parameters, schema)
      assert.equal(body.tools[0].function.strict, true)
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 })
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name, arguments: '{"ok":true}' } }] } }] })
    } })
    if (name === 'submit_json') assert.deepEqual(await call, { ok: true })
    else await assert.rejects(call, { code: 'MODEL_INCOMPLETE' })
  }
})

test('HTTP200 provider errors retain only bounded numeric diagnostics without retrying or leaking metadata', async () => {
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-lightning:free' }
  let calls = 0
  for (const code of [503, '503', { secret: 'private' }, 999, 200, 401.5]) {
    await assert.rejects(generateJson({ system: 'JSON', input: {}, schema: {} }, { config, request: async () => { calls++; return Response.json({ id: 'gen-123-safe', error: { code, message: 'private message', metadata: { raw: 'private payload' } } }) } }), error => {
      assert.equal(error.code, 'MODEL_INCOMPLETE')
      assert.equal(error.transportStatus, 200)
      assert.equal(error.providerErrorCode, code === 503 ? 503 : undefined)
      assert.equal(error.generationId, 'gen-123-safe')
      assert.equal(JSON.stringify(error).includes('private'), false)
      assert.equal(error.message.includes('private'), false)
      return true
    })
  }
  assert.equal(calls, 6)
})

test('large research requests have a bounded 180s timeout, brief help keeps 90s and timeouts never retry', async t => {
  const timeouts = []
  t.mock.method(AbortSignal, 'timeout', value => { timeouts.push(value); return new AbortController().signal })
  let calls = 0
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-lightning:free' }
  for (const maxTokens of [3000, 8000]) {
    await assert.rejects(generateJson({ system: 'JSON', input: {}, schema: {}, maxTokens }, { config, request: async () => { calls++; throw new DOMException('private transport details', 'TimeoutError') } }), error => error.code === 'MODEL_TIMEOUT' && !error.message.includes('private'))
  }
  assert.deepEqual(timeouts, [90000, 180000]); assert.equal(calls, 2)
})

test('timeout after HTTP headers but during body read is classified without content leakage', async t => {
  const controller = new AbortController()
  t.mock.method(AbortSignal, 'timeout', () => controller.signal)
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-lightning:free' }
  await assert.rejects(generateJson({ system: 'JSON', input: {}, schema: {} }, { config, request: async () => ({ ok: true, json: async () => { controller.abort(); throw new DOMException('private body', 'AbortError') } }) }), error => error.code === 'MODEL_TIMEOUT' && !error.message.includes('private'))
})

test('free model requests enforce zero pricing and never retry or use a paid/Gemini model', async () => {
  const config = { CONTENT_LIVE_FREE_CALLS: 'true', OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3.5-lightning:free' }
  const input = { system: 'Return JSON', input: {}, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }
  let calls = 0
  const request = async (url, options) => {
    calls++
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(options.body)
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 })
    assert.equal(body.response_format, undefined); assert.equal(body.provider.require_parameters, true)
    assert.equal(body.model, config.LLM_MODEL)
    assert.deepEqual(body.reasoning, { enabled: false, effort: 'none' })
    assert.match(body.messages[0].content, /JSON DATA INSTANCE, never the JSON Schema itself/)
    assert.match(body.messages[0].content, /top-level data keys are: ok/ )
    assert.deepEqual(body.tools[0].function.parameters, input.schema)
    assert.equal(body.tool_choice.function.name, 'submit_json')
    assert.equal(body.models, undefined); assert.equal(body.plugins, undefined)
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] })
  }
  assert.deepEqual(await generateJson(input, { config, request }), { ok: true })
  assert.deepEqual(await generateJson(input, { config, request: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'submit_json', arguments: '{"ok":true}' } }] } }] }) }), { ok: true })
  for (const toolCall of [{ function: { name: 'submit_json', arguments: '{"ok":true}' } }, { type: 'function', function: { name: 'submit_json', arguments: { ok: true } } }]) {
    assert.deepEqual(await generateJson(input, { config, request: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [toolCall] } }] }) }), { ok: true })
  }
  assert.deepEqual(await generateJson(input, { config, request: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: '{"ok":true}' } }] }) }), { ok: true })
  for (const toolCalls of [[{ type: 'function', function: { name: 'unrequested_action', arguments: '{}' } }], [{ type: 'function', function: { name: 'submit_json', arguments: '{}' } }, { type: 'function', function: { name: 'submit_json', arguments: '{}' } }]]) {
    await assert.rejects(generateJson(input, { config, request: async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: toolCalls } }] }) }), error => error.code === 'MODEL_INCOMPLETE')
  }
  for (const content of ['```json\n{"ok":true}\n```', '```\n{"ok":true}\n```']) {
    assert.deepEqual(await generateJson(input, { config, request: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] }) }), { ok: true })
  }
  for (const content of ['Commentary\n```json\n{"ok":true}\n```', '```json\n{"ok":\n```', '```json\n{}\n```\n```json\n{}\n```']) {
    await assert.rejects(generateJson(input, { config, request: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] }) }), error => error.code === 'MODEL_JSON_INVALID')
  }
  for (const model of ['google/gemini:free', 'nvidia/nemotron-paid', 'openrouter/auto']) {
    await assert.rejects(generateJson(input, { config: { ...config, LLM_MODEL: model }, request }), /Only free NVIDIA/)
  }
  assert.equal(calls, 1)
  await assert.rejects(generateJson(input, { config, request: async () => { calls++; return new Response('', { status: 429 }) } }), /429/)
  assert.equal(calls, 2)
  await assert.rejects(generateJson(input, { config, request: async () => Response.json({ id: 'gen-123-safe', choices: [{ finish_reason: 'length', message: { content: 'private truncated content' } }] }) }), error => error.code === 'MODEL_INCOMPLETE' && error.generationId === 'gen-123-safe' && error.finishReason === 'length' && !error.message.includes('private'))
  let malformedCalls = 0
  await assert.rejects(generateJson(input, { config, request: async () => { malformedCalls++; return Response.json({ id: 'gen-456-safe', choices: [{ finish_reason: 'stop', message: { content: 'Here is your answer: not JSON' } }] }) } }), error => error instanceof SyntaxError && error.generationId === 'gen-456-safe' && error.finishReason === 'stop')
  assert.equal(malformedCalls, 1)
  await assert.rejects(generateMedia('audio', 'test'), /blocked/)
})

test('research uses dated news evidence and stops before inference when no sources exist', async () => {
  const niche = { name: 'AI', brief: 'Recent AI announcements', windowDays: 1 }
  let calls = 0
  const generate = async ({ input }) => {
    calls++
    assert.equal(input.evidence.length, 1)
    assert.equal(input.evidence[0].type, 'news-feed-excerpt')
    assert.equal(input.evidence[0].excerpt, 'A new model was announced')
    return { summary: 'An announcement', opportunities: [], unknowns: ['Full article not retrieved'] }
  }
  const article = { url: 'https://news.google.com/rss/articles/test', title: 'A new model was announced', publishedAt: new Date().toISOString() }
  const report = await researchNiche(niche, { generate, read: async (source, options) => {
    assert.equal(new URL(source.feedUrl).searchParams.get('q'), 'AI when:1d')
    assert.equal(options.maxAgeHours, 24)
    return [article, article]
  } })
  assert.equal(report.evidence.length, 1)
  const empty = await researchNiche(niche, { generate, read: async () => [] })
  assert.deepEqual(empty.evidence, [])
  assert.deepEqual(empty.opportunities, [])
  assert.match(empty.summary, /No model synthesis/)
  assert.equal(calls, 1)
})

test('content correction is bounded and cannot bypass evidence validation or retry quota errors', async () => {
  const evidence = [{ id: 'E1', excerpt: 'The publisher announced a model preview.' }]
  const valid = { hooks: ['A preview [C1]'], script: 'A preview [C1]', scenes: [{ timing: '0-15s', narration: 'A preview [C1]', onScreen: 'Preview', visualPrompt: 'Abstract', voiceDirection: 'Calm' }], captions: { reel: 'A preview [C1]', linkedin: 'A preview [C1]' }, website: { title: 'Preview', body: 'A preview [C1]' }, claims: [{ id: 'C1', text: 'A preview', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }] }
  valid.strategy = {
    angle: 'An attributed announcement', audience: 'Readers', whyNow: 'Recent announcement', factCheck: 'Independent review pending',
    language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Creative choice', delivery: 'Calm', keywords: ['preview'],
    platforms: [{ platform: 'Instagram', headline: 'A preview [C1]', hook: 'A preview [C1]', body: 'A preview [C1]', cta: 'Read the source', hashtags: [], thumbnail: 'Illustrative', format: 'Reel', retentionPlan: 'Explain the preview', alternativeHook: 'An announcement [C1]', testPlan: 'Observe engagement' }],
    production: { videoPrompt: 'Illustrative', audioPrompt: 'Calm', musicDirection: 'None', subtitleStyle: 'Readable', editingNotes: 'Retain attribution' },
    experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Observed engagement', decisionRule: 'Compare equal exposure' }],
  }
  const invalid = { ...valid, hooks: ['Missing citation'] }
  let calls = 0
  assert.deepEqual(await generateContent(evidence, {}, {}, async request => {
    calls++
    if (calls === 1) return invalid
    assert.ok(request.input.corrections.some(issue => issue.includes('hooks.0')))
    return valid
  }), valid)
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(generateContent(evidence, {}, {}, async () => { calls++; return invalid }), { code: 'EVIDENCE_VALIDATION' })
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(generateContent(evidence, {}, {}, async () => { calls++; throw Object.assign(new Error('Quota'), { status: 429 }) }), { status: 429 })
  assert.equal(calls, 1)
})

test('model JSON and schema corrections share one bounded allowance and never retry transport parsing', async () => {
  const evidence = [{ id: 'E1', excerpt: 'The publisher announced a model preview.' }]
  const valid = { hooks: ['Preview [C1]'], script: 'Preview [C1]', claims: [{ id: 'C1', text: 'Preview', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }] }
  for (const first of ['json', 'schema']) {
    let calls = 0; let checks = 0
    const result = await generateContent(evidence, { outputs: ['script'] }, {}, async request => {
      calls++
      if (calls === 1) { if (first === 'json') throw Object.assign(new SyntaxError('Bad model JSON'), { code: 'MODEL_JSON_INVALID' }); return { unexpected: 'private output must not leak to errors' } }
      assert.ok(request.input.corrections.length); return valid
    }, { beforeAttempt: async () => { checks++ } })
    assert.deepEqual(result, valid); assert.equal(calls, 2); assert.equal(checks, 2)
  }
  let calls = 0
  await assert.rejects(generateContent(evidence, { outputs: ['script'] }, {}, async () => { calls++; if (calls === 1) throw Object.assign(new SyntaxError('Bad output'), { code: 'MODEL_JSON_INVALID' }); return {} }), error => error.code === 'EVIDENCE_VALIDATION' && error.issueCount > 0)
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(generateContent(evidence, { outputs: ['script'] }, {}, async () => { calls++; throw new SyntaxError('Malformed API envelope') }), SyntaxError)
  assert.equal(calls, 1)
})
