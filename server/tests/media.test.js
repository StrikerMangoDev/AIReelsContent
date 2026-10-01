import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createRepository } from '../storage/repository.js'
import { createMediaRouter } from '../media/router.js'
import { pcmToWav, videoResult } from '../media/provider.js'
import { randomUUID } from 'node:crypto'

test('media generation is owner-scoped, idempotent and persists files without leaking provider operation', async () => {
  const repository = createRepository(':memory:')
  const app = express(); app.use(express.json())
  let calls = 0; const files = new Map()
  const auth = (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization }; next() }
  app.use(createMediaRouter({ repository, auth, config: () => ({ image: { enabled: true, estimatedUsd: 0.1 } }), generate: async () => { calls++; return { bytes: Buffer.from('image'), mime: 'image/png' } }, saveFile: async (id, bytes) => files.set(id, bytes), readFile: async id => files.get(id) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const request = (path, uid = 'owner', body) => fetch(`${url}/api/studio${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: uid, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    await repository.studioPut('owner', 'package', 'draft', { content: { script: 'evidence backed script' } }, 0)
    const input = { kind: 'image', prompt: 'A calm abstract technology illustration', requestId: '46584f0a-d5fc-45c0-b89f-1d35de5a96f1', confirmCost: true }
    assert.equal((await request('/packages/draft/assets', 'other', input)).status, 404)
    assert.equal((await request('/packages/draft/assets', 'owner', { ...input, confirmCost: false })).status, 400)
    const first = await request('/packages/draft/assets', 'owner', input); assert.equal(first.status, 201)
    const asset = await first.json(); assert.equal(asset.status, 'completed')
    assert.equal((await request('/packages/draft/assets', 'owner', input)).status, 200); assert.equal(calls, 1)
    assert.equal((await request(`/assets/${asset.id}/file`, 'other')).status, 404)
    assert.equal(await (await request(`/assets/${asset.id}/file`)).text(), 'image')
    assert.equal((await request('/packages/draft/assets', 'owner', { ...input, prompt: 'A different prompt for this request' })).status, 409)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('speech PCM is wrapped in a valid mono 16-bit WAV and invalid formats rejected', () => {
  const wav = pcmToWav(Buffer.from([0, 0, 1, 0]), 24000)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(24), 24000)
  assert.equal(wav.readUInt32LE(40), 4)
  assert.throws(() => pcmToWav(Buffer.from([0])))
})

test('video terminal errors stop polling, transport failures preserve jobs, and quota blocks paid retries', async () => {
  assert.throws(() => videoResult({ done: true, error: { message: 'Rejected' } }), { code: 'MEDIA_TERMINAL' })
  assert.throws(() => videoResult({ done: true, response: {} }), { code: 'MEDIA_TERMINAL' })
  const repository = createRepository(':memory:'); const app = express(); app.use(express.json())
  let terminal = false; let calls = 0
  app.use(createMediaRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: 'owner' }; next() }, config: () => ({ video: { enabled: true, estimatedUsd: 1 } }), generate: async () => { calls++; return { operation: 'private-operation' } }, refresh: async () => { throw Object.assign(new Error('Provider failure'), { code: terminal ? 'MEDIA_TERMINAL' : 'ECONNRESET' }) } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const request = (path, body = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/studio${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    await repository.studioPut('owner', 'package', 'draft', { content: { script: 'Script' } })
    const input = { kind: 'video', prompt: 'Illustrative abstract motion graphic', requestId: randomUUID(), confirmCost: true }
    const asset = await (await request('/packages/draft/assets', input)).json()
    assert.equal(asset.operation, undefined); assert.equal(asset.status, 'running')
    assert.equal((await request(`/assets/${asset.id}/refresh`)).status, 502)
    assert.equal((await repository.studioGet('owner', 'asset', asset.id)).status, 'running')
    terminal = true
    assert.equal((await (await request(`/assets/${asset.id}/refresh`)).json()).status, 'failed')
    assert.equal((await (await request('/packages/draft/assets', input)).json()).status, 'failed'); assert.equal(calls, 1)
    for (let i = 0; i < 9; i++) await repository.studioReserve('owner:media', randomUUID(), 10)
    assert.equal((await request('/packages/draft/assets', { ...input, requestId: randomUUID() })).status, 429)
    assert.equal(calls, 1)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
