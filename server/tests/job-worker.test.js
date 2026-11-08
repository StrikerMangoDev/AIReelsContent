import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'
import { createResearch, researchNiche } from '../studio/intelligence.js'
import { generateContent } from './helpers/passage-model.js'
import { runContentJob, runPendingContentJobs, cancelContentJob, safeJobFailure, recoverRejectedGeneration } from '../studio/job-worker.js'

test('Vertex timeout recovery requires acknowledgement and retains every cost reservation', async () => {
  const repository = createRepository(':memory:')
  try {
    const reserved = repository.studioJobReserve('alice', 'timeout', 'a'.repeat(64), 10, { operation: 'generation', packageId: 'draft' })
    const running = repository.studioJobUpdate('alice', 'timeout', { status: 'running' }, reserved.job.revision, 'reserved')
    repository.studioJobUpdate('alice', 'timeout', { status: 'dispatch_unknown', error: 'Failed. Diagnostics: {"code":"VERTEX_REQUEST_FAILED","httpStatus":504}' }, running.revision, 'running')
    const draft = repository.studioPut('alice', 'package', 'draft', { status: 'dispatch_unknown', jobId: 'timeout', content: null }, 0)
    let costWrites = 0
    const guarded = { ...repository, budgetGet: (_uid, id) => id === 'vertex-timeout-1' ? { status: 'dispatch_unknown', quote: { priceVersion: 'gemini-3.8-flash-global-2026-10-29' } } : null, budgetTransition: () => { costWrites++; throw new Error('Do not release a timeout hold') } }
    const options = { repository: guarded, uid: 'alice', packageId: draft.id, revision: draft.revision }
    await assert.rejects(recoverRejectedGeneration(options), /no confirmed validation rejection/)
    await assert.rejects(recoverRejectedGeneration({ ...options, uid: 'bob', acknowledgeTimeoutCost: true }), /Draft version changed/)
    const recovered = await recoverRejectedGeneration({ ...options, acknowledgeTimeoutCost: true })
    assert.equal(recovered.status, 'failed')
    assert.equal(recovered.content, null)
    assert.equal(costWrites, 0)
    assert.equal(repository.studioJobGet('alice', 'timeout').result.billingOutcome, 'unknown-reservation-retained')
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId: 'timeout' })).status, 'skipped')
  } finally { repository.close() }
})

test('worker persists safe provider diagnostics without raw content and retains unresolved holds', async () => {
  const repository = createRepository(':memory:')
  try {
    assert.deepEqual(safeJobFailure({ code: 'private-secret', name: 'private-name', generationId: 'private token', finishReason: 'private content', status: 999, transportStatus: '200', providerErrorCode: 999 }), { code: 'JOB_FAILED', name: 'Error' })
    assert.equal(safeJobFailure({ name: 'ZodError' }).code, 'MODEL_SCHEMA_INVALID')
    const niche = repository.studioPut('alice', 'niche', randomUUID(), { name: 'Science', brief: 'Explain recent science developments.' })
    let calls = 0
    const research = async () => { calls++; throw Object.assign(new Error('private provider response secret'), { code: 'MODEL_INCOMPLETE', generationId: 'gen-123-safe', finishReason: 'length', transportStatus: 200, providerErrorCode: 503 }) }
    const requestId = randomUUID()
    await createResearch({ repository, uid: 'alice', niche, requestId, research })
    const result = await runContentJob({ repository, uid: 'alice', requestId, research })
    assert.equal(result.status, 'dispatch_unknown')
    assert.equal(result.code, 'MODEL_INCOMPLETE')
    assert.deepEqual(result.diagnostics, { code: 'MODEL_INCOMPLETE', name: 'Error', generationId: 'gen-123-safe', finishReason: 'length', transportStatus: 200, providerErrorCode: 503 })
    const saved = repository.studioJobGet('alice', requestId)
    assert.match(saved.error, /gen-123-safe/)
    assert.match(saved.error, /"transportStatus":200/)
    assert.match(saved.error, /"providerErrorCode":503/)
    assert.equal(saved.error.includes('private provider'), false)
    assert.equal(repository.budgetGet('alice', requestId).status, 'dispatch_unknown')
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId, research })).status, 'skipped')
    assert.equal(calls, 1)
  } finally { repository.close() }
})

