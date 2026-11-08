import test from 'node:test'
import assert from 'node:assert/strict'
import { contentHash, independentlyReviewed, approvedVersion } from '../studio/approval.js'
import { reviewFixture } from './fixtures/finalization.js'

test('reviews expire, reject future or missing attestations, and remain bound to the exact content', () => {
  const now = Date.now()
  const value = { content: { claims: [{ id: 'C1' }] }, settings: {}, evidence: [{ id: 'E1' }], reviewerId: 'bob', editorialStatus: 'approved' }
  value.independentReview = { ...reviewFixture(value), reviewedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000).toISOString() }
  value.approval = { contentHash: contentHash(value), method: 'independent-human', approvedBy: 'author', approvedAt: new Date(now - 1000).toISOString() }
  assert.equal(independentlyReviewed(value, now), true)
  assert.equal(approvedVersion(value), true)
  assert.equal(independentlyReviewed(value, now + 1000), false)
  assert.equal(independentlyReviewed(value, now - 1001), false)
  for (const patch of [{ expiresAt: undefined }, { expiresAt: 'bad' }, { reviewedAt: undefined }, { freshnessConfirmed: false }, { contradictionsResolved: false }, { rightsConfirmed: false }, { promiseAligned: false }, { accessibilityConfirmed: false }, { scopeConfirmed: false }, { quality: undefined }, { quality: { ...value.independentReview.quality, policyVersion: 'old' } }, { expiresAt: new Date(now + 86400000).toISOString() }]) {
    assert.equal(independentlyReviewed({ ...value, independentReview: { ...value.independentReview, ...patch } }, now), false)
  }
  assert.equal(independentlyReviewed({ ...value, settings: { platform: 'X' } }, now), false)
  assert.equal(independentlyReviewed({ ...value, contributorUids: ['bob'] }, now), false)
  assert.equal(approvedVersion({ ...value, approval: { ...value.approval, approvedBy: 'bob' } }), false)
  for (const claims of [undefined, [], [...value.independentReview.claims, ...value.independentReview.claims], [{ ...value.independentReview.claims[0], supported: false }], [{ ...value.independentReview.claims[0], id: 'C99' }]]) assert.equal(independentlyReviewed({ ...value, independentReview: { ...value.independentReview, claims } }, now), false)
})

test('legacy creator confirmation cannot bypass rated independent review', () => {
  const value = { content: { claims: [] }, settings: {}, evidence: [], editorialStatus: 'approved' }
  value.approval = { method: 'creator-confirmed', approvedBy: 'author', approvedAt: new Date().toISOString(), contentHash: contentHash(value) }
  assert.equal(approvedVersion(value), false)
  assert.equal(value.independentReview, undefined)
  assert.equal(approvedVersion({ ...value, content: { script: 'Changed' } }), false)
  for (const patch of [{ approvedBy: '' }, { approvedAt: 'invalid' }, { approvedAt: new Date(Date.now() + 86400000).toISOString() }, { contentHash: 'wrong' }]) {
    assert.equal(approvedVersion({ ...value, approval: { ...value.approval, ...patch } }), false)
  }
})
