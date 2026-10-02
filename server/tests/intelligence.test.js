import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { groundedSources, intelligenceRouter, validateIntelligence, refreshNextNiche } from '../studio/intelligence.js'
import { studioRouter } from '../studio/routes.js'
import { reviewContent } from '../studio/content.js'

const source = { id: 'E1', url: 'https://example.com/release', title: 'Announcement', publisher: 'example.com', excerpt: 'The publisher announced a model preview with limited availability. Independent capability testing has not yet been published.', hash: 'test', limitations: ['Publisher claim only'], type: 'retrieved-source', retrievedAt: new Date().toISOString() }
const topic = { title: 'A model preview', whatChanged: 'A preview was announced.', eventDate: null, verification: 'reported', whyItMatters: 'Developers can evaluate availability.', evidenceIds: ['E1'], positive: [{ text: 'Preview access', evidenceIds: ['E1'] }], negative: [], audienceReaction: { status: 'insufficient-evidence', summary: 'No audience sample.', evidenceIds: [], limitations: 'No representative discussion data.' }, angle: 'Explain what preview means.', hook: 'Preview does not mean proven.', counterpoint: 'Independent testing is missing.', opportunityReason: 'Useful context, not measured popularity.', keywords: ['model preview'] }
const briefing = { summary: 'A supported announcement.', opportunities: [topic], unknowns: ['Independent results'], evidence: [source], researchedAt: new Date().toISOString(), searchQueries: ['model preview'], searchEntryPoint: '', methodology: 'Qualitative research' }

test('daily research processes only opted-in niches once per day and preserves failures', async () => {
  const repository = createRepository(':memory:')
  try {
    const niche = { name: 'Science', brief: 'Explain useful science developments for readers.', autoRefresh: true }
    await repository.studioPut('alice', 'niche', randomUUID(), { ...niche, autoRefresh: false })
    assert.equal((await refreshNextNiche(repository)).status, 'idle')
    const saved = await repository.studioPut('alice', 'niche', randomUUID(), niche)
    let calls = 0
    const research = async () => { calls++; return briefing }
    assert.equal((await refreshNextNiche(repository, research)).status, 'completed')
    assert.equal((await refreshNextNiche(repository, research)).status, 'idle'); assert.equal(calls, 1)
    assert.equal(repository.studioList('alice', 'research')[0].nicheId, saved.id)
    await repository.studioPut('bob', 'niche', randomUUID(), niche)
    assert.equal((await refreshNextNiche(repository, async () => { throw new Error('offline') })).status, 'failed')
    assert.equal(repository.studioList('bob', 'research_schedule')[0].status, 'failed')
    assert.equal((await refreshNextNiche(repository, research)).status, 'idle')
  } finally { repository.close() }
})

test('grounding rejects unsupported/unsafe links and report references cannot be invented', () => {
  assert.deepEqual(groundedSources({ groundingChunks: [{ web: { uri: 'https://example.com' } }] }), [])
  assert.deepEqual(groundedSources({ groundingChunks: [{ web: { uri: 'javascript:alert(1)' } }], groundingSupports: [{ segment: { text: source.excerpt }, groundingChunkIndices: [0] }] }), [])
  const evidence = groundedSources({ groundingChunks: [{ web: { uri: source.url, title: source.title } }], groundingSupports: [{ segment: { text: source.excerpt }, groundingChunkIndices: [0] }] })
  assert.equal(evidence[0].type, 'search-grounded-summary')
  assert.equal(validateIntelligence({ summary: briefing.summary, opportunities: [topic], unknowns: [] }, evidence).opportunities.length, 1)
  assert.throws(() => validateIntelligence({ summary: briefing.summary, opportunities: [{ ...topic, evidenceIds: ['E99'] }], unknowns: [] }, evidence))
  assert.throws(() => validateIntelligence({ summary: briefing.summary, opportunities: [{ ...topic, audienceReaction: { ...topic.audienceReaction, status: 'observed-positive' } }], unknowns: [] }, evidence))
  assert.throws(() => validateIntelligence({ summary: briefing.summary, opportunities: [{ ...topic, eventDate: '2026-02-31' }], unknowns: [] }, evidence))
})

