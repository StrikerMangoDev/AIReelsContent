import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAssurance, assessAssurance } from '../studio/assurance.js'
import { settingsSchema } from '../studio/content.js'
import { reviewFixture } from './fixtures/finalization.js'
import { contentHash } from '../studio/approval.js'

const excerpt = 'The publisher announced a new model with support for text and image inputs. Availability remains limited to the preview programme.'
function packageFixture() {
  return { createdBy: 'alice', reviewerId: 'bob', settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [{ id: 'E1', hash: 'capture-sha256', url: 'https://example.com/article', retrievedAt: new Date().toISOString(), excerpt }], content: { website: { title: 'Model preview', body: 'The publisher announced a preview model [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a model', evidenceId: 'E1', quote: excerpt, status: 'attributed' }] } }
}

test('assurance preserves actual validation provenance and requires independent review', () => {
  const value = packageFixture()
  assert.equal(assessAssurance(value).eligible, false)
  value.assurance = buildAssurance(value, { actorId: 'alice', runId: 'actual-check-1' })
  assert.equal(value.assurance.stageResults[0].runId, 'actual-check-1')
  assert.equal(value.assurance.stageResults[0].stage, 'validation')
  assert.ok(value.assurance.checks.filter(check => check.method === 'human').every(check => check.status === 'unknown'))
  assert.equal(assessAssurance(value).eligible, false)
  value.independentReview = reviewFixture(value)
  assert.equal(assessAssurance(value).eligible, true)
  assert.ok(assessAssurance(value).checks.filter(check => check.method === 'human').every(check => check.evaluator === 'bob'))
  value.content.website.body += ' Changed wording.'
  assert.equal(assessAssurance(value).eligible, false)
})

test('claim numbers, missing provenance, tampered checks and expired reviews cannot pass', () => {
  const invalid = packageFixture()
  invalid.content.claims[0].text = 'The publisher says performance increased by 75%'
  delete invalid.evidence[0].retrievedAt
  invalid.assurance = buildAssurance(invalid)
  invalid.independentReview = reviewFixture(invalid)
  assert.equal(assessAssurance(invalid).eligible, false)
  assert.ok(invalid.assurance.issues.some(issue => issue.code === 'claim-numbers'))
  assert.ok(invalid.assurance.issues.some(issue => issue.code === 'source-provenance'))
  const value = packageFixture()
  value.assurance = buildAssurance(value)
  value.independentReview = reviewFixture(value)
  value.assurance.checks[0].status = 'failed'
  assert.equal(assessAssurance(value).eligible, false)
  value.assurance = buildAssurance(value)
  value.independentReview.expiresAt = new Date(Date.now() - 1).toISOString()
  assert.equal(assessAssurance(value).eligible, false)
})

test('matching quotations never establish semantic truth or demand automatically', () => {
  const value = packageFixture()
  value.content.claims[0].text = 'This model is the best choice for every business'
  value.assurance = buildAssurance(value, { runId: 'generation-job-1', stage: 'generation' })
  assert.equal(value.assurance.stageResults[0].stage, 'generation')
  assert.equal(value.assurance.checks.find(check => check.code === 'semantic-support').status, 'unknown')
  assert.equal(assessAssurance(value).eligible, false)
  assert.equal(buildAssurance({ settings: {}, content: null, evidence: [] }).stageResults[0].result, 'failed')
})

test('PostgreSQL object key reordering preserves assurance but invented headline numbers block release', () => {
  const value = packageFixture()
  value.assurance = buildAssurance(value)
  value.independentReview = reviewFixture(value)
  const reverse = item => Array.isArray(item) ? item.map(reverse) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).reverse().map(([key, child]) => [key, reverse(child)])) : item
  const reordered = reverse(value)
  assert.equal(contentHash(reordered), contentHash(value))
  assert.equal(assessAssurance(reordered).eligible, true)
  value.content.website.title = '75% faster model'
  value.assurance = buildAssurance(value)
  value.independentReview = reviewFixture(value)
  assert.equal(assessAssurance(value).eligible, false)
  assert.ok(value.assurance.issues.some(issue => issue.code === 'output-numbers'))
})

test('future captures fail and changing the frozen research brief invalidates assurance', () => {
  const value = packageFixture()
  value.researchContext = { brief: 'Explain the model preview for developers' }
  value.assurance = buildAssurance(value, { stage: 'generation', runId: 'generation-actual' })
  value.assurance = buildAssurance(value, { runId: 'validation-actual' })
  assert.equal(value.assurance.stageResults[0].runId, 'generation-actual')
  value.independentReview = reviewFixture(value)
  assert.equal(assessAssurance(value).eligible, true)
  value.researchContext.brief = 'Promise universal performance benefits'
  assert.equal(assessAssurance(value).eligible, false)
  value.evidence[0].retrievedAt = new Date(Date.now() + 86400000).toISOString()
  assert.ok(buildAssurance(value).issues.some(issue => issue.code === 'source-provenance'))
})
