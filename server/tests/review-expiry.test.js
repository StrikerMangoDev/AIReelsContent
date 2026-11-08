import test from 'node:test'
import assert from 'node:assert/strict'
import { contentHash, independentlyReviewed, approvedVersion } from '../studio/approval.js'

test('reviews expire, reject future or missing attestations, and remain bound to the exact content', () => {
  const now = Date.now()
  const value = { content: { claims: [] }, settings: {}, evidence: [], reviewerId: 'reviewer', editorialStatus: 'approved' }
  value.independentReview = { status: 'passed', reviewerId: 'reviewer', contentHash: contentHash(value), freshnessConfirmed: true, contradictionsResolved: true, reviewedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000).toISOString() }
  value.approval = { contentHash: contentHash(value) }
  assert.equal(independentlyReviewed(value, now), true)
  assert.equal(approvedVersion(value), true)
  assert.equal(independentlyReviewed(value, now + 1000), false)
  assert.equal(independentlyReviewed(value, now - 1001), false)
  for (const patch of [{ expiresAt: undefined }, { expiresAt: 'bad' }, { reviewedAt: undefined }, { freshnessConfirmed: false }, { contradictionsResolved: false }, { expiresAt: new Date(now + 86400000).toISOString() }]) {
    assert.equal(independentlyReviewed({ ...value, independentReview: { ...value.independentReview, ...patch } }, now), false)
  }
  assert.equal(independentlyReviewed({ ...value, settings: { platform: 'X' } }, now), false)
})

test('creator confirmation binds the exact saved version without inventing an independent review', () => {
  const value = { content: { claims: [] }, settings: {}, evidence: [], editorialStatus: 'approved' }
  value.approval = { method: 'creator-confirmed', approvedBy: 'author', approvedAt: new Date().toISOString(), contentHash: contentHash(value) }
  assert.equal(approvedVersion(value), true)
  assert.equal(value.independentReview, undefined)
  assert.equal(approvedVersion({ ...value, content: { script: 'Changed' } }), false)
  for (const patch of [{ approvedBy: '' }, { approvedAt: 'invalid' }, { approvedAt: new Date(Date.now() + 86400000).toISOString() }, { contentHash: 'wrong' }]) {
    assert.equal(approvedVersion({ ...value, approval: { ...value.approval, ...patch } }), false)
  }
})
