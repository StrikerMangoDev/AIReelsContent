import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { createLibraryRouter } from '../studio/library.js'

test('library requires review, isolates owners, rejects stale changes and invalidates approval when evidence changes', async () => {
  const repository = createRepository(':memory:')
  const app = express(); app.use(express.json())
  const auth = (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization }; next() }
  let hash = 'original'
  app.use('/library', createLibraryRouter({ repository, auth, fetchSource: async url => ({ id: 'E1', url, title: 'Source', excerpt: 'Retrieved source text', hash, limitations: ['Not independently corroborated'] }) }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/library`
  const call = (path, method = 'GET', body, owner = 'alice') => fetch(base + path, { method, headers: { Authorization: owner, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  try {
    assert.equal((await fetch(`${base}/sources`)).status, 401)
    const input = { url: 'https://example.com/article', industry: 'Education' }
    let result = await call('/sources', 'POST', input)
    assert.equal(result.status, 201)
    const first = await result.json(); assert.equal(first.reviewStatus, 'needs_review')
    assert.deepEqual((await (await call('/sources', 'GET', undefined, 'bob')).json()).sources, [])
    assert.equal((await call(`/sources/${first.id}`, 'PATCH', { revision: first.revision, reviewStatus: 'approved' }, 'bob')).status, 404)
    result = await call(`/sources/${first.id}`, 'PATCH', { revision: first.revision, reviewStatus: 'rejected' })
    const rejected = await result.json(); assert.equal(rejected.reviewStatus, 'rejected')
    assert.equal((await call(`/sources/${first.id}`, 'PATCH', { revision: first.revision, reviewStatus: 'approved' })).status, 409)
    result = await call(`/sources/${first.id}`, 'PATCH', { revision: rejected.revision, reviewStatus: 'approved' })
    assert.equal((await result.json()).reviewStatus, 'approved')
    assert.equal((await (await call('/sources', 'POST', input)).json()).reviewStatus, 'approved')
    hash = 'changed'
    const changed = await (await call('/sources', 'POST', input)).json()
    assert.equal(changed.reviewStatus, 'needs_review'); assert.equal(changed.reviewedAt, null)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
