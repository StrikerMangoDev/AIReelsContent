import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { intelligenceRouter } from '../studio/intelligence.js'
import { studioRouter } from '../studio/routes.js'
import { generateContent } from './helpers/passage-model.js'
import { runContentJob } from '../studio/job-worker.js'
import { ratingsFixture } from './fixtures/finalization.js'

for (const platform of ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']) test(`${platform}: queued research to selected-output export requires rated independent review, owner confirmation and workspace access`, async () => {
  const repository = createRepository(':memory:')
  const uid = `ws:${randomUUID()}`
  const members = [{ uid: 'alice', role: 'owner' }, { uid: 'bob', role: 'editor' }, { uid: 'carol', role: 'reviewer' }]
  repository.studioPut('__workspace_control__', 'workspace', uid, { name: 'Journey', members }, 0)
  const source = { id: 'E1', url: 'https://example.com/release', title: 'Announcement', publisher: 'example.com', excerpt: 'The publisher announced a model preview with limited availability. Independent capability testing has not yet been published.', hash: 'original', limitations: ['Publisher claim only'], type: 'retrieved-source', retrievedAt: new Date().toISOString() }
  const topic = { title: 'A model preview', whatChanged: 'A preview was announced.', eventDate: null, verification: 'reported', whyItMatters: 'Developers can evaluate availability.', evidenceIds: ['E1'], positive: [], negative: [], audienceReaction: { status: 'insufficient-evidence', summary: 'No audience sample.', evidenceIds: [], limitations: 'No representative data.' }, angle: 'Explain preview limits.', hook: 'Preview is not proven.', counterpoint: 'Testing is missing.', opportunityReason: 'Useful context, not measured popularity.', keywords: ['preview'] }
  const content = { script: 'A preview was announced [C1].', hooks: ['Preview limits [C1]'], claims: [{ id: 'C1', text: 'A preview was announced', evidenceId: 'E1', quote: source.excerpt, status: 'attributed' }] }
  content.strategy = { angle: 'Explain limits', audience: 'Readers', whyNow: 'Announcement', factCheck: 'Check the original source', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Preference', delivery: 'Clear', keywords: ['preview'], platforms: [{ platform, headline: 'Preview [C1]', hook: 'Preview [C1]', body: 'Preview [C1]', cta: 'Read source', hashtags: ['preview'], thumbnail: 'Illustration', format: 'Post', retentionPlan: 'Explain limits', alternativeHook: 'Announcement [C1]', testPlan: 'Compare observed engagement' }], experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Observed engagement', decisionRule: 'Equal exposure' }] }
  let researchCalls = 0; let generateCalls = 0
  const research = async () => { researchCalls++; return { summary: 'Publisher announcement', opportunities: [topic], unknowns: ['Independent results'], evidence: [source], researchedAt: new Date().toISOString() } }
  const generate = (evidence, settings, context, _unused, options) => generateContent(evidence, settings, context, async request => { generateCalls++; assert.deepEqual(settings.outputs, ['script', 'platforms']); assert.equal(context.opportunity.title, topic.title); assert.deepEqual(Object.keys(request.schema.properties).sort(), ['claims', 'hooks', 'script', 'strategy']); assert.ok(request.system.includes(platform)); return content }, options)
  const auth = (req, res, next) => { req.identity = { uid: req.headers.authorization, role: 'user' }; next() }
  const app = express(); app.use(express.json())
  app.use('/intelligence', intelligenceRouter({ repository, auth, research }))
  app.use(studioRouter({ repository, auth, generate, fetchSource: async () => ({ ...source, hash: 'changed' }) }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, method = 'GET', body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: actor, 'X-Workspace-Id': uid, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  async function json(path, method, body, actor) { const response = await call(path, method, body, actor); assert.ok(response.ok, `${method || 'GET'} ${path}: ${response.status} ${response.ok ? '' : await response.text()}`); return response.json() }
  async function confirmForDownload(id) {
    const pack = await json(`/packages/${id}`)
    const assigned = await json(`/packages/${id}/assign-reviewer`, 'POST', { revision: pack.revision, reviewerId: 'carol' })
    const reviewed = await json(`/reviews/${encodeURIComponent(uid)}/${id}`, 'POST', { revision: assigned.revision, claims: pack.content.claims.map(claim => ({ id: claim.id, supported: true, note: 'The saved publisher passage supports the claim in context.' })), rightsConfirmed: true, promiseAligned: true, freshnessConfirmed: true, contradictionsResolved: true, accessibilityConfirmed: true, scopeConfirmed: true, ratings: ratingsFixture() }, 'carol')
    return json(`/packages/${id}`, 'PATCH', { revision: reviewed.revision, editorialStatus: 'approved' }, 'bob')
  }
  try {
    const audit = await json('/intelligence/ideas/check', 'POST', { input: { topic: 'Science', brief: 'Explain new science announcements for readers.' }, requestId: randomUUID() })
    const niche = await json('/intelligence/ideas/create', 'POST', { auditId: audit.id, confirmed: true })
    const requestId = randomUUID()
    assert.equal((await call('/intelligence/research', 'POST', { nicheId: niche.id, nicheRevision: niche.revision, confirmed: true, requestId })).status, 202)
    const state = await json('/intelligence'); assert.equal(state.states[0].jobId, requestId)
    await json(`/jobs/${requestId}`); assert.equal(researchCalls, 0)
    const researched = await runContentJob({ repository, uid, requestId, research }); assert.equal(researched.status, 'completed')
    const report = await json(`/intelligence/reports/${researched.result.id}`)
    let pack = await json('/packages', 'POST', { researchId: report.id, opportunityIndex: 0, requestId: randomUUID() })
    assert.deepEqual(pack.settings.outputs, ['captions', 'platforms'], 'new research drafts start with a small social-content package')
    pack = await json(`/packages/${pack.id}`, 'PATCH', { revision: pack.revision, settings: { ...pack.settings, platform, outputs: ['script', 'platforms'] } })
    const generationId = randomUUID()
    assert.equal((await call(`/packages/${pack.id}/generate`, 'POST', { revision: pack.revision, confirmed: true, requestId: generationId })).status, 202)
    await json(`/packages/${pack.id}`); assert.equal(generateCalls, 0)
    assert.equal((await runContentJob({ repository, uid, requestId: generationId, generate })).status, 'completed')
    assert.equal((await call(`/packages/${pack.id}/export`)).status, 409)
    pack = await confirmForDownload(pack.id)
    let exported = await json(`/packages/${pack.id}/export`)
    assert.deepEqual(Object.keys(exported.package.content).sort(), ['claims', 'hooks', 'script', 'strategy'])
    assert.equal(exported.manifest.approvedBy, 'bob'); assert.equal(exported.manifest.approvalMethod, 'independent-human'); assert.equal(exported.manifest.reviewerId, 'carol'); assert.ok(exported.manifest.contentHash)
    assert.equal((await call(`/packages/${pack.id}/export`, 'GET', undefined, 'outsider')).status, 403)
    const planned = await json('/planning/board', 'POST', { packageId: pack.id, status: 'ready' })
    assert.equal(planned.status, 'ready', 'rated review and separate owner confirmation unlock planner readiness')
    let workspace = repository.studioGet('__workspace_control__', 'workspace', uid)
    repository.studioPut('__workspace_control__', 'workspace', uid, { ...workspace, members: [members[0]] }, workspace.revision)
    assert.equal((await call(`/packages/${pack.id}/export`)).status, 422)
    assert.equal((await call(`/reviews/${encodeURIComponent(uid)}/${pack.id}`, 'GET', undefined, 'bob')).status, 403)
    workspace = repository.studioGet('__workspace_control__', 'workspace', uid)
    repository.studioPut('__workspace_control__', 'workspace', uid, { ...workspace, members }, workspace.revision)
    pack = await json(`/packages/${pack.id}`, 'PATCH', { revision: pack.revision, content: { ...content, hooks: ['New preview hook [C1]'] } })
    assert.equal((await call(`/packages/${pack.id}/export`)).status, 409)
    await confirmForDownload(pack.id)
    exported = await json(`/packages/${pack.id}/export`); assert.equal(exported.package.content.hooks[0], 'New preview hook [C1]')
    await json(`/packages/${pack.id}/refresh-evidence`, 'POST', { confirmed: true })
    assert.equal((await call(`/packages/${pack.id}/export`)).status, 409)
    assert.equal(researchCalls, 1); assert.equal(generateCalls, 1)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