const evidence = [{ id: 'E1', hash: 'source', excerpt: 'The publisher announced a preview today. Availability is limited, and these captured source passages do not establish performance or audience reception.' }]
const content = { script: 'The publisher announced a preview [C1].', hooks: ['A publisher preview [C1]'], claims: [{ id: 'C1', text: 'The publisher announced a preview', evidenceId: 'E1', quote: 'The publisher announced a preview today.', status: 'attributed' }] }

test('confirmed provider authentication rejection fails research without redispatch and permits an explicit new request', async () => {
  const repository = createRepository(':memory:')
  let calls = 0
  try {
    const niche = repository.studioPut('alice', 'niche', randomUUID(), { name: 'Science', brief: 'Explain recent science announcements.' }, 0)
    const research = async () => { calls++; throw Object.assign(new Error('Private provider response'), { code: 'MODEL_HTTP_ERROR', status: 401 }) }
    const requestId = randomUUID()
    await createResearch({ repository, uid: 'alice', niche, requestId, research })
    const result = await runContentJob({ repository, uid: 'alice', requestId, research })
    assert.equal(result.status, 'failed')
    assert.match(result.error, /Update the provider key/)
    assert.equal(result.error.includes('Private provider response'), false)
    assert.equal(repository.studioGet('alice', 'research_state', niche.id).status, 'failed')
    assert.equal(repository.budgetGet('alice', requestId).status, 'dispatch_unknown', 'an access rejection is not a billing receipt')
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId, research })).status, 'skipped')
    const next = await createResearch({ repository, uid: 'alice', niche, requestId: randomUUID(), research })
    assert.equal(next.jobStatus, 'reserved')
    assert.equal(calls, 1, 'only another explicit worker dispatch may retry')
  } finally { repository.close() }
})

