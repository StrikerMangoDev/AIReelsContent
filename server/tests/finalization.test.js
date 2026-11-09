import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { assessQuality } from '../studio/finalization.js'
import { contentHash } from '../studio/approval.js'
import { studioRouter } from '../studio/routes.js'
import { createRepository } from '../storage/repository.js'
import { ratingsFixture } from './fixtures/finalization.js'

test('quality thresholds use unrounded evidence-backed scores and cannot average away a weak dimension', () => {
  const evidence = [{ id: 'E1' }]
  const check = ratings => assessQuality(ratings, evidence)
  assert.equal(check(ratingsFixture()).eligible, true)
  const weak = ratingsFixture(10); weak.clarity.score = 5.99
  assert.equal(check(weak).eligible, false)
  weak.clarity.score = 6; assert.equal(check(weak).eligible, true)
  const factual = ratingsFixture(10); factual.factualAccuracy.score = 7.99
  assert.equal(check(factual).eligible, false)
  const rounded = ratingsFixture(); rounded.cta.score = 7.99
  assert.equal(check(rounded).eligible, false)
  for (const invalid of [undefined, {}, { ...ratingsFixture(), extra: ratingsFixture().cta }, { ...ratingsFixture(), clarity: { ...ratingsFixture().clarity, score: 11 } }, { ...ratingsFixture(), clarity: { ...ratingsFixture().clarity, score: '8' } }, { ...ratingsFixture(), clarity: { ...ratingsFixture().clarity, note: 'Unsupported' } }, { ...ratingsFixture(), clarity: { ...ratingsFixture().clarity, evidenceIds: [] } }, { ...ratingsFixture(), clarity: { ...ratingsFixture().clarity, evidenceIds: ['E1', 'E1'] } }, { ...ratingsFixture(), clarity: { ...ratingsFixture().clarity, evidenceIds: ['unknown'] } }]) assert.equal(check(invalid), null)
})

test('finalization records below-threshold review, blocks bypasses and exports only current separately approved rated text', async () => {
  const repository = createRepository(':memory:')
  const app = express(); app.use(express.json())
  app.use(studioRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice', role: 'user' }; next() } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, method = 'GET', body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: actor, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  try {
    const evidence = [{ id: 'E1', url: 'https://example.com/release', hash: 'source', excerpt: 'The publisher announced a limited preview. Independent capability testing is not included in the publisher announcement.', limitations: [], retrievedAt: new Date().toISOString() }]
    const content = { website: { title: 'Limited preview [C1]', body: 'The publisher announced a limited preview [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a limited preview', quote: evidence[0].excerpt, evidenceId: 'E1', status: 'attributed' }] }
    let pack = repository.studioPut('alice', 'package', 'rated', { title: 'Preview', settings: { outputs: ['website'], platform: 'X' }, content, evidence, createdBy: 'alice', reviewerId: 'bob', status: 'completed', editorialStatus: 'needs_review' }, 0)
    pack = await (await call('/packages/rated/review', 'POST', {})).json()
    const approve = () => call('/packages/rated', 'PATCH', { revision: pack.revision, editorialStatus: 'approved' })
    const review = () => ({ revision: pack.revision, claims: [{ id: 'C1', supported: true, note: 'The exact source passage supports the limited preview announcement.' }], rightsConfirmed: true, promiseAligned: true, freshnessConfirmed: true, contradictionsResolved: true, accessibilityConfirmed: true, scopeConfirmed: true, ratings: ratingsFixture() })
    assert.equal((await approve()).status, 422)
    const missing = review(); delete missing.ratings
    assert.equal((await call('/reviews/alice/rated', 'POST', missing, 'bob')).status, 400)
    for (const key of ['rightsConfirmed', 'promiseAligned', 'freshnessConfirmed', 'contradictionsResolved', 'accessibilityConfirmed', 'scopeConfirmed']) assert.equal((await call('/reviews/alice/rated', 'POST', { ...review(), [key]: false }, 'bob')).status, 400)
    const wrongEvidence = review(); wrongEvidence.ratings.clarity.evidenceIds = ['not-attached']
    assert.equal((await call('/reviews/alice/rated', 'POST', wrongEvidence, 'bob')).status, 422)
    const low = review(); low.ratings.factualAccuracy.score = 7
    let response = await call('/reviews/alice/rated', 'POST', low, 'bob'); assert.equal(response.status, 200); pack = await response.json()
    assert.equal(pack.independentReview.status, 'needs_revision'); assert.equal(pack.independentReview.quality.eligible, false)
    assert.equal((await approve()).status, 422)
    assert.equal((await call('/packages/rated/export')).status, 409)
    assert.equal((await call('/planning/board', 'POST', { packageId: 'rated', status: 'ready' })).status, 422)
    response = await call('/reviews/alice/rated', 'POST', review(), 'bob'); assert.equal(response.status, 200); pack = await response.json()
    assert.equal(pack.independentReview.contentHash, contentHash(pack))
    pack = await (await approve()).json()
    response = await call('/packages/rated/export'); assert.equal(response.status, 200)
    const exported = await response.json(); assert.equal(exported.manifest.scope, 'text-package'); assert.equal(exported.manifest.quality.overall, 8); assert.equal(exported.manifest.reviewerId, 'bob')
    assert.equal((await call('/planning/board', 'POST', { packageId: 'rated', status: 'ready' })).status, 201)
    response = await call('/packages/rated', 'PATCH', { revision: pack.revision, content: { ...content, website: { ...content.website, title: 'Updated preview [C1]' } } }); assert.equal(response.status, 200); pack = await response.json()
    assert.equal(pack.independentReview, null); assert.equal(pack.approval, null)
    assert.equal((await call('/packages/rated/export')).status, 409)
    assert.equal((await (await call('/planning')).json()).board[0].ready, false)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
