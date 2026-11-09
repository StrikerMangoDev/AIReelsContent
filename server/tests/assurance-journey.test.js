import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'
import { settingsSchema } from '../studio/content.js'
import { ratingsFixture, reviewFixture } from './fixtures/finalization.js'

test('server assurance gates legacy content, rejects forged checks, and follows independently reviewed text through export and invalidation', async () => {
  const repository = createRepository(':memory:')
  const app = express(); app.use(express.json())
  const evidence = [{ id: 'E1', url: 'https://example.com/release', title: 'Preview announcement', publisher: 'example.com', hash: 'original', excerpt: 'The publisher announced a limited preview for existing customers. Independent capability testing has not yet been published.', limitations: ['Publisher claim; no independent corroboration'], retrievedAt: new Date().toISOString(), type: 'retrieved-source' }]
  const content = { website: { title: 'Preview announcement [C1]', body: 'The publisher announced a limited preview for existing customers [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a limited preview for existing customers', quote: evidence[0].excerpt, evidenceId: 'E1', status: 'attributed' }] }
  const settings = settingsSchema.parse({ outputs: ['website'], platform: 'LinkedIn' })
  const legacy = { title: 'Preview', settings, content, evidence, createdBy: 'alice', reviewerId: 'bob', status: 'completed', editorialStatus: 'approved' }
  legacy.independentReview = reviewFixture(legacy)
  legacy.approval = { method: 'independent-human', approvedBy: 'alice', approvedAt: new Date().toISOString(), contentHash: legacy.independentReview.contentHash }
  let pack = repository.studioPut('alice', 'package', 'assurance-journey', legacy, 0)
  app.use(studioRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice', role: 'user' }; next() }, fetchSource: async () => ({ ...evidence[0], hash: 'changed' }) }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, method = 'GET', body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: actor, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const base = '/packages/assurance-journey'
  async function json(path, method, body, actor) { const response = await call(path, method, body, actor); assert.ok(response.ok, `${path}: ${response.status} ${response.ok ? '' : await response.text()}`); return response.json() }
  try {
    assert.equal((await call(`${base}/export`)).status, 422, 'legacy approval cannot supply missing runtime assurance')
    assert.equal((await call('/planning/board', 'POST', { packageId: pack.id, status: 'ready' })).status, 422)
    assert.equal((await call(base, 'PATCH', { revision: pack.revision, assurance: { checks: [{ status: 'passed' }] } })).status, 400, 'client cannot forge evaluator outcomes')
    assert.equal((await call(`${base}/assurance`, 'GET', undefined, 'outsider')).status, 404)
    pack = await json(`${base}/review`, 'POST', {})
    assert.ok(pack.assurance, 'actual server validation records assurance')
    assert.equal(pack.approval, null); assert.equal(pack.independentReview, null)
    const audit = await json(`${base}/assurance`)
    assert.ok(audit.assurance); assert.ok(audit.releaseAssessment)
    assert.equal((await call(`${base}/export`)).status, 409, 'automatic checks do not invent independent human review')
    pack = await json(`${base}/assign-reviewer`, 'POST', { revision: pack.revision, reviewerId: 'bob' })
    const review = { revision: pack.revision, claims: [{ id: 'C1', supported: true, note: 'The publisher passage supports the claim and its existing-customer qualification.' }], rightsConfirmed: true, promiseAligned: true, freshnessConfirmed: true, contradictionsResolved: true, accessibilityConfirmed: true, scopeConfirmed: true, ratings: ratingsFixture() }
    assert.equal((await call('/reviews/alice/assurance-journey', 'POST', { ...review, assurance: { passed: true } }, 'bob')).status, 400)
    pack = await json('/reviews/alice/assurance-journey', 'POST', review, 'bob')
    assert.equal((await call(`${base}/export`)).status, 409, 'independent review still needs separate owner approval')
    pack = await json(base, 'PATCH', { revision: pack.revision, editorialStatus: 'approved' })
    const exported = await json(`${base}/export`)
    assert.ok(exported.manifest.assurance, 'export carries review provenance')
    assert.equal(exported.manifest.scope, 'text-package')
    const board = await json('/planning/board', 'POST', { packageId: pack.id, status: 'ready' })
    assert.equal(board.status, 'ready')
    pack = await json(`${base}/refresh-evidence`, 'POST', { confirmed: true })
    assert.equal(pack.approval, null); assert.equal(pack.independentReview, null)
    assert.equal((await call(`${base}/export`)).status, 409)
    assert.equal((await json('/planning')).board[0].ready, false)
    pack = await json(base, 'PATCH', { revision: pack.revision, content: { ...content, website: { title: 'Updated announcement [C1]', body: content.website.body } } })
    assert.ok(pack.assurance, 'manual changes run actual checks without inventing a generation job')
    assert.equal(pack.independentReview, null); assert.equal(pack.approval, null)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
