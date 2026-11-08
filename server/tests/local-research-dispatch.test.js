import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createResearch } from '../studio/intelligence.js'
import { localResearchDispatcher, localGenerationDispatcher } from '../studio/local-research-dispatch.js'
import express from 'express'
import { studioRouter } from '../studio/routes.js'

test('generation admission notifies once only after ready; stale, unconfirmed and failed budget requests never notify', async () => {
  const repository = createRepository(':memory:'); const calls = []; let rejectBudget = false
  const guarded = { ...repository, budgetReserve(...args) { if (rejectBudget) throw Object.assign(new Error('blocked'), { code: 'BUDGET_BLOCKED' }); return repository.budgetReserve(...args) } }
  const app = express(); app.use(express.json())
  app.use(studioRouter({ repository: guarded, auth: (req, _res, next) => { req.identity = { uid: 'alice', role: 'user' }; next() }, generate: async () => { throw new Error('No model allowed') }, onGenerationAdmitted: args => { assert.equal(repository.studioJobGet(args.uid, args.requestId).ready, true); calls.push(args) } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const post = (id, body) => fetch(`http://127.0.0.1:${server.address().port}/packages/${id}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const make = id => repository.studioPut('alice', 'package', id, { settings: { platform: 'X', outputs: ['script'] }, evidence: [{ id: 'E1', excerpt: 'Supported source text. '.repeat(10) }], content: null, status: 'draft', createdBy: 'alice' }, 0)
    const draft = make('new')
    const body = { requestId: 'new-generation', revision: draft.revision, confirmed: true }
    assert.equal((await post('new', { ...body, confirmed: false })).status, 400)
    assert.equal((await post('new', { ...body, revision: 99 })).status, 409)
    assert.equal((await post('new', body)).status, 202)
    assert.equal((await post('new', body)).status, 202)
    assert.deepEqual(calls, [{ uid: 'alice', requestId: 'new-generation' }])
    make('failed'); rejectBudget = true
    assert.equal((await post('failed', { ...body, requestId: 'failed-generation' })).status, 409)
    assert.equal(calls.length, 1)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('generation dispatcher is separately opt-in and never drains old jobs or research', async () => {
  const repository = createRepository(':memory:')
  try {
    const options = { repository, enabled: 'true', host: '127.0.0.1', nodeEnv: 'development' }
    for (const override of [{ enabled: undefined }, { host: '0.0.0.0' }, { nodeEnv: 'production' }, { vercel: '1' }]) assert.equal(localGenerationDispatcher({ ...options, ...override }), undefined)
    for (const id of ['old', 'new', 'research']) {
      repository.studioJobReserve('alice', id, 'a'.repeat(64), 10, { operation: id === 'research' ? 'research' : 'generation' })
      repository.studioJobUpdate('alice', id, { status: 'reserved', ready: true }, 1, 'reserved')
    }
    const calls = []; let done
    const completed = new Promise(resolve => { done = resolve })
    const dispatch = localGenerationDispatcher({ ...options, run: async args => { calls.push(args.requestId); repository.studioJobUpdate(args.uid, args.requestId, { status: 'running' }, 2, 'reserved'); return { status: 'running' } }, report: done })
    dispatch({ uid: 'alice', requestId: 'research' }); dispatch({ uid: 'alice', requestId: 'new' })
    await completed
    assert.deepEqual(calls, ['new'])
    assert.equal(repository.studioJobGet('alice', 'old').status, 'reserved')
    assert.equal(repository.studioJobGet('alice', 'research').status, 'reserved')
  } finally { repository.close() }
})

test('new research admission notifies once; matching reuse and failed admission never dispatch', async () => {
  const repository = createRepository(':memory:')
  try {
    const niche = repository.studioPut('alice', 'niche', randomUUID(), { name: 'AI', brief: 'Explain artificial intelligence developments.' })
    const calls = []
    const options = { repository, uid: 'alice', niche, research: async () => { throw new Error('must not execute') }, onResearchAdmitted: args => { assert.equal(repository.studioJobGet(args.uid, args.requestId).ready, true); calls.push(args) } }
    const requestId = randomUUID()
    const result = await createResearch({ ...options, requestId })
    assert.equal(result.jobStatus, 'reserved')
    await createResearch({ ...options, requestId })
    await createResearch({ ...options, requestId: randomUUID() })
    assert.deepEqual(calls, [{ uid: 'alice', requestId }])
    const other = repository.studioPut('alice', 'niche', randomUUID(), { name: 'Gardening', brief: 'Practical gardening developments.' })
    const faulty = { ...repository, studioJobUpdate() { throw new Error('admission interrupted') } }
    await assert.rejects(createResearch({ ...options, repository: faulty, niche: other, requestId: randomUUID() }), /admission interrupted/)
    assert.equal(calls.length, 1)
  } finally { repository.close() }
})

test('local dispatch requires opt-in loopback and targets only supplied ready research, never scans backlog', async () => {
  const repository = createRepository(':memory:')
  try {
    const base = { repository, enabled: 'true', host: '127.0.0.1', nodeEnv: 'development' }
    for (const override of [{ enabled: undefined }, { host: '0.0.0.0' }, { nodeEnv: 'production' }, { vercel: '1' }]) assert.equal(localResearchDispatcher({ ...base, ...override }), undefined)
    for (const id of ['old', 'new', 'generation']) {
      repository.studioJobReserve('alice', id, 'a'.repeat(64), 10, { operation: id === 'generation' ? 'generation' : 'research' })
      repository.studioJobUpdate('alice', id, { status: 'reserved', ready: true }, 1, 'reserved')
    }
    const calls = []
    let done
    const finished = new Promise(resolve => { done = resolve })
    const dispatch = localResearchDispatcher({ ...base, run: async args => { calls.push(args.requestId); repository.studioJobUpdate(args.uid, args.requestId, { status: 'running' }, 2, 'reserved'); return { status: 'running' } }, report: () => done() })
    assert.equal(dispatch({ uid: 'alice', requestId: 'new' }), undefined)
    dispatch({ uid: 'alice', requestId: 'new' })
    dispatch({ uid: 'alice', requestId: 'generation' })
    await finished
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(calls, ['new'])
    assert.equal(repository.studioJobGet('alice', 'old').status, 'reserved')
    assert.equal(repository.studioJobGet('alice', 'generation').status, 'reserved')
  } finally { repository.close() }
})
