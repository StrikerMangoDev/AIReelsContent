import test from 'node:test'
import assert from 'node:assert/strict'
import { generateJson } from '../providers/llm.js'
import { researchNiche } from '../studio/intelligence.js'
import { generateMedia } from '../media/provider.js'
import { generateContent } from '../studio/content.js'

test('free model requests enforce zero pricing and never retry or use a paid/Gemini model', async () => {
  const config = { OPENROUTER_API_KEY: 'test-only', LLM_MODEL: 'nvidia/nemotron-3-super-120b-a12b:free' }
  const input = { system: 'Return JSON', input: {}, schema: { type: 'object' } }
  let calls = 0
  const request = async (url, options) => {
    calls++
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(options.body)
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 })
    assert.equal(body.models, undefined); assert.equal(body.plugins, undefined)
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] })
  }
  assert.deepEqual(await generateJson(input, { config, request }), { ok: true })
  for (const model of ['google/gemini:free', 'nvidia/nemotron-paid', 'openrouter/auto']) {
    await assert.rejects(generateJson(input, { config: { ...config, LLM_MODEL: model }, request }), /Only free NVIDIA/)
  }
  assert.equal(calls, 1)
  await assert.rejects(generateJson(input, { config, request: async () => { calls++; return new Response('', { status: 429 }) } }), /429/)
  assert.equal(calls, 2)
  await assert.rejects(generateJson(input, { config, request: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) }), /incomplete/)
  await assert.rejects(generateMedia('audio', 'test'), /disabled/)
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
  await assert.rejects(researchNiche(niche, { generate, read: async () => [] }), /no current sources/)
  assert.equal(calls, 1)
})

test('content correction is bounded and cannot bypass evidence validation or retry quota errors', async () => {
  const evidence = [{ id: 'E1', excerpt: 'The publisher announced a model preview.' }]
  const valid = { hooks: ['A preview [C1]'], script: 'A preview [C1]', scenes: [{ timing: '0-15s', narration: 'A preview [C1]', onScreen: 'Preview', visualPrompt: 'Abstract', voiceDirection: 'Calm' }], captions: { reel: 'A preview [C1]', linkedin: 'A preview [C1]' }, website: { title: 'Preview', body: 'A preview [C1]' }, claims: [{ id: 'C1', text: 'A preview', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }] }
  const invalid = { ...valid, hooks: ['Missing citation'] }
  let calls = 0
  assert.deepEqual(await generateContent(evidence, {}, {}, async request => {
    calls++
    if (calls === 1) return invalid
    assert.ok(request.input.corrections.some(issue => issue.includes('hook 1')))
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
