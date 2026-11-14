import test from 'node:test'
import assert from 'node:assert/strict'
import { generateContent, reviewContent } from '../studio/content.js'
import { evidencePassages } from '../studio/evidence-passages.js'
const evidence = [{ id: 'E1', excerpt: 'A publisher announced a preview [C1, C2] with limited access.' }, { id: 'E2', excerpt: 'A publisher announced a preview [C1, C2] with limited access.' }]
const draft = passages => ({ hooks: ['Preview [C1] [C2]'], script: 'Preview [C1, C2]', claims: ['C1', 'C2'].map(id => ({ id, text: 'An attributed preview', evidenceId: 'E1', passageId: passages[0].id, status: 'attributed' })) })

test('bounded source passages preserve sentences and decimal model versions at chunk boundaries', () => {
  const sentence = 'Claude Fable 5.2 and Mythos 5.2 share the same underlying model. '
  const source = { id: 'E1', excerpt: 'Earlier context. '.repeat(34) + sentence + 'More context. '.repeat(60) }
  const passages = evidencePassages([source])
  assert.ok(passages.some(passage => passage.quote.includes(sentence)))
  assert.ok(passages.every(passage => passage.quote.length <= 600 && source.excerpt.includes(passage.quote)))
  assert.deepEqual(passages, evidencePassages([source]))
})

test('caption citations are required by the model schema and remain checked after generation', async () => {
  let calls = 0
  const value = await generateContent(evidence, { outputs: ['script', 'captions'] }, {}, async request => {
    calls++
    assert.ok(request.schema.properties.captions.properties.reel.pattern)
    assert.ok(request.schema.properties.captions.properties.linkedin.pattern)
    if (calls === 2) assert.ok(request.input.corrections.some(issue => issue.includes('captions.reel')))
    return { ...draft(request.input.passages), captions: { reel: calls === 1 ? 'Uncited preview' : 'A preview [C1]', linkedin: 'A preview [C1]' } }
  })
  assert.equal(calls, 2)
  assert.deepEqual(reviewContent(value, evidence, { outputs: ['script', 'captions'] }).issues, [])
})

