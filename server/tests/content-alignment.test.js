import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contentContract, reviewContentAlignment, contentAlignment, savedAlignmentCurrent } from '../studio/content-alignment.js'
import { generateContent, reviewContent } from '../studio/content.js'
import { workflowGenerationContext } from '../studio/strategy-workflow.js'
import { assessRelease } from '../studio/release.js'

const real = JSON.parse(readFileSync(new URL('./fixtures/strategy-real-case.json', import.meta.url)))
const context = { strategyWorkflow: workflowGenerationContext(real.context) }
const contract = contentContract(real.settings, context)
const questionId = contract.destinations[0].questions[0].id
const answer = 'The captured quote does not explain research access limits. Anthropic reports coding gains [C1].'
const corrected = structuredClone(real.content)
corrected.strategy.platforms[0].body = answer
corrected.strategy.platforms[0].hook = 'What is known about research limits? [C1]'
corrected.website.body = answer
corrected.website.title = 'What the source establishes about research limits [C1]'
function evaluation(request, verdict = 'source_limited') {
  return { judgments: request.input.targets.map(target => ({ target: target.target, questionId: target.question.id, verdict, answerQuote: verdict === 'not_answered' ? '' : target.text, goalAligned: verdict !== 'not_answered', goalReason: 'Answers the declared information goal without inventing research access.', promiseFulfilled: verdict !== 'not_answered', intentSatisfied: verdict !== 'not_answered', reason: verdict === 'not_answered' ? 'The generic coding announcement does not answer the selected research access question.' : 'The text addresses access limits and explains what the quotation cannot establish.' })) }
}
function wireDraft(request, content) {
  return { ...structuredClone(content), claims: content.claims.map(claim => ({ id: claim.id, text: claim.text, evidenceId: claim.evidenceId, passageId: request.input.passages.find(passage => passage.evidenceId === claim.evidenceId).id, status: 'attributed' })) }
}

test('actual saved regression passes citation checks but fails a separate question/goal assessment', async () => {
  assert.deepEqual(reviewContent(real.content, real.evidence, real.settings).issues, [])
  assert.equal(contract.destinations[0].goal.primary, 'reach')
  assert.equal(contract.destinations[0].questions[0].id, questionId)
  const result = await reviewContentAlignment(real.content, contract, { generate: async request => {
    assert.match(request.system, /related announcement is NOT an answer/)
    assert.equal(request.input.targets.length, 2, 'Both X and website must answer; planning notes cannot rescue either')
    return evaluation(request, 'not_answered')
  } })
  assert.equal(result.passed, false)
  assert.equal(result.issues.length, 2)
})

test('one bounded correction preserves selected questions/SEO context and accepts an explicit source-limited answer', async () => {
  let writing = 0, checking = 0
  const content = await generateContent(real.evidence, real.settings, context, async request => {
    writing++
    assert.equal(request.input.contentContract.destinations[0].questions[0].id, questionId)
    if (writing === 2) {
      assert.match(request.input.corrections.join(' '), /selected audience question/)
      assert.equal(request.input.context.strategyWorkflow.destinations[0].audienceQuestions[0].id, questionId)
      assert.deepEqual(request.input.context.strategyWorkflow.destinations[0].selectedIdea.questionIds, [questionId])
      assert.equal(request.input.validatedClaims, undefined, 'Semantic repair may choose different passages rather than being locked to the off-topic claim')
      assert.match(request.input.instruction, /original supplied passages/)
    }
    return wireDraft(request, writing === 1 ? real.content : corrected)
  }, { evaluateAlignment: async request => evaluation(request, ++checking === 1 ? 'not_answered' : 'source_limited') })
  assert.equal(writing, 2); assert.equal(checking, 2)
  assert.deepEqual(reviewContent(content, real.evidence, real.settings).issues, [])
  assert.equal(content.strategy.platforms[0].body, answer)
  assert.equal(contentAlignment(content).passed, true)
  assert.equal(contentAlignment(content).method, 'automated-model-assessment')
})

test('unmet question remains rejected after two attempts and goal/intent failures cannot be hidden behind matching words', async () => {
  let calls = 0
  await assert.rejects(generateContent(real.evidence, real.settings, context, async request => { calls++; return wireDraft(request, real.content) }, { evaluateAlignment: async request => evaluation(request, 'not_answered') }), error => error.code === 'EVIDENCE_VALIDATION' && error.issues.some(issue => issue.includes('selected audience question')))
  assert.equal(calls, 2)
  for (const field of ['goalAligned', 'promiseFulfilled', 'intentSatisfied']) {
    const result = await reviewContentAlignment(corrected, contract, { generate: async request => {
      const result = evaluation(request); result.judgments[0][field] = false; return result
    } })
    assert.equal(result.passed, false, field)
  }
})

test('multiple terminal structured submissions use one shared correction, never merge ambiguous partial sections', async () => {
  let calls = 0
  const content = await generateContent(real.evidence, real.settings, context, async request => {
    if (++calls === 1) throw Object.assign(new Error('Ambiguous submissions'), { code: 'MODEL_INCOMPLETE', finishReason: 'tool_calls', toolCallCount: 2 })
    assert.match(request.input.corrections[0], /one JSON data object/)
    return wireDraft(request, corrected)
  }, { evaluateAlignment: async request => evaluation(request) })
  assert.equal(calls, 2)
  assert.equal(contentAlignment(content).passed, true)
})

