import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { planningRouter } from '../studio/planning.js'
import { contentHash } from '../studio/approval.js'
import { reviewFixture } from './fixtures/finalization.js'
import { settingsSchema } from '../studio/content.js'

test('planning is owner-scoped, validates references, uses optimistic edits and requires current approval for Ready', async () => {
  const repository = createRepository(':memory:')
  const settings = settingsSchema.parse({ platform: 'Instagram' })
  const text = 'The publisher announced a preview [C1].'
  const content = { hooks: [text], script: text, scenes: [{ timing: '0-15', narration: text, onScreen: text, visualPrompt: 'Illustrative preview', voiceDirection: 'Clear' }], captions: { reel: text, linkedin: text }, website: { title: text, body: text }, claims: [{ id: 'C1', text: 'The publisher announced a preview', evidenceId: 'E1', quote: 'The publisher announced a preview', status: 'attributed' }], strategy: { angle: 'An attributed preview', audience: 'Readers', whyNow: 'Recent publication', factCheck: 'Independent review', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Creative choice', delivery: 'Clear', keywords: ['preview'], platforms: [{ platform: 'Instagram', headline: text, hook: text, body: text, cta: 'Read the source', hashtags: [], thumbnail: 'Illustrative preview', format: 'Reel', retentionPlan: 'Explain the preview', alternativeHook: text, testPlan: 'Observe results' }], production: { videoPrompt: 'Illustrative', audioPrompt: 'Clear', musicDirection: 'None', subtitleStyle: 'Readable', editingNotes: 'Keep attribution' }, experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Observed engagement', decisionRule: 'Compare equal exposure' }] } }
  let pack = repository.studioPut('alice', 'package', 'package-a', { title: 'Saved preview', settings, content, evidence: [{ id: 'E1', excerpt: 'The publisher announced a preview today.', hash: 'source1' }], editorialStatus: 'draft', reviewerId: 'bob' }, 0)
  repository.studioPut('alice', 'research', 'report-a', { opportunities: [{ title: 'Saved topic' }] }, 0)
  const app = express(); app.use(express.json()); app.use('/planning', planningRouter({ repository, auth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization }; next() } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/planning`
  const call = (path = '', method = 'GET', body, uid = 'alice', workspace = 'personal') => fetch(base + path, { method, headers: { Authorization: uid, 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    assert.equal((await fetch(base)).status, 401)
    assert.equal((await call('/shortlist', 'POST', { reportId: 'report-a', index: 0 }, 'bob')).status, 404)
    assert.equal((await call('/shortlist', 'POST', { reportId: 'report-a', index: 1 })).status, 422)
    repository.studioPut('alice', 'research', 'report-twelve', { opportunities: Array.from({ length: 12 }, (_, index) => ({ title: `Topic ${index + 1}` })) }, 0)
    const lastTopic = await (await call('/shortlist', 'POST', { reportId: 'report-twelve', index: 11 })).json()
    assert.equal(lastTopic.title, 'Topic 12')
    assert.equal((await call('/shortlist', 'POST', { reportId: 'report-twelve', index: 12 })).status, 400)
    await call(`/shortlist/${lastTopic.id}`, 'PATCH', { revision: lastTopic.revision, archived: true })
    const short = await (await call('/shortlist', 'POST', { reportId: 'report-a', index: 0 })).json()
    const same = await (await call('/shortlist', 'POST', { reportId: 'report-a', index: 0 })).json(); assert.equal(same.revision, short.revision)
    assert.equal((await call(`/shortlist/${short.id}`, 'PATCH', { revision: short.revision, archived: true }, 'bob')).status, 404)
    assert.equal((await call(`/shortlist/${short.id}`, 'PATCH', { revision: short.revision, archived: true })).status, 200)
    assert.equal((await call(`/shortlist/${short.id}`, 'PATCH', { revision: short.revision, archived: false })).status, 409)
    assert.equal((await call('/templates', 'POST', { name: 'Unsafe', settings, apiKey: 'not-a-secret-fixture' })).status, 400)
    assert.equal((await call('/templates', 'POST', { name: 'Unsafe', settings: { ...settings, token: 'fixture' } })).status, 400)
    const template = await (await call('/templates', 'POST', { name: 'My preferences', settings })).json()
    assert.equal((await call(`/templates/${template.id}`, 'PATCH', { revision: template.revision, name: 'Updated' })).status, 200)
    assert.equal((await call(`/templates/${template.id}`, 'PATCH', { revision: template.revision, archived: true })).status, 409)
    assert.equal((await call('/board', 'POST', { packageId: pack.id }, 'bob')).status, 404)
    assert.equal((await call('/board', 'POST', { packageId: pack.id, status: 'ready' })).status, 422)
    assert.equal((await call('/board', 'POST', { packageId: pack.id, planningDate: '2026-02-31' })).status, 400)
    const card = await (await call('/board', 'POST', { packageId: pack.id, planningDate: '2026-12-01' })).json()
    const repeated = await (await call('/board', 'POST', { packageId: pack.id })).json(); assert.equal(repeated.id, card.id); assert.equal(repeated.revision, card.revision); assert.equal(repeated.planningDate, '2026-12-01')
    pack = repository.studioPut('alice', 'package', pack.id, { ...pack, researchId: 'report-a', opportunityIndex: 0 }, pack.revision)
    repository.studioPut('alice', 'package', 'duplicate-fixture', { title: 'Other draft', researchId: 'report-a', opportunityIndex: 0 }, 0)
    await call('/shortlist', 'POST', { reportId: 'report-a', index: 0 })
    assert.equal((await (await call()).json()).shortlist.length, 0)
    const hash = contentHash(pack); const reviewedAt = Date.now()
    pack = repository.studioPut('alice', 'package', pack.id, { ...pack, editorialStatus: 'approved', independentReview: reviewFixture(pack), approval: { contentHash: hash, method: 'independent-human', approvedBy: 'alice', approvedAt: new Date(reviewedAt).toISOString() } }, pack.revision)
    assert.equal((await call(`/board/${card.id}`, 'PATCH', { revision: card.revision, status: 'ready' })).status, 200)
    assert.equal((await call(`/board/${card.id}`, 'PATCH', { revision: card.revision, status: 'idea' })).status, 409)
    assert.equal((await (await call()).json()).board[0].status, 'ready')
    repository.studioPut('alice', 'package', pack.id, { ...pack, settings: { ...settings, audience: 'Changed audience' } }, pack.revision)
    const after = await (await call()).json(); assert.equal(after.board[0].status, 'review'); assert.equal(after.board[0].approvalChanged, true)
    assert.equal(after.shortlist.length, 0); assert.equal(after.templates.length, 1)
    const other = await (await call('', 'GET', undefined, 'bob')).json(); for (const key of ['shortlist', 'templates', 'board', 'topics', 'packages']) assert.deepEqual(other[key], [])
    assert.equal(repository.studioList('alice', 'job').length, 0)
    const originalGet = repository.studioGet.bind(repository)
    let raced = false
    repository.studioGet = (uid, kind, key) => {
      const snapshot = originalGet(uid, kind, key)
      if (!raced && kind === 'template' && key === template.id) {
        raced = true
        repository.studioPut(uid, kind, key, { ...snapshot, name: 'Concurrent update' }, snapshot.revision)
      }
      return snapshot
    }
    assert.equal((await call(`/templates/${template.id}`, 'PATCH', { revision: template.revision + 2, name: 'Must not overwrite stale snapshot' })).status, 409)
    assert.equal(originalGet('alice', 'template', template.id).name, 'Concurrent update')
    const scope = 'ws:11111111-1111-4111-8111-111111111111'
    const workspace = repository.studioPut('__workspace_control__', 'workspace', scope, { name: 'Shared test', members: [{ uid: 'alice', role: 'owner' }, { uid: 'bob', role: 'reviewer' }, { uid: 'viewer', role: 'viewer' }] }, 0)
    repository.studioPut(scope, 'package', pack.id, pack, 0)
    assert.equal((await call('', 'GET', undefined, 'outsider', scope)).status, 403)
    assert.equal((await call('/board', 'POST', { packageId: pack.id }, 'viewer', scope)).status, 403)
    assert.equal((await call('/board', 'POST', { packageId: pack.id, status: 'ready' }, 'alice', scope)).status, 201)
    assert.equal((await (await call('', 'GET', undefined, 'viewer', scope)).json()).board[0].status, 'ready')
    repository.studioPut('__workspace_control__', 'workspace', scope, { ...workspace, members: workspace.members.filter(member => member.uid !== 'bob') }, workspace.revision)
    assert.equal((await (await call('', 'GET', undefined, 'alice', scope)).json()).board[0].status, 'review')
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