test('default HTTP generation queues without provider calls; worker claims once, cancellation and crashes do not redispatch', async () => {
  const repository = createRepository(':memory:')
  let calls = 0
  const generate = async () => { calls++; return content }
  const app = express(); app.use(express.json()); app.use(studioRouter({ repository, generate, auth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization, role: 'user' }; next() } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, body, uid = 'alice') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: uid, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  async function queue(id) {
    const draft = await repository.studioPut('alice', 'package', id, { settings: { platform: 'X', outputs: ['script'] }, evidence, content: null, status: 'draft' }, 0)
    const response = await call(`/packages/${id}/generate`, { requestId: `request-${id}`, revision: draft.revision, confirmed: true })
    assert.equal(response.status, 202)
    return response.json()
  }
  try {
    const queued = await queue('one')
    assert.equal(queued.jobStatus, 'reserved'); assert.equal(calls, 0)
    await call('/packages/one'); await call('/jobs/request-one'); assert.equal(calls, 0)
    assert.equal((await call('/jobs/request-one', undefined, 'bob')).status, 404)
    const outcomes = await Promise.all([runContentJob({ repository, uid: 'alice', requestId: 'request-one', generate }), runContentJob({ repository, uid: 'alice', requestId: 'request-one', generate })])
    assert.deepEqual(outcomes.map(value => value.status).sort(), ['completed', 'skipped']); assert.equal(calls, 1)
    assert.deepEqual((await (await call('/jobs/request-one')).json()).result.content, content)
    await queue('cancel')
    assert.equal((await call('/jobs/request-cancel/cancel', {}, 'bob')).status, 404)
    assert.equal((await call('/jobs/request-cancel/cancel', {})).status, 200)
    assert.equal(repository.budgetGet('alice', 'request-cancel').status, 'cancelled')
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId: 'request-cancel', generate })).status, 'skipped'); assert.equal(calls, 1)
    await queue('crash')
    const crashed = repository.studioJobGet('alice', 'request-crash')
    repository.studioJobUpdate('alice', crashed.id, { status: 'running' }, crashed.revision, 'reserved')
    assert.equal((await call('/jobs/request-crash/cancel', {})).status, 409)
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId: crashed.id, generate })).status, 'skipped'); assert.equal(calls, 1)
    await queue('unknown')
    const unknown = await runContentJob({ repository, uid: 'alice', requestId: 'request-unknown', generate: async () => { calls++; throw new Error('Ambiguous transport failure') } })
    assert.equal(unknown.status, 'dispatch_unknown'); assert.equal(repository.budgetGet('alice', 'request-unknown').status, 'dispatch_unknown')
    await assert.rejects(recoverRejectedGeneration({ repository, uid: 'alice', packageId: 'unknown', revision: repository.studioGet('alice', 'package', 'unknown').revision }), /no confirmed validation rejection/)
    assert.deepEqual(await runPendingContentJobs(repository, { generate }), []); assert.equal(calls, 2)
    await queue('rejected')
    const rejected = await runContentJob({ repository, uid: 'alice', requestId: 'request-rejected', generate: async () => { throw Object.assign(new Error('Content rejected'), { code: 'EVIDENCE_VALIDATION', issueCount: 2 }) } })
    assert.equal(rejected.status, 'failed'); assert.equal(rejected.diagnostics.issueCount, 2)
    assert.equal(repository.budgetGet('alice', 'request-rejected').status, 'dispatch_unknown')
    assert.equal(repository.studioGet('alice', 'package', 'rejected').status, 'failed')
    await queue('legacy-rejected')
    await runContentJob({ repository, uid: 'alice', requestId: 'request-legacy-rejected', generate: async () => { throw Object.assign(new Error('old failure'), { code: 'MODEL_INCOMPLETE' }) } })
    const old = repository.studioJobGet('alice', 'request-legacy-rejected')
    const legacyRepository = { ...repository, studioJobGet: (uid, id) => {
      const value = repository.studioJobGet(uid, id)
      return value && id === old.id ? { ...value, error: 'Existing content preserved. Diagnostics: {"code":"EVIDENCE_VALIDATION","name":"Error"}' } : value
    } }
    const oldPack = repository.studioGet('alice', 'package', 'legacy-rejected')
    await assert.rejects(recoverRejectedGeneration({ repository, uid: 'bob', packageId: oldPack.id, revision: oldPack.revision }), /Draft version changed/)
    await assert.rejects(recoverRejectedGeneration({ repository, uid: 'alice', packageId: oldPack.id, revision: 1 }), /Draft version changed/)
    const recovered = await recoverRejectedGeneration({ repository: legacyRepository, uid: 'alice', packageId: oldPack.id, revision: oldPack.revision })
    assert.equal(recovered.status, 'failed'); assert.deepEqual(recovered.content, oldPack.content)
    assert.equal(repository.budgetGet('alice', old.id).status, 'dispatch_unknown')
    assert.equal((await call(`/packages/${oldPack.id}/recover-generation`, { revision: recovered.revision }, 'bob')).status, 404)
    assert.equal((await call(`/packages/${oldPack.id}/recover-generation`, { revision: oldPack.revision })).status, 409)
    assert.equal((await call(`/packages/${oldPack.id}/recover-generation`, { revision: recovered.revision })).status, 200)
    await queue('truncated')
    await runContentJob({ repository, uid: 'alice', requestId: 'request-truncated', generate: async () => { throw Object.assign(new Error('Truncated response'), { code: 'MODEL_INCOMPLETE', generationId: 'gen-123-safe', transportStatus: 200, finishReason: 'tool_calls' }) } })
    const truncatedPack = repository.studioGet('alice', 'package', 'truncated')
    await assert.rejects(recoverRejectedGeneration({ repository, uid: 'alice', packageId: truncatedPack.id, revision: truncatedPack.revision, readFailure: async () => { throw new Error('Receipt missing') } }), /not confirmed/)
    assert.equal(repository.studioJobGet('alice', 'request-truncated').status, 'dispatch_unknown')
    const recoveredTruncation = await recoverRejectedGeneration({ repository, uid: 'alice', packageId: truncatedPack.id, revision: truncatedPack.revision, readFailure: async id => { assert.equal(id, 'gen-123-safe'); return { generationId: id, actualMicros: 0, finishReason: 'length' } } })
    assert.equal(recoveredTruncation.status, 'failed')
    assert.equal(repository.budgetGet('alice', 'request-truncated').status, 'settled')
    assert.equal(repository.studioJobGet('alice', 'request-truncated').result.reconciliation.actualMicros, 0)
    await queue('gateway')
    const gateway = await runContentJob({ repository, uid: 'alice', requestId: 'request-gateway', generate: async () => { throw Object.assign(new Error('Gateway response'), { code: 'MODEL_INCOMPLETE', transportStatus: 200, providerErrorCode: 504 }) } })
    assert.equal(gateway.status, 'failed')
    assert.equal(repository.budgetGet('alice', 'request-gateway').status, 'dispatch_unknown', 'provider error is not a billing receipt or refund')
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId: 'request-gateway' })).status, 'skipped')
    const invalidPack = repository.studioGet('alice', 'package', 'unknown')
    await assert.rejects(recoverRejectedGeneration({ repository, uid: 'alice', packageId: invalidPack.id, revision: invalidPack.revision }), /no confirmed validation rejection/)
    const vertexRepository = { ...repository, budgetGet: (uid, id) => id === 'vertex-request-unknown-0' ? { quote: { priceVersion: 'gemini-3.8-flash-global-2026-10-29' } } : repository.budgetGet(uid, id), studioJobGet: (uid, id) => {
      const value = repository.studioJobGet(uid, id)
      return value && id === 'request-unknown' ? { ...value, scope: { ...value.scope, generationProvider: 'free' }, error: 'Rejected request. Diagnostics: {"code":"VERTEX_REQUEST_FAILED","httpStatus":400}' } : value
    } }
    assert.equal((await recoverRejectedGeneration({ repository: vertexRepository, uid: 'alice', packageId: invalidPack.id, revision: invalidPack.revision })).status, 'failed')
    assert.equal(repository.budgetGet('alice', 'request-unknown').status, 'dispatch_unknown')
    await queue('changed')
    const changed = repository.studioGet('alice', 'package', 'changed')
    repository.studioPut('alice', 'package', 'changed', { ...changed, settings: { ...changed.settings, audience: 'Changed after queue' } }, changed.revision)
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId: 'request-changed', generate })).status, 'failed'); assert.equal(calls, 2)
    assert.equal(repository.budgetGet('alice', 'request-changed').status, 'cancelled')
    await queue('cancel-step')
    let attempts = 0
    const stopped = await runContentJob({ repository, uid: 'alice', requestId: 'request-cancel-step', generate: (sources, settings, context, _unused, options) => generateContent(sources, settings, context, async () => {
      attempts++
      const budget = repository.budgetGet('alice', 'request-cancel-step')
      repository.budgetTransition('alice', budget.id, budget.revision, 'cancel')
      return { ...content, hooks: ['This needs a citation'] }
    }, options) })
    assert.equal(stopped.status, 'dispatch_unknown'); assert.equal(attempts, 1)
    assert.equal(repository.budgetGet('alice', 'request-cancel-step').cancellationRequested, true)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('workspace membership revoked during research extraction prevents subsequent inference', async () => {
  const repository = createRepository(':memory:')
  try {
    const uid = `ws:${randomUUID()}`
    const workspace = repository.studioPut('__workspace_control__', 'workspace', uid, { members: [{ uid: 'alice', role: 'editor' }] }, 0)
    const niche = repository.studioPut(uid, 'niche', randomUUID(), { name: 'Science', brief: 'Explain useful science announcements for readers.' }, 0)
    let reads = 0; let inferences = 0
    const research = (value, options) => researchNiche(value, { ...options, read: async () => {
      reads++
      repository.studioPut('__workspace_control__', 'workspace', uid, { ...workspace, members: [] }, workspace.revision)
      return [{ url: 'https://example.com', title: 'Publisher preview', excerpt: evidence[0].excerpt, publishedAt: new Date().toISOString() }]
    }, generate: async () => { inferences++; return { summary: 'Unexpected inference', opportunities: [], unknowns: [] } } })
    const requestId = randomUUID()
    await createResearch({ repository, uid, actorUid: 'alice', niche, requestId, research })
    const result = await runContentJob({ repository, uid, requestId, research })
    assert.equal(result.status, 'dispatch_unknown'); assert.equal(reads, 1); assert.equal(inferences, 0)
    assert.equal(repository.studioList(uid, 'research').length, 0)
  } finally { repository.close() }
})

