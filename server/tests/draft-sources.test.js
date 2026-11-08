import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'

test('draft source recovery preserves topic context, uses unique IDs and enforces revision/ownership/state limits', async () => {
  const repository = createRepository(':memory:'); let fetches = 0; let duringFetch = () => {}
  const app = express(); app.use(express.json())
  app.use(studioRouter({ repository, findAlternatives: async pack => pack.id === 'fallback' ? [{ id: 'E6', url: 'https://trusted.example/alternative', excerpt: 'Alternative supported publisher passage. '.repeat(10), hash: 'alternative-hash' }] : [], auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice', role: 'user' }; next() }, fetchSource: async url => { fetches++; duringFetch(); if (url.endsWith('/bad')) throw new Error('private upstream failure'); return { id: 'E1', url, excerpt: 'Verifiable source passage. '.repeat(10), hash: 'retrieved-hash', type: 'submitted-source' } } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const post = (id, revision = 1, url = 'https://example.com/original', uid = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/packages/${id}/sources`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: uid }, body: JSON.stringify({ revision, sourceUrl: url }) })
  const create = (id, extra = {}) => repository.studioPut('alice', 'package', id, { status: 'draft', content: null, evidence: [{ id: 'E1', url: 'https://example.com/headline', excerpt: 'Short title' }, { id: 'E3', url: 'https://example.com/second', excerpt: 'Second title' }], researchId: 'report-one', researchContext: { opportunity: { title: 'Chosen topic' }, brief: 'Original brief' }, settings: { outputs: ['script'] }, createdBy: 'alice', ...extra }, 0)
  try {
    const original = create('draft')
    assert.equal((await post('draft', 1, undefined, 'bob')).status, 404)
    assert.equal((await post('draft', 99)).status, 409); assert.equal(fetches, 0)
    const response = await post('draft'); assert.equal(response.status, 200)
    const saved = await response.json()
    assert.equal(saved.evidence[2].id, 'E2'); assert.equal(saved.evidence.length, 3)
    assert.deepEqual(saved.researchContext, original.researchContext); assert.equal(saved.researchId, original.researchId)
    assert.deepEqual(saved.settings, original.settings); assert.equal(saved.approval, null); assert.equal(saved.independentReview, null)
    assert.equal((await post('draft', saved.revision)).status, 422)
    for (const [id, extra] of [['running', { status: 'generating' }], ['unknown', { status: 'dispatch_unknown' }], ['generated', { content: {} }], ['job', { jobId: 'pending' }], ['library', { sourceIds: ['approved-one'] }], ['full', { evidence: Array.from({ length: 12 }, (_, i) => ({ id: `E${i + 1}` })) }]]) {
      create(id, extra); const before = fetches
      assert.ok([409, 422].includes((await post(id)).status)); assert.equal(fetches, before)
    }
    create('bad'); assert.equal((await post('bad', 1, 'https://example.com/bad')).status, 422)
    assert.equal(repository.studioGet('alice', 'package', 'bad').revision, 1)
    create('race'); duringFetch = () => { const current = repository.studioGet('alice', 'package', 'race'); repository.studioPut('alice', 'package', 'race', { ...current, title: 'Concurrent edit' }, current.revision) }
    assert.equal((await post('race')).status, 409)
    assert.equal(repository.studioGet('alice', 'package', 'race').evidence.length, 2)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('idea sources are retrieved automatically once, keep citation IDs, and fail closed without changing a blocked draft', async () => {
  const repository = createRepository(':memory:'); let fetches = 0
  const app = express(); app.use(express.json())
  app.use(studioRouter({ repository, findAlternatives: async pack => pack.id === 'fallback' ? [{ id: 'E6', url: 'https://trusted.example/alternative', excerpt: 'Alternative supported publisher passage. '.repeat(10), hash: 'alternative-hash' }] : [], auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice', role: 'user' }; next() }, fetchSource: async url => {
    fetches++; if (url.endsWith('/blocked') || url.endsWith('/fallback')) throw new Error('HTTP 403')
    return { id: 'E1', url: 'https://publisher.example/article', excerpt: 'An actual publisher passage with sufficient source text. '.repeat(4), hash: 'publisher-hash', publishedAt: null }
  } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const create = (id, extra = {}) => repository.studioPut('alice', 'package', id, { status: 'draft', researchId: 'report', researchContext: { opportunity: { title: 'Original idea' } }, evidence: [{ id: 'E6', url: 'https://news.example/' + id, excerpt: 'Headline only', publishedAt: '2026-11-01' }], ...extra }, 0)
  const post = (id, uid = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/packages/${id}/prepare-sources`, { method: 'POST', headers: { authorization: uid } })
  try {
    create('ready'); assert.equal((await post('ready', 'bob')).status, 404); assert.equal(fetches, 0)
    const response = await post('ready'); assert.equal(response.status, 200)
    const saved = await response.json(); assert.equal(saved.evidence[0].id, 'E6'); assert.equal(saved.evidence[0].discoveryUrl, 'https://news.example/ready'); assert.equal(saved.evidence[0].hash, 'publisher-hash'); assert.equal(saved.researchContext.opportunity.title, 'Original idea')
    await post('ready'); assert.equal(fetches, 1)
    create('fallback'); const recovered = await (await post('fallback')).json(); assert.equal(recovered.evidence.length, 2); assert.equal(recovered.evidence[0].id, 'E6'); assert.equal(recovered.evidence[1].id, 'E1'); assert.equal(recovered.evidence[1].hash, 'alternative-hash'); const used = fetches; await post('fallback'); assert.equal(fetches, used);
    create('blocked'); assert.equal((await post('blocked')).status, 422); assert.equal(repository.studioGet('alice', 'package', 'blocked').revision, 1)
    for (const [id, extra] of [['generated', { content: {} }], ['running', { jobId: 'job' }], ['standalone', { researchId: null }]]) {
      create(id, extra); const before = fetches; assert.equal((await post(id)).status, 200); assert.equal(fetches, before)
    }
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