test('niche research is private, idempotent, preserves old reports on failure and flows into generation', async () => {
  const repository = createRepository(':memory:'); const app = express(); app.use(express.json())
  const auth = (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization, role: 'user' }; next() }
  let calls = 0; let fail = false; let context
  app.use('/api/studio/intelligence', intelligenceRouter({ repository, auth, research: async () => { calls++; if (fail) throw new Error('No grounding'); return briefing } }))
  const content = { hooks: ['A preview [C1]'], script: 'A preview [C1]', scenes: [{ timing: '0–15s', narration: 'A preview [C1]', onScreen: 'Preview', visualPrompt: 'Abstract illustration', voiceDirection: 'Calm' }], captions: { reel: 'A preview [C1]', linkedin: 'A preview [C1]' }, website: { title: 'Preview', body: 'A preview [C1]' }, claims: [{ id: 'C1', text: 'A preview', evidenceId: 'E1', quote: 'The publisher announced a model preview', status: 'attributed' }] }
  app.use('/api/studio', studioRouter({ repository, auth, generate: async (_evidence, _settings, supplied) => { context = supplied; return content } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const request = (path, body, uid = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/api/studio${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: uid }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    const saved = await (await request('/intelligence/niches', { niche: { name: 'Science', brief: 'Explain new science developments for curious readers.' } })).json()
    const input = { nicheId: saved.id, requestId: randomUUID() }
    assert.equal((await request('/intelligence/research', input, 'bob')).status, 404)
    const result = await request('/intelligence/research', input); assert.equal(result.status, 201)
    const report = await result.json()
    assert.equal((await request('/intelligence/research', input)).status, 200); assert.equal(calls, 1)
    assert.deepEqual((await (await request('/intelligence', undefined, 'bob')).json()).reports, [])
    const packInput = { researchId: report.id, opportunityIndex: 0, requestId: randomUUID() }
    assert.equal((await request('/packages', packInput, 'bob')).status, 404)
    const pack = await (await request('/packages', packInput)).json()
    assert.equal(pack.settings.industry, 'Science'); assert.equal(pack.settings.voice, 'Auto')
    const generated = await (await request(`/packages/${pack.id}/generate`, { requestId: randomUUID(), instruction: 'Use a practical angle.' })).json()
    assert.equal(generated.status, 'completed'); assert.equal(context.revisionInstruction, 'Use a practical angle.')
    assert.equal(context.opportunity.title, topic.title); assert.deepEqual(reviewContent(generated.content, pack.evidence).issues, [])
    fail = true
    assert.equal((await request('/intelligence/research', { ...input, requestId: randomUUID() })).status, 502)
    assert.equal((await (await request('/intelligence')).json()).reports.length, 1)
    const detail = `/intelligence/reports/${report.id}`
    assert.equal((await request(detail, undefined, 'bob')).status, 404)
    assert.equal((await (await request(detail)).json()).evidence[0].excerpt, source.excerpt)
    for (let i = 0; i < 24; i++) repository.studioPut('alice', 'research', `history-${i}`, { ...briefing, nicheId: saved.id })
    const page = await (await request('/intelligence')).json()
    assert.equal(page.reports.length, 20); assert.ok(page.nextCursor)
    assert.equal(page.reports[0].evidence, undefined); assert.equal(page.reports[0].opportunities, undefined)
    const older = await (await request(`/intelligence/reports?${new URLSearchParams(page.nextCursor)}`)).json()
    assert.equal(older.reports.length, 5); assert.equal(older.nextCursor, null)
    assert.equal(new Set([...page.reports, ...older.reports].map(item => item.id)).size, 25)
    assert.equal((await request('/intelligence/reports?before=invalid')).status, 400)
    assert.equal(await repository.acquireLease('research:alice', 'check', 1000), true)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