test('research queues immutable scope and runs only in the explicit worker', async () => {
  const repository = createRepository(':memory:')
  try {
    const niche = repository.studioPut('alice', 'niche', randomUUID(), { name: 'Science', brief: 'Explain useful science announcements for readers.' }, 0)
    let calls = 0
    const research = async value => { calls++; assert.equal(value.name, 'Science'); return { summary: 'Saved research', opportunities: [], unknowns: [], researchedAt: new Date(Date.now() - 86400000).toISOString(), evidence } }
    const requestId = randomUUID()
    const queued = await createResearch({ repository, uid: 'alice', niche, requestId, research })
    assert.equal(queued.jobStatus, 'reserved'); assert.equal(calls, 0)
    const outcome = await runContentJob({ repository, uid: 'alice', requestId, research })
    assert.equal(outcome.status, 'completed'); assert.equal(calls, 1)
    assert.equal(repository.studioList('alice', 'research').length, 1)
    assert.equal(outcome.result.changes.previousReportId, null)
    const refreshId = randomUUID()
    await createResearch({ repository, uid: 'alice', niche, requestId: refreshId, refresh: true, research })
    const refreshed = await runContentJob({ repository, uid: 'alice', requestId: refreshId, refresh: true, research })
    assert.equal(refreshed.result.changes.previousReportId, outcome.result.id)
    assert.equal(repository.studioGet('alice', 'research', refreshed.result.id).changes.previousReportId, outcome.result.id)
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId, research })).status, 'skipped')
    assert.equal(calls, 2)
  } finally { repository.close() }
})

