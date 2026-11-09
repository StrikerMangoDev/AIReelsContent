import test from 'node:test'
import assert from 'node:assert/strict'
import { generateContent, reviewContent } from '../studio/content.js'
import { citationSentences } from '../studio/citation-sentences.js'

const evidence = [{ id: 'E1', type: 'article', excerpt: 'The publisher announced a limited developer preview. The preview is available to selected developers and does not establish broad deployment.' }]
const claim = { id: 'C1', text: 'The publisher announced a limited developer preview', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }
const base = { claims: [claim], website: { title: 'A limited developer preview', body: 'The publisher announced a limited developer preview [C1].' } }
const context = { automationAccountId: 'account' }
function draft(request, count = 1) {
  return { website: base.website, claims: Array.from({ length: count }, (_, index) => ({ id: `C${index + 1}`, text: claim.text, evidenceId: 'E1', passageId: request.input.passages[0].id, status: 'attributed' })) }
}
function adaptation(body) {
  return { angle: 'Report the preview', audience: 'Developers', whyNow: 'A source-backed update', factCheck: 'Preserve limited access', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Clear', keywords: ['preview'], platforms: [{ platform: 'X', headline: 'Limited developer preview [C1]', hook: 'A limited preview [C1]', body, alternativeHook: 'Developer preview [C1]', cta: 'Read the source', hashtags: [], thumbnail: 'Preview card', format: 'Post', retentionPlan: 'Test clarity', testPlan: 'Compare hooks' }] }
}

test('automation schema caps three claims while ordinary writing retains thirty and fixes oversized output within two attempts', async () => {
  let attempts = 0
  const result = await generateContent(evidence, { outputs: ['website'] }, context, async request => {
    attempts++
    assert.equal(request.schema.properties.claims.maxItems, 3)
    assert.match(request.system, /48 words/)
    if (attempts === 2) assert.ok(request.input.corrections.some(issue => issue.startsWith('claims:')))
    return draft(request, attempts === 1 ? 4 : 1)
  })
  assert.equal(attempts, 2); assert.equal(result.claims.length, 1)
  let manualAttempts = 0
  const manual = await generateContent(evidence, { outputs: ['website'] }, {}, async request => {
    manualAttempts++; assert.equal(request.schema.properties.claims.maxItems, 30); return draft(request, 30)
  })
  assert.equal(manualAttempts, 1); assert.equal(manual.claims.length, 30)
})

test('full articles cannot introduce numbers in claims, marked output or website titles absent from their own selected quotation', async () => {
  for (const content of [
    { ...base, claims: [{ ...claim, text: 'The preview has a 1% failure rate' }] },
    { ...base, website: { ...base.website, body: 'The preview has a 1% failure rate [C1].' } },
    { ...base, website: { ...base.website, title: 'A 60-second preview [C1]' } },
    { ...base, website: { ...base.website, title: 'A 60-second preview' } },
  ]) assert.ok(reviewContent(content, evidence, { outputs: ['website'] }).issues.length)
  assert.deepEqual(reviewContent(base, evidence, { outputs: ['website'] }).issues, [])
  let calls = 0
  const result = await generateContent(evidence, { outputs: ['website'] }, {}, async request => {
    calls++
    const content = draft(request)
    if (calls === 1) content.claims[0].text = 'The preview has a 1% failure rate'
    else assert.ok(request.input.corrections.some(issue => issue.includes('numbers stated')))
    return content
  })
  assert.equal(calls, 2); assert.equal(result.claims[0].text, claim.text)
})

test('an unrelated article quotation cannot supply numbers for a different cited claim', () => {
  const other = { id: 'E2', type: 'article', excerpt: 'The unrelated publisher reports a 1% test result in a separate experimental setting.' }
  const content = { ...base, claims: [claim, { ...claim, id: 'C2', evidenceId: 'E2', quote: other.excerpt }], website: { ...base.website, body: 'The preview has a 1% failure rate [C1].' } }
  assert.ok(reviewContent(content, [...evidence, other]).issues.some(issue => issue.startsWith('website:') && issue.includes('numbers supported')))
})

test('a citation in a later sentence does not cover an uncited numeric sentence', () => {
  const content = { ...base, website: { ...base.website, body: 'The preview has a 1% failure rate. The publisher announced a limited preview [C1].' } }
  assert.ok(reviewContent(content, evidence).issues.some(issue => issue.includes('numeric statements need their own valid claim marker')))
  const identifier = { ...base, website: { ...base.website, body: 'W3C announced a preview. The publisher announced limited access [C1].' } }
  assert.equal(reviewContent(identifier, evidence).issues.some(issue => issue.includes('numeric statements')), false)
})

test('immediately post-punctuation citations bind to their preceding sentence for inspection only', () => {
  const source = [{ id: 'E1', type: 'article', excerpt: 'The publisher announced a developer preview on October 25, 2026.' }]
  const claims = [{ ...claim, text: 'The preview was announced on October 25, 2026', quote: source[0].excerpt }]
  for (const body of [
    'The preview was announced on October 25, 2026 [C1].',
    'The preview was announced on October 25, 2026. [C1]',
    'The preview was announced on October 25, 2026.[C1] Selected developers have access [C1].',
    'The preview was announced on October 25, 2026. [C1] [C1] Selected developers have access [C1].',
  ]) {
    const content = { claims, website: { title: 'Developer preview', body } }
    assert.deepEqual(reviewContent(content, source).issues, [])
    assert.equal(content.website.body, body)
  }
  assert.deepEqual(citationSentences('A numeric claim 2026.[C1] A different claim 99 [C2].'), ['A numeric claim 2026 [C1].', 'A different claim 99 [C2].'])
  const unrelated = { claims, website: { title: 'Developer preview', body: 'The preview has a 1% failure rate. Selected developers have access [C1].' } }
  assert.ok(reviewContent(unrelated, source).issues.some(issue => issue.includes('own valid claim marker')))
})

test('automation bounds total claim words, website length, headlines and X body independently of manual limits', () => {
  const long = { ...base, website: { title: 'A'.repeat(66), body: `${'Publisher '.repeat(181)}[C1]` }, claims: [{ ...claim, text: 'Publisher '.repeat(49).trim() }] }
  const issues = reviewContent(long, evidence, undefined, context).issues
  for (const expected of ['48 words', '65 characters', '180 words']) assert.ok(issues.some(issue => issue.includes(expected)))
  assert.equal(reviewContent(long, evidence).issues.some(issue => issue.startsWith('Automation')), false)
  const x = { claims: [claim], strategy: adaptation(`${'A limited preview. '.repeat(8)}[C1]`) }
  assert.ok(reviewContent(x, evidence, undefined, context).issues.some(issue => issue.includes('140 characters')))
  assert.equal(reviewContent(x, evidence).issues.some(issue => issue.includes('280-character')), false)
  const longPlatform = { claims: [claim], strategy: adaptation(`${'Preview '.repeat(151)}[C1]`) }
  assert.ok(reviewContent(longPlatform, evidence, undefined, context).issues.some(issue => issue.includes('150 words')))
})

test('repeated automation contract violations stop after the existing two-attempt allowance without truncation', async () => {
  let calls = 0
  await assert.rejects(() => generateContent(evidence, { outputs: ['website'] }, context, async request => {
    calls++; return { ...draft(request), website: { title: 'A'.repeat(66), body: base.website.body } }
  }), error => error.code === 'EVIDENCE_VALIDATION' && error.issues.some(issue => issue.includes('65 characters')))
  assert.equal(calls, 2)
})