test('scene citation errors are part of the model schema and receive a specific bounded correction', async () => {
  let calls = 0
  const value = await generateContent(evidence, { outputs: ['script', 'production'] }, {}, async request => {
    calls++
    assert.ok(request.schema.properties.scenes.items.properties.narration.pattern)
    // Constrained providers may apply the pattern to the whole generated field.
    assert.ok(new RegExp(`^(?:${request.schema.properties.scenes.items.properties.narration.pattern})$`).test('A publisher fact [C1].'))
    assert.ok(new RegExp(`^(?:${request.schema.properties.hooks.items.pattern})$`).test('A publisher headline [C1]'))
    if (calls === 2) assert.ok(request.input.corrections.some(issue => issue.includes('scenes.0.narration') && issue.includes('[C1]')))
    return { ...draft(request.input.passages), scenes: [{ timing: '0-15s', narration: calls === 1 ? 'A preview' : 'A preview [C1]', onScreen: 'Preview', visualPrompt: 'Illustrative text', voiceDirection: 'Clear' }], strategy: { angle: 'Preview', audience: 'Readers', whyNow: 'Headline', factCheck: 'Review source', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Clear', keywords: ['preview'], production: { videoPrompt: 'Text slide', audioPrompt: 'Read the narration', musicDirection: 'None', subtitleStyle: 'Readable', editingNotes: 'Review before publishing' } } }
  })
  assert.equal(calls, 2)
  assert.deepEqual(reviewContent(value, evidence, { outputs: ['script', 'production'] }).issues, [])
})

test('publisher headlines cannot be used as quotations for capture limitations; revisions omit prior claim pairs', async () => {
  const source = { id: 'E1', type: 'news-feed-excerpt', excerpt: 'Weekly Horoscope Prediction, October 25 to October 31, 2026.' }
  const previousContent = { script: 'Only headline excerpts were retrieved [C1].', claims: [{ id: 'C1', text: 'Only headline excerpts were retrieved', evidenceId: 'E1', quote: source.excerpt, status: 'attributed' }] }
  assert.ok(reviewContent(previousContent, [source], { outputs: ['script'] }).issues.some(issue => issue.includes('capture limitations')))
  const generated = await generateContent([source], { outputs: ['script'] }, { previousContent }, async request => {
    assert.equal(request.input.context.previousContent, null)
    return { script: 'A weekly horoscope headline covers October 25 to 31 [C1].', hooks: ['A weekly horoscope headline [C1]'], claims: [{ id: 'C1', text: 'A weekly horoscope headline covers October 25 to 31.', evidenceId: 'E1', passageId: request.input.passages[0].id, status: 'attributed' }] }
  })
  assert.deepEqual(reviewContent(generated, [source], { outputs: ['script'] }).issues, [])
  assert.ok(previousContent.claims[0].quote)
  const markersOnly = { ...generated, script: '[C1]', hooks: ['[C1]'] }
  assert.ok(reviewContent(markersOnly, [source], { outputs: ['script'] }).issues.some(issue => issue.includes('actual content')))
  const missingYear = { ...source, excerpt: 'Weekly Horoscope Prediction, October 25 to October 31.' }
  const overstated = structuredClone(generated); overstated.claims[0].quote = missingYear.excerpt; overstated.claims[0].text += ' In 2026.'
  assert.ok(reviewContent(overstated, [missingYear], { outputs: ['script'] }).issues.some(issue => issue.includes('dates and numbers')))
})
test('passages are bounded exact source-bound text; persisted claims preserve quote and normalize only prose groups', async () => {
  const passages = evidencePassages(evidence)
  assert.notEqual(passages[0].id, passages[1].id)
  assert.deepEqual(passages, evidencePassages(evidence))
  assert.ok(passages.every(passage => evidence.find(source => source.id === passage.evidenceId).excerpt.includes(passage.quote)))
  const result = await generateContent(evidence, { outputs: ['script'] }, {}, async request => draft(request.input.passages))
  assert.equal(result.script, 'Preview [C1] [C2]')
  assert.equal(result.claims[0].quote, evidence[0].excerpt)
  assert.equal(result.claims[0].passageId, undefined)
  assert.deepEqual(reviewContent(result, evidence, { outputs: ['script'] }).issues, [])
  assert.equal(evidencePassages([{ id: 'E1', excerpt: 'x'.repeat(20000) }]).length, 12)
})
test('unknown, missing, malformed, cross-source and quote override claims fail closed within two attempts', async () => {
  for (const mutation of [claim => { claim.passageId = 'P' + '0'.repeat(24) }, claim => { delete claim.passageId }, claim => { claim.passageId = '../E1' }, claim => { claim.evidenceId = 'E2' }, claim => { claim.quote = 'invented' }]) {
    let calls = 0
    await assert.rejects(generateContent(evidence, { outputs: ['script'] }, {}, async request => { calls++; const value = draft(request.input.passages); mutation(value.claims[0]); return value }), { code: 'EVIDENCE_VALIDATION' })
    assert.equal(calls, 2)
  }
  await assert.rejects(generateContent(evidence, { outputs: ['script'] }, {}, async request => ({ ...draft(request.input.passages), script: 'Unsupported [C1, C99]' })), { code: 'EVIDENCE_VALIDATION' })
})
test('editorial correction preserves internal passage contract and never sends resolved quotes as model output', async () => {
  let calls = 0
  await generateContent(evidence, { outputs: ['script'] }, {}, async request => {
    calls++
    if (calls === 2) { assert.equal(request.input.draft, undefined); assert.ok(request.input.validatedClaims[0].passageId); assert.equal(request.input.validatedClaims[0].quote, undefined) }
    return { ...draft(request.input.passages), hooks: ['Preview [C1]'], script: calls === 1 ? 'Missing reference' : 'Preview [C1]' }
  })
  assert.equal(calls, 2)
})

test('URL-bearing evidence offers exact separate passages without joining across excluded URLs', async () => {
  const sources = [{ id: 'E1', excerpt: 'Publisher announced a preview. https://example.com/details Read the source for availability limitations.' }]
  const passages = evidencePassages(sources)
  assert.equal(passages.length, 2)
  assert.ok(passages.every(passage => sources[0].excerpt.includes(passage.quote) && !passage.quote.includes('https://')))
  const result = await generateContent(sources, { outputs: ['script'] }, {}, async request => draft(request.input.passages))
  assert.deepEqual(reviewContent(result, sources, { outputs: ['script'] }).issues, [])
})

test('internal hook schema requires individual citations and correction retains an explicit example', async () => {
  let calls = 0
  await generateContent(evidence, { outputs: ['script'] }, {}, async request => {
    calls++
    assert.equal(request.schema.properties.hooks.maxItems, 5)
    assert.ok(request.schema.properties.hooks.items.pattern)
    assert.ok(request.system.includes('A reported finding [C1]'))
    if (calls === 2) assert.ok(request.input.corrections.some(issue => issue.includes('hooks.0')))
    return { ...draft(request.input.passages), hooks: [calls === 1 ? 'What could change?' : 'A reported finding [C1]'] }
  })
  assert.equal(calls, 2)
  await assert.rejects(generateContent(evidence, { outputs: ['script'] }, {}, async request => ({ ...draft(request.input.passages), hooks: ['Still uncited'] })), { code: 'EVIDENCE_VALIDATION' })
})