test('admission is invisible until ready and interrupted cancellation cleanup is retryable', async () => {
  const repository = createRepository(':memory:')
  try {
    const niche = repository.studioPut('alice', 'niche', randomUUID(), { name: 'Science', brief: 'Explain useful science announcements for readers.' }, 0)
    let calls = 0
    const research = async () => { calls++; return { summary: 'Saved research', opportunities: [], unknowns: [], researchedAt: new Date(Date.now() - 86400000).toISOString(), evidence } }
    const originalPut = repository.studioPut.bind(repository)
    repository.studioPut = async (uid, kind, id, payload, revision) => {
      if (kind === 'research_state' && payload.status === 'reserved') {
        const before = calls
        await assert.rejects(cancelContentJob({ repository, uid, requestId: payload.jobId }), /admission is not complete/)
        assert.equal(repository.studioJobGet(uid, payload.jobId).status, 'reserved')
        assert.deepEqual(await runPendingContentJobs(repository, { research }), [])
        assert.equal((await runContentJob({ repository, uid, requestId: payload.jobId, research })).status, 'skipped')
        assert.equal(calls, before)
      }
      return originalPut(uid, kind, id, payload, revision)
    }
    const requestId = randomUUID()
    await createResearch({ repository, uid: 'alice', niche, requestId, research })
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId, research })).status, 'completed')
    assert.equal(calls, 1)
    const cancelId = randomUUID()
    await createResearch({ repository, uid: 'alice', niche, requestId: cancelId, refresh: true, research })
    const originalTransition = repository.budgetTransition.bind(repository)
    let failOnce = true
    repository.budgetTransition = (...args) => {
      if (failOnce && args[3] === 'cancel') { failOnce = false; throw new Error('Simulated cleanup crash') }
      return originalTransition(...args)
    }
    await assert.rejects(cancelContentJob({ repository, uid: 'alice', requestId: cancelId }), /cleanup crash/)
    assert.equal(repository.studioJobGet('alice', cancelId).status, 'cancelled')
    assert.equal(repository.budgetGet('alice', cancelId).status, 'reserved')
    await cancelContentJob({ repository, uid: 'alice', requestId: cancelId })
    assert.equal(repository.budgetGet('alice', cancelId).status, 'cancelled')
    assert.equal(repository.studioGet('alice', 'research_state', niche.id).status, 'cancelled')
    assert.equal(calls, 1)
  } finally { repository.close() }
})

