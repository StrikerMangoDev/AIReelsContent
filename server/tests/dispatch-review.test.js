import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'
import { contentHash } from '../studio/approval.js'
import { ratingsFixture } from './fixtures/finalization.js'

const evidence = [{ id: 'E1', hash: 'source', excerpt: 'The publisher announced a preview. Availability is limited and the supplied source does not establish any performance claims or public reception.' }]
const content = {
  hooks: ['Preview [C1]'], script: 'Preview [C1]', scenes: [{ timing: '0-15s', narration: 'Preview [C1]', onScreen: 'Preview', visualPrompt: 'Illustration', voiceDirection: 'Calm' }],
  captions: { reel: 'Preview [C1]', linkedin: 'Preview [C1]' }, website: { title: 'Preview', body: 'Preview [C1]' },
  claims: [{ id: 'C1', text: 'Preview', evidenceId: 'E1', quote: 'The publisher announced a preview.', status: 'attributed' }],
  strategy: {
    angle: 'Preview', audience: 'Readers', whyNow: 'Current source', factCheck: 'Review required', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Preference', delivery: 'Clear', keywords: ['preview'],
    platforms: [{ platform: 'X', headline: 'Preview [C1]', hook: 'Preview [C1]', body: 'Preview [C1]', alternativeHook: 'Announcement [C1]', cta: 'Read the source', hashtags: [], thumbnail: 'Illustration', format: 'Post', retentionPlan: 'Explain', testPlan: 'Observe engagement' }],
    production: { videoPrompt: 'Illustration', audioPrompt: 'Narration', musicDirection: 'None', subtitleStyle: 'Readable', editingNotes: 'Simple' },
    experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Engagement', decisionRule: 'Compare observations' }],
  },
}

async function fixture(run) {
  const repository = createRepository(':memory:')
  let calls = 0
  const app = express(); app.use(express.json())
  app.use(studioRouter({ repository, dispatchMode: 'inline', auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice', role: 'user' }; next() }, generate: async () => { calls++; return content } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, body, owner = 'alice', method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: owner, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try { await run(repository, call, () => calls) } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
}

test('expired legacy review blocks export and cannot be bypassed by author confirmation', async () => fixture(async (repo, call) => {
  const value = { settings: { platform: 'X' }, evidence, content, reviewerId: 'bob', status: 'completed', editorialStatus: 'approved' }
  const hash = contentHash(value)
  const reviewedAt = new Date(Date.now() - 86401000).toISOString()
  const expiresAt = new Date(Date.now() - 1000).toISOString()
  const pack = await repo.studioPut('alice', 'package', 'expired-review', { ...value, independentReview: { status: 'passed', contentHash: hash, reviewerId: 'bob', reviewedAt, expiresAt, freshnessConfirmed: true, contradictionsResolved: true }, approval: { contentHash: hash } }, 0)
  assert.equal((await call('/packages/expired-review/export', undefined, 'alice', 'GET')).status, 409)
  const confirmed = await call('/packages/expired-review', { revision: pack.revision, editorialStatus: 'approved' }, 'alice', 'PATCH')
  assert.equal(confirmed.status, 422)
  assert.equal((await repo.studioGet('alice', 'package', pack.id)).independentReview.expiresAt, expiresAt)
  assert.equal((await call('/packages/expired-review/export', undefined, 'alice', 'GET')).status, 409)
}))

test('result persistence followed by job failure preserves output and blocks a new dispatch', async () => fixture(async (repo, call, calls) => {
  const draft = await repo.studioPut('alice', 'package', 'draft', { settings: { platform: 'X' }, evidence, content: null, status: 'draft' }, 0)
  const update = repo.studioJobUpdate
  let failCompletion = true
  repo.studioJobUpdate = (...args) => {
    if (args[2].status === 'completed' && failCompletion) { failCompletion = false; throw new Error('simulated persistence failure') }
    return update(...args)
  }
  const response = await call('/packages/draft/generate', { requestId: 'attempt-one', revision: draft.revision, confirmed: true })
  assert.equal(response.status, 502)
  const saved = await response.json()
  assert.equal(saved.status, 'dispatch_unknown')
  assert.deepEqual(saved.content, content)
  assert.equal((await repo.studioJobGet('alice', 'attempt-one')).status, 'dispatch_unknown')
  assert.equal((await call('/packages/draft/generate', { requestId: 'attempt-two', revision: saved.revision, confirmed: true })).status, 409)
  assert.equal(calls(), 1)
}))

test('future revisions cannot overwrite a snapshot or impersonate an assigned reviewer', async () => fixture(async (repo, call) => {
  const draft = await repo.studioPut('alice', 'package', 'draft', { settings: { platform: 'X' }, evidence, content, reviewerId: 'bob', status: 'completed' }, 0)
  assert.equal((await call('/packages/draft', { revision: draft.revision + 1, editorialStatus: 'needs_review' }, 'alice', 'PATCH')).status, 409)
  assert.equal((await call('/packages/draft/assign-reviewer', { revision: draft.revision + 1, reviewerId: 'carol' })).status, 409)
  assert.equal((await call('/reviews/alice/draft', { revision: draft.revision + 1, claims: [{ id: 'C1', supported: true, note: 'The quoted passage supports this claim.' }], rightsConfirmed: true, promiseAligned: true, freshnessConfirmed: true, contradictionsResolved: true, accessibilityConfirmed: true, scopeConfirmed: true, ratings: ratingsFixture() }, 'bob')).status, 409)
  assert.equal((await call('/reviews/alice/draft', undefined, 'carol', 'GET')).status, 404)
  assert.equal((await repo.studioGet('alice', 'package', 'draft')).reviewerId, 'bob')
}))

test('settings on an empty draft preserve draft status when insufficient evidence blocks generation', async () => {
  const repository = createRepository(':memory:')
  let calls = 0
  const app = express(); app.use(express.json()); app.use(studioRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: 'alice', role: 'user' }; next() }, generate: async () => { calls++; return content } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, method, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  try {
    const draft = repository.studioPut('alice', 'package', 'short-source', { content: null, settings: { platform: 'X', outputs: ['script'] }, evidence: [{ ...evidence[0], excerpt: 'Only a headline.' }], status: 'draft', editorialStatus: 'draft' }, 0)
    const savedResponse = await call('/packages/short-source', 'PATCH', { revision: draft.revision, settings: { ...draft.settings, platform: 'LinkedIn' } })
    assert.equal(savedResponse.status, 200)
    const saved = await savedResponse.json()
    assert.equal(saved.editorialStatus, 'draft'); assert.equal(saved.content, null)
    const response = await call('/packages/short-source/generate', 'POST', { revision: saved.revision, confirmed: true, requestId: 'short-source-request' })
    assert.equal(response.status, 422); assert.match((await response.json()).error, /Insufficient source evidence/)
    assert.equal(calls, 0)
    assert.equal(repository.studioGet('alice', 'package', draft.id).editorialStatus, 'draft')
    assert.equal(repository.studioJobGet('alice', 'short-source-request'), null)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
