import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewAutomaticText, assessAutomaticText } from '../automation/review.js'
import { ratingsFixture } from './fixtures/finalization.js'
import { settingsSchema } from '../studio/content.js'

const now = Date.now()
function fixture() {
  const excerpt = 'The publisher announced a limited preview for developers. Access remains restricted to invited participants and availability may change.'
  const profile = { accountId: 'account-a', audience: 'Developers', weeklyBrief: 'Explain practical model updates and their limitations.', tone: 'Clear and factual', contentPillars: ['Practical AI'], enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', consentedBy: 'owner', consentedAt: new Date(now - 1000).toISOString(), scope: 'research-generation-and-social-publishing' } }
  const pack = { createdBy: 'owner', settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [{ id: 'E1', hash: 'source-hash', url: 'https://example.com/release', retrievedAt: new Date(now - 1000).toISOString(), excerpt }], content: { website: { title: 'A limited developer preview', body: 'The publisher announced a limited preview for developers [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a limited developer preview', evidenceId: 'E1', quote: excerpt, status: 'attributed' }] } }
  const result = { claims: [{ id: 'C1', evidenceIds: ['E1'], verdict: 'supported', reason: 'The exact saved passage supports an attributed limited developer preview.' }], ratings: ratingsFixture(), checks: { semanticSupport: true, contradictionsResolved: true, scopePreserved: true, promisesAligned: true, privacySafe: true, audienceClaimsSupported: true, provenanceClear: true }, issues: [], summary: 'The attributed preview description preserves the supplied qualifications.' }
  return { pack, profile, result }
}

test('consented automated review runs a separate evaluator and remains visibly machine-only and exact-version bound', async () => {
  const { pack, profile, result } = fixture(); let calls = 0
  pack.automaticReview = await reviewAutomaticText(pack, profile, { now, actorId: 'owner', generate: async request => { calls++; assert.match(request.system, /not a human reviewer/); assert.match(request.system, /untrusted data/); assert.equal(request.input.content, pack.content); return result } })
  assert.equal(calls, 1)
  assert.equal(pack.automaticReview.status, 'passed')
  assert.equal(pack.automaticReview.method, 'automated-model-review')
  assert.equal(pack.automaticReview.model, 'injected-test-provider')
  assert.equal(pack.independentReview, undefined)
  assert.equal(pack.approval, undefined)
  assert.equal(assessAutomaticText(pack, profile, { now }).eligible, true)
  assert.equal(assessAutomaticText(pack, { ...profile, tone: 'Different account voice' }, { now }).eligible, false)
  assert.equal(assessAutomaticText({ ...pack, content: { ...pack.content, website: { ...pack.content.website, title: 'Changed title' } } }, profile, { now }).eligible, false)
  assert.equal(assessAutomaticText(pack, profile, { now: now + 86400000 }).eligible, false)
})

test('unconsented accounts and deterministic failures cannot dispatch automated evaluator work', async () => {
  const { pack, profile } = fixture(); let calls = 0
  const generate = async () => { calls++; throw new Error('Must not dispatch') }
  assert.equal((await reviewAutomaticText(pack, { ...profile, automationConsent: false }, { now, generate })).status, 'blocked')
  assert.equal((await reviewAutomaticText(pack, { ...profile, enabled: false }, { now, generate })).status, 'blocked')
  const invalid = structuredClone(pack); invalid.content.website.body += ' It is 75% faster [C1].'
  assert.equal((await reviewAutomaticText(invalid, profile, { now, generate })).status, 'blocked')
  assert.equal(calls, 0)
})

test('unsupported claims, false flags, low ratings, fabricated refs and incomplete model responses stay blocked', async () => {
  const { pack, profile, result } = fixture()
  for (const mutate of [value => { value.claims[0].verdict = 'uncertain' }, value => { value.claims[0].evidenceIds = ['E99'] }, value => { value.claims.push(value.claims[0]) }, value => { value.checks.scopePreserved = false }, value => { value.ratings.factualAccuracy.score = 7 }, value => { value.issues.push('A material contradiction remains unresolved.') }]) {
    const response = structuredClone(result); mutate(response)
    const reviewed = await reviewAutomaticText(pack, profile, { now, generate: async () => response })
    assert.equal(reviewed.status, 'needs_revision')
    assert.equal(assessAutomaticText({ ...pack, automaticReview: reviewed }, profile, { now }).eligible, false)
  }
  const malformed = await reviewAutomaticText(pack, profile, { now, generate: async () => ({ status: 'passed', reviewerId: 'Invented human', ratings: result.ratings }) })
  assert.equal(malformed.status, 'blocked')
  const failed = await reviewAutomaticText(pack, profile, { now, generate: async () => { throw new Error('Provider did not finish') } })
  assert.equal(failed.status, 'blocked')
  assert.equal(failed.result, null)
  assert.equal(assessAutomaticText({ ...pack, automaticReview: { status: 'passed', humanApproved: true } }, profile, { now }).eligible, false)
})
