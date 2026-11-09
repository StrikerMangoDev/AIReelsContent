import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createMediaRouter } from '../media/router.js'
import { renderLocalMedia } from '../media/render.js'
import { contentHash } from '../studio/approval.js'

test('real local PNG generation persists private verified hash-bound bytes and detects changed text', async () => {
  const repository = createRepository(':memory:'); const files = new Map()
  const app = express(); app.use(express.json())
  let changeDuringRender = false
  app.use(createMediaRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization }; next() }, config: () => ({ image: { enabled: true, estimatedUsd: 0 } }), generate: async (kind, _prompt, options) => {
    const result = await renderLocalMedia(kind, options.package)
    if (changeDuringRender) { const current = repository.studioGet('owner', 'package', 'png-package'); repository.studioPut('owner', 'package', current.id, { ...current, content: { ...current.content, website: { title: 'Changed title' } } }, current.revision) }
    return result
  }, saveFile: async (id, bytes) => files.set(id, bytes), readFile: async id => files.get(id) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const request = (path, owner = 'owner', body) => fetch(`http://127.0.0.1:${server.address().port}/api/studio${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: owner, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    const pack = repository.studioPut('owner', 'package', 'png-package', { title: 'An AI preview update', content: { claims: [{ id: 'C1', evidenceId: 'E1', text: 'The publisher announced a limited model preview for developers.' }] }, evidence: [{ id: 'E1', url: 'https://example.com/announcement', publisher: 'Example publisher' }], settings: { language: 'English' } }, 0)
    const body = { kind: 'image', prompt: 'Render the saved source-backed text', requestId: randomUUID(), confirmCost: true }
    const first = await request('/packages/png-package/assets', 'owner', body); assert.equal(first.status, 201)
    const asset = await first.json()
    assert.equal(asset.status, 'completed'); assert.equal(asset.createdBy, 'owner'); assert.equal(asset.packageContentHash, contentHash(pack))
    assert.equal(asset.mime, 'image/png'); assert.equal(asset.verification.status, 'passed')
    assert.equal(asset.sha256, createHash('sha256').update(files.get(asset.id)).digest('hex'))
    assert.equal((await request(`/assets/${asset.id}/file`, 'outsider')).status, 404)
    const download = await request(`/assets/${asset.id}/file`); assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'image/png')
    const downloaded = Buffer.from(await download.arrayBuffer()); assert.equal(downloaded.toString('hex', 0, 8), '89504e470d0a1a0a')
    assert.equal((await request('/packages/png-package/assets', 'owner', body)).status, 200)
    assert.equal(files.size, 1)
    changeDuringRender = true
    const stale = await (await request('/packages/png-package/assets', 'owner', { ...body, requestId: randomUUID() })).json()
    assert.equal(stale.status, 'completed'); assert.equal(stale.verification.status, 'blocked')
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