test('unknown, duplicated, missing or fabricated answer quotes fail closed; authorization is checked around evaluation', async () => {
  for (const mutate of [r => r.judgments.pop(), r => r.judgments.push(r.judgments[0]), r => { r.judgments[0].questionId = 'invented' }, r => { r.judgments[0].answerQuote = 'A fabricated answer not present in the delivered text.' }]) {
    assert.equal((await reviewContentAlignment(corrected, contract, { generate: async request => { const r = evaluation(request); mutate(r); return r } })).passed, false)
  }
  let modelCalls = 0
  await assert.rejects(reviewContentAlignment(corrected, contract, { beforeAttempt: async () => { throw new Error('Revoked') }, generate: async () => { modelCalls++; return {} } }), /Revoked/)
  assert.equal(modelCalls, 0)
})

test('configured strategy cannot silently omit its goal/selected question; basic legacy writing remains supported', () => {
  const changed = structuredClone(context)
  changed.strategyWorkflow.destinations[0].goal = null
  assert.throws(() => contentContract(real.settings, changed), /save a goal/)
  changed.strategyWorkflow.destinations[0].goal = contract.destinations[0].goal
  changed.strategyWorkflow.destinations[0].selectedIdea.questionIds = ['unavailable']
  assert.throws(() => contentContract(real.settings, changed), /audience question/)
  assert.equal(contentContract(real.settings, {}), null)
  const invalidGoal = structuredClone(real.context)
  invalidGoal.workflow.destinations[0].goal = { ...invalidGoal.workflow.destinations[0].goal, primary: 'conversion', kpi: 'Impressions' }
  assert.throws(() => contentContract(real.settings, { strategyWorkflow: workflowGenerationContext(invalidGoal) }), /matching KPI/)
  const basic = contentContract(real.settings, { topicTitle: 'Source-backed AI access guide' })
  assert.equal(basic.basis, 'editorial-default-not-observed-demand')
  assert.equal(basic.destinations[0].goal.primary, 'inform')
  assert.equal(basic.destinations[0].questions[0].source, 'editorial-hypothesis')
  const unconfigured = contentContract(real.settings, { topicTitle: 'Astrology guide', strategyWorkflow: { objective: 'Explain the guide without promising outcomes.', destinations: [] } })
  assert.equal(unconfigured.destinations.length, 1)
  assert.equal(unconfigured.objective, 'Explain the guide without promising outcomes.')
  const mixed = contentContract({ ...real.settings, platform: 'X, Instagram' }, { ...context, topicTitle: 'Source-backed AI access guide' })
  assert.deepEqual(mixed.destinations.map(item => item.platform), ['X', 'Instagram'])
})

test('website SEO requires writing prerequisites and is checked for intent/outline coverage separately', async () => {
  const seo = { version: 'website-seo-v1', business: { objectives: 'Explain access limitations' }, keywords: [{ phrase: 'research access', role: 'primary', intent: 'informational' }], research: [{ id: 'r1', kind: 'official', observation: 'Read the source limits' }], outline: [{ id: 'h1', level: 1, text: 'Research access limitations', researchIds: ['r1'] }] }
  const seoContext = { strategyWorkflow: { websiteSeo: seo, destinations: [] } }
  const c = contentContract({ outputs: ['website'] }, seoContext)
  const result = await reviewContentAlignment(corrected, c, { generate: async request => {
    assert.equal(request.input.targets[0].website.outline[0].text, 'Research access limitations')
    return evaluation(request)
  } })
  assert.equal(result.passed, true)
  delete seo.outline
  assert.throws(() => contentContract({ outputs: ['website'] }, seoContext), /outline/)
  assert.equal(contentContract({ outputs: ['script'] }, seoContext), null)
})

test('persisted assessments survive JSONB key ordering but cannot survive edited copy or a changed goal/question', async () => {
  const record = await reviewContentAlignment(corrected, contract, { generate: async request => evaluation(request) })
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key,value])=>[key,reorder(value)])) : value
  assert.equal(savedAlignmentCurrent({ content: reorder(corrected), strategyAlignment: record }, reorder(contract)), true)
  const edited = structuredClone(corrected); edited.strategy.platforms[0].body = real.content.strategy.platforms[0].body
  assert.equal(savedAlignmentCurrent({ content: edited, strategyAlignment: record }, contract), false)
  const changed = structuredClone(contract); changed.destinations[0].goal.primary = 'conversion'
  assert.equal(savedAlignmentCurrent({ content: corrected, strategyAlignment: record }, changed), false)
})

test('export/publication cannot reuse a passed assessment after the strategy or delivered text changes', async () => {
  const strategyAlignment = await reviewContentAlignment(corrected, contract, { generate: async request => evaluation(request) })
  const pack = { id: 'saved', content: corrected, settings: real.settings, evidence: real.evidence, review: { issues: [] }, status: 'completed', strategyAlignment }
  const repository = { studioGet: async () => ({ context: real.context }) }
  const current = await assessRelease(repository,'owner',pack,{policy:'owner-download',requireApproval:false})
  assert.equal(current.issues.some(issue=>issue.includes('goal check is stale')),false)
  const changed = structuredClone(pack); changed.content.website.body = real.content.website.body
  const stale = await assessRelease(repository,'owner',changed,{policy:'owner-download',requireApproval:false})
  assert.ok(stale.issues.some(issue=>issue.includes('goal check is stale')))
})
