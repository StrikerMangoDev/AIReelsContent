import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'
import { safeSourceUrl, publicAddress } from '../studio/evidence.js'
import { reviewContent } from '../studio/content.js'

const excerpt = 'The publisher announced a new model with support for text and image inputs. Availability remains limited to the preview programme.'
const content = { hooks: ['A model update [C1]'], script: 'The publisher announced a model [C1].', scenes: [{ timing: '0–30s', narration: 'The publisher announced a model [C1].', onScreen: 'Model update', visualPrompt: 'Abstract illustration', voiceDirection: 'Clear' }], captions: { reel: 'Model update [C1]', linkedin: 'Model update [C1]' }, website: { title: 'Model update', body: 'The publisher announced a model [C1].' }, claims: [{ id: 'C1', text: 'A model was announced', evidenceId: 'E1', quote: 'The publisher announced a new model', status: 'attributed' }] }

test('source intake rejects private, mapped IPv6, credentials, and private DNS', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::ffff:127.0.0.1', '::1']) assert.equal(publicAddress(address), false)
  assert.equal(publicAddress('8.8.8.8'), true)
  await assert.rejects(safeSourceUrl('http://example.com'))
  await assert.rejects(safeSourceUrl('https://user:pass@example.com'))
  await assert.rejects(safeSourceUrl('https://example.com', async () => [{ address: '127.0.0.1' }] ))
  assert.equal((await safeSourceUrl('https://example.com', async () => [{ address: '8.8.8.8' }])).address, '8.8.8.8')
})

test('review rejects invented quotes and unknown claim citations', () => {
  const evidence = [{ id: 'E1', excerpt }]
  assert.deepEqual(reviewContent(content, evidence).issues, [])
  const bad = structuredClone(content); bad.claims[0].quote = 'Invented performance improvement'; bad.script = 'A claim [C99]'
  assert.ok(reviewContent(bad, evidence).issues.length >= 2)
  const badHook = structuredClone(content); badHook.hooks = ['Untraceable hook [C99]']
  assert.ok(reviewContent(badHook, evidence).issues.some(issue => issue.includes('unknown')))
})

test('studio persists generation, rejects stale edits and isolates owners', async () => {
  const repository = createRepository(':memory:')
  const app = express(); app.use(express.json())
  let admin = false
  const auth = (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization, role: admin ? 'admin' : 'user' }; next() }
  let calls = 0; let providerFails = false; let sourceHash = 'original'
  app.use('/api/studio', studioRouter({ repository, auth, generate: async () => { calls++; if (providerFails) throw new Error('Provider unavailable'); return content }, fetchSource: async () => ({ id: 'E1', title: 'Example', url: 'https://example.com', excerpt, hash: sourceHash, limitations: [] }) }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/api/studio`
  const call = (path, method = 'GET', body, owner = 'alice') => fetch(base + path, { method, headers: { Authorization: owner, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  try {
    await repository.studioPut('alice', 'library_source', 'rejected', { evidence: { id: 'E1', excerpt }, reviewStatus: 'rejected' })
    assert.equal((await call('/packages', 'POST', { sourceIds: ['rejected'], requestId: 'rejected-1234' })).status, 422)
    let response = await call('/packages', 'POST', { sourceUrl: 'https://example.com', requestId: 'create-1234' }); assert.equal(response.status, 201)
    const draft = await response.json()
    assert.equal((await call(`/packages/${draft.id}`, 'GET', undefined, 'bob')).status, 404)
    response = await call(`/packages/${draft.id}/generate`, 'POST', { requestId: 'generate-1234' }); assert.equal(response.status, 200)
    const generated = await response.json(); assert.equal(generated.status, 'completed'); assert.equal(generated.editorialStatus, 'needs_review')
    await call(`/packages/${draft.id}/generate`, 'POST', { requestId: 'generate-1234' }); assert.equal(calls, 1)
    assert.equal((await call(`/packages/${draft.id}`, 'PATCH', { revision: draft.revision, content })).status, 409)
    assert.equal((await call(`/packages/${draft.id}`, 'PATCH', { revision: generated.revision, editorialStatus: 'approved' })).status, 200)
    assert.equal((await call(`/packages/${draft.id}/publish`, 'POST', {})).status, 403)
    admin = true
    const publication = await (await call(`/packages/${draft.id}/publish`, 'POST', {})).json()
    assert.equal(publication.title, content.website.title)
    assert.equal(publication.evidence[0].excerpt, undefined)
    assert.equal((await fetch(`${base}/publications/${publication.id}`)).status, 200)
    const refreshed = await (await call(`/packages/${draft.id}/refresh-evidence`, 'POST', {})).json()
    assert.equal(refreshed.editorialStatus, 'approved')
    sourceHash = 'changed'
    const changed = await (await call(`/packages/${draft.id}/refresh-evidence`, 'POST', {})).json()
    assert.equal(changed.editorialStatus, 'needs_review')
    assert.equal((await (await fetch(`${base}/publications/${publication.id}`)).json()).correctionRequired, true)
    assert.equal((await call(`/packages/${draft.id}/publish`, 'POST', {})).status, 422)
    providerFails = true
    const failure = await call(`/packages/${draft.id}/generate`, 'POST', { requestId: 'retry-12345' })
    assert.equal(failure.status, 502)
    assert.deepEqual((await failure.json()).content, content)
    const history = await (await call(`/packages/${draft.id}/history`)).json(); assert.ok(history.revisions.length >= 3)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
