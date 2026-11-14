import { runContentJob } from '../studio/job-worker.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { groundedSources, groundedResearchOpeners, intelligenceRouter, validateIntelligence, refreshNextNiche, researchNiche, createResearch, refreshAvailableAt, nicheSchema, researchCollections } from '../studio/intelligence.js'
import { studioRouter } from '../studio/routes.js'
import { reviewContent } from '../studio/content.js'
import { env } from '../config/env.js'

const source = { id: 'E1', url: 'https://example.com/release', title: 'Announcement', publisher: 'example.com', excerpt: 'The publisher announced a model preview with limited availability. Independent capability testing has not yet been published.', hash: 'test', limitations: ['Publisher claim only'], type: 'retrieved-source', retrievedAt: new Date().toISOString() }
const topic = { title: 'A model preview', whatChanged: 'A preview was announced.', eventDate: null, verification: 'reported', whyItMatters: 'Developers can evaluate availability.', evidenceIds: ['E1'], positive: [{ text: 'Preview access', evidenceIds: ['E1'] }], negative: [], audienceReaction: { status: 'insufficient-evidence', summary: 'No audience sample.', evidenceIds: [], limitations: 'No representative discussion data.' }, angle: 'Explain what preview means.', hook: 'Preview does not mean proven.', counterpoint: 'Independent testing is missing.', opportunityReason: 'Useful context, not measured popularity.', keywords: ['model preview'] }
const briefing = { summary: 'A supported announcement.', opportunities: [topic], unknowns: ['Independent results'], evidence: [source], researchedAt: new Date(Date.now() - 86400000).toISOString(), searchQueries: ['model preview'], searchEntryPoint: '', methodology: 'Qualitative research' }

test('library batches only current reports with bounded reads and reuses current category metadata', async () => {
  let active = 0, peak = 0, reads = 0
  const states = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, ...(i < 8 ? { reportId: `r${i}` } : {}) }))
  const niches = states.map(state => ({ id: state.id, name: `Current ${state.id}`, refreshIntervalDays: 7 }))
  const repository = {
    studioList: async () => { throw new Error('The route already loaded these records') },
    studioGet: async (uid, kind, id) => {
      assert.equal(uid, 'alice'); assert.equal(kind, 'research'); reads++; peak = Math.max(peak, ++active)
      await new Promise(resolve => setImmediate(resolve)); active--
      return { ...briefing, id, niche: { name: 'Old name' } }
    },
  }
  const result = await researchCollections(repository, 'alice', states, niches)
  assert.equal(result.length, 8); assert.equal(reads, 8); assert.equal(peak, 4)
  assert.equal(result[0].niche.name, 'Current n0'); assert.equal(result[0].topicCount, 1)
  assert.equal(result[0].refreshAvailableAt, new Date(Date.parse(briefing.researchedAt) + 7 * 86400000).toISOString())
})

test('persisted opaque category GUIDs support settings, image lookup and refresh while request UUIDs and owner scope remain strict', async () => {
  const repository = createRepository(':memory:'); const app = express(); app.use(express.json())
  const id = 'a06bb613-1bf3-11d0-3ee8-42a8309f8afc'
  const fields = nicheSchema.parse({ name: 'AI for LinkedIn', brief: 'Explain verified AI developments for professionals.' })
  const niche = repository.studioPut('alice', 'niche', id, fields, 0)
  let imageCalls = 0; let dispatches = 0
  const auth = (req, _res, next) => { req.identity = { uid: req.headers.authorization, role: 'user' }; next() }
  app.use('/intelligence', intelligenceRouter({ repository, auth, research: async () => briefing, imageSearch: async () => { imageCalls++; return null }, onResearchAdmitted: () => { dispatches++ } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const call = (path, body, uid = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/intelligence${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: uid, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    const saved = await call('/niches', { id, revision: niche.revision, niche: fields })
    assert.equal(saved.status, 200); assert.equal((await saved.json()).id, id)
    assert.equal((await call(`/niches/${id}/image`)).status, 200); assert.equal(imageCalls, 1)
    assert.equal((await call(`/niches/${id}/image`, undefined, 'bob')).status, 404)
    const command = { nicheId: id, nicheRevision: niche.revision, requestId: randomUUID(), confirmed: true, refresh: true }
    assert.equal((await call('/research', command, 'bob')).status, 404)
    assert.equal((await call('/research', { ...command, nicheId: '../injected' })).status, 400)
    assert.equal((await call('/research', { ...command, requestId: id })).status, 400)
    assert.equal((await call('/niches', { id: '../injected', revision: 1, niche: fields })).status, 400)
    assert.equal((await call('/niches/not-a-guid/image')).status, 400)
    const refreshed = await call('/research', command)
    assert.equal(refreshed.status, 202)
    assert.equal((await refreshed.json()).nicheId, id)
    assert.equal(repository.studioJobGet('alice', command.requestId).scope.nicheId, id)
    assert.equal(repository.studioJobGet('bob', command.requestId), null)
    assert.equal(dispatches, 1)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('approved research fallback preserves sources after a free-provider authentication failure and remains bounded', async () => {
  let freeCalls = 0; let fallbackCalls = 0
  const read = async () => [{ url: source.url, title: source.title, excerpt: source.excerpt, publishedAt: new Date().toISOString() }]
  const generate = async () => { freeCalls++; throw Object.assign(new Error('Expired free key'), { code: 'MODEL_HTTP_ERROR', status: 401 }) }
  const fallback = async (_request, attempt) => { fallbackCalls++; assert.equal(attempt, 1); return { summary: briefing.summary, opportunities: [topic], unknowns: [] } }
  const result = await researchNiche({ name: 'Science', windowDays: 7 }, { read, generate, fallback })
  assert.equal(freeCalls, 1); assert.equal(fallbackCalls, 1)
  assert.equal(result.opportunities.length, 1)
  assert.equal(result.evidence[0].excerpt, source.excerpt)
  await assert.rejects(researchNiche({ name: 'Science', windowDays: 7 }, { read, generate }), error => error.status === 401)
  await assert.rejects(researchNiche({ name: 'Science', windowDays: 7 }, { read, generate, fallback: async () => { throw Object.assign(new Error('Unknown fallback outcome'), { code: 'VERTEX_REQUEST_FAILED' }) } }), error => error.code === 'VERTEX_REQUEST_FAILED')
})

test('manual research admits approved fallback while scheduled and expired approvals stay free-only', async () => {
  const keys = ['CONTENT_VERTEX_FALLBACK', 'VERTEX_FALLBACK_MODEL', 'VERTEX_FALLBACK_PROJECT', 'VERTEX_FALLBACK_CREDENTIALS', 'VERTEX_FALLBACK_APPROVED_UNTIL']
  const previous = Object.fromEntries(keys.map(key => [key, env[key]]))
  const repository = createRepository(':memory:')
  try {
    Object.assign(env, { CONTENT_VERTEX_FALLBACK: 'true', VERTEX_FALLBACK_MODEL: 'gemini-3.8-flash', VERTEX_FALLBACK_PROJECT: 'test', VERTEX_FALLBACK_CREDENTIALS: 'test-only.json', VERTEX_FALLBACK_APPROVED_UNTIL: new Date(Date.now() + 60000).toISOString() })
    for (const [uid, automatic, expired, freeOnly] of [['manual', false, false, false], ['scheduled', true, false, true], ['expired', false, true, true]]) {
      if (expired) env.VERTEX_FALLBACK_APPROVED_UNTIL = new Date(Date.now() - 1000).toISOString()
      const niche = repository.studioPut(uid, 'niche', randomUUID(), { name: 'Science', brief: 'Explain science developments.' })
      const result = await createResearch({ repository, uid, niche, requestId: randomUUID(), automatic, research: async () => briefing })
      assert.equal(repository.studioJobGet(uid, result.jobId).scope.freeOnly, freeOnly)
    }
  } finally { Object.assign(env, previous); repository.close() }
})

test('research openers remove invented hook claims and performance promises without altering evidence or editorial angle', () => {
  const input = { ...briefing, opportunities: [{ ...topic, hook: '10,000 lighthouse keeper stories prove 2,000-year-old logic!', opportunityReason: 'Guaranteed viral engagement and millions of views.' }] }
  const snapshot = structuredClone(input)
  const result = groundedResearchOpeners(input)
  assert.deepEqual(input, snapshot)
  assert.equal(result.opportunities[0].hook, `What should readers know about “${topic.title}”?`)
  assert.match(result.opportunities[0].opportunityReason, /have not been measured/)
  assert.doesNotMatch(JSON.stringify(result), /10,000|2,000-year-old|Guaranteed viral|millions of views/)
  const before = { ...input.opportunities[0] }; delete before.hook; delete before.opportunityReason
  const after = { ...result.opportunities[0] }; delete after.hook; delete after.opportunityReason
  assert.deepEqual(after, before)
  assert.deepEqual(result.evidence, input.evidence)
  assert.equal(result.summary, input.summary)
  assert.deepEqual(groundedResearchOpeners({ ...briefing, opportunities: [] }).opportunities, [])
})

test('research correction is bounded, reauthorizes each model call, and never retries transport failures', async () => {
  const niche = { name: 'Science', windowDays: 7 }
  const read = async () => [{ url: source.url, title: source.title, excerpt: source.excerpt, publishedAt: new Date().toISOString() }]
  for (const kind of ['json', 'schema', 'null', 'evidence']) {
    let calls = 0; let checks = 0
    const result = await researchNiche(niche, { read, beforeAttempt: async () => { checks++ }, generate: async request => {
      calls++
      assert.equal(checks, calls + 1) // Feed retrieval is also authorized.
      if (calls === 1) {
        if (kind === 'json') throw Object.assign(new SyntaxError('private output'), { code: 'MODEL_JSON_INVALID' })
        if (kind === 'null') return null
        if (kind === 'schema') return { summary: 'Bad shape', opportunities: 'private wrong value', unknowns: [] }
        return { ...briefing, opportunities: [{ ...topic, evidenceIds: ['NOT_SUPPLIED'] }] }
      }
      assert.ok(request.input.corrections.length)
      assert.equal(JSON.stringify(request.input.corrections).includes('private'), false)
      return briefing
    } })
    assert.equal(calls, 2); assert.equal(result.opportunities.length, 1)
  }
  let calls = 0
  await assert.rejects(researchNiche(niche, { read, generate: async () => { calls++; return { summary: 'Invalid' } } }))
  assert.equal(calls, 2)
  for (const error of [Object.assign(new Error('timeout'), { code: 'MODEL_TIMEOUT' }), Object.assign(new Error('HTTP'), { code: 'MODEL_HTTP_ERROR', status: 429 }), new SyntaxError('Transport JSON envelope'), Object.assign(new Error('incomplete'), { code: 'MODEL_INCOMPLETE' })]) {
    calls = 0
    await assert.rejects(researchNiche(niche, { read, generate: async () => { calls++; throw error } }), value => value === error)
    assert.equal(calls, 1)
  }
  let checks = 0; calls = 0
  await assert.rejects(researchNiche(niche, { read, beforeAttempt: async () => { if (++checks === 3) throw Object.assign(new Error('Revoked before correction'), { code: 'JOB_BLOCKED' }) }, generate: async () => { calls++; return { summary: 'Invalid' } } }), { code: 'JOB_BLOCKED' })
  assert.equal(calls, 1)
})

test('research default allowance remains ten shared attempts and does not notify at exhaustion', async () => {
  assert.equal(env.STUDIO_DAILY_GENERATIONS, 10)
  const repository = createRepository(':memory:')
  try {
    for (let i = 0; i < 10; i++) repository.studioJobReserve('quota-owner', `generation-${i}`, 'a'.repeat(64), 10, { operation: 'generation' })
    const niche = repository.studioPut('quota-owner', 'niche', randomUUID(), { name: 'Science', brief: 'Explain science developments.' })
    let notifications = 0
    await assert.rejects(createResearch({ repository, uid: 'quota-owner', niche, requestId: randomUUID(), research: async () => briefing, onResearchAdmitted: () => { notifications++ } }), { code: 'STUDIO_QUOTA', preDispatch: true })
    assert.equal(notifications, 0)
  } finally { repository.close() }
})

test('manual refresh overrides the interval while saved reuse uses no additional calls', async () => {
  assert.equal(refreshAvailableAt({ researchedAt: '2026-10-25T18:29:59Z' }), '2026-10-25T18:30:00.000Z')
  assert.equal(refreshAvailableAt({ researchedAt: '2026-10-25T18:30:00Z' }), '2026-10-26T18:30:00.000Z')
  const repository = createRepository(':memory:'); const uid = `ws:${randomUUID()}`
  try {
    repository.studioPut('__workspace_control__', 'workspace', uid, { members: [{ uid: 'alice', role: 'owner' }, { uid: 'bob', role: 'editor' }] }, 0)
    const niche = repository.studioPut(uid, 'niche', randomUUID(), { name: 'AI', brief: 'Explain recent AI developments for readers.' }, 0)
    let calls = 0
    const research = async () => { calls++; return { ...briefing, researchedAt: new Date().toISOString() } }
    const options = { repository, uid, niche, actorUid: 'alice', research, dispatchMode: 'inline' }
    const first = await createResearch({ ...options, requestId: randomUUID() })
    const cached = await createResearch({ ...options, actorUid: 'bob', requestId: randomUUID() })
    assert.equal(cached.id, first.id)
    await createResearch({ ...options, actorUid: 'bob', requestId: randomUUID(), refresh: true })
    assert.equal(calls, 2)
    const changed = repository.studioPut(uid, 'niche', niche.id, { ...niche, audience: 'Business owners' }, niche.revision)
    await createResearch({ ...options, niche: changed, requestId: randomUUID(), refresh: true })
    assert.equal(calls, 3)
  } finally { repository.close() }
})

test('ten-card shared collection is reused across members, explicit refresh costs one call, and private scopes stay isolated', async () => {
  const repository = createRepository(':memory:'); const app = express(); app.use(express.json())
  const workspace = `ws:${randomUUID()}`
  await repository.studioPut('__workspace_control__', 'workspace', workspace, { members: [{ uid: 'alice', role: 'owner' }, { uid: 'bob', role: 'editor' }, { uid: 'reader', role: 'viewer' }] }, 0)
  const auth = (req, _res, next) => { req.identity = { uid: req.headers.authorization, role: 'user' }; next() }
  let calls = 0
  const ten = { ...briefing, opportunities: Array.from({ length: 10 }, (_, i) => ({ ...topic, title: `Distinct announcement ${i + 1}` })) }
  app.use('/intelligence', intelligenceRouter({ repository, auth, dispatchMode: 'inline', research: async () => { calls++; return ten } }))
  app.use('/studio', studioRouter({ repository, auth }))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const call = (path, body, uid = 'alice', scope = workspace) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: uid, 'content-type': 'application/json', 'x-workspace-id': scope }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    const niche = { name: 'AI', brief: 'Explain recent AI announcements for readers.' }
    const saved = await repository.studioPut(workspace, 'niche', randomUUID(), nicheSchema.parse(niche), 0)
    const same = await (await call('/intelligence/niches', { niche: { ...niche, name: ' ai ' } }, 'bob')).json()
    assert.equal(same.id, saved.id)
    const command = { nicheId: saved.id, nicheRevision: saved.revision, requestId: randomUUID(), confirmed: true }
    const first = await (await call('/intelligence/research', command)).json()
    assert.equal(first.opportunities.length, 10); assert.equal(calls, 1)
    const reused = await (await call('/intelligence/research', { ...command, requestId: randomUUID() }, 'bob')).json()
    assert.equal(reused.id, first.id); assert.equal(reused.reused, true); assert.equal(calls, 1)
    const library = await (await call('/intelligence', undefined, 'reader')).json()
    assert.equal(library.collections.length, 1); assert.equal(library.collections[0].topicCount, 10)
    assert.equal((await call(`/intelligence/reports/${first.id}`, undefined, 'reader')).status, 200)
    assert.equal((await call('/intelligence/research', { ...command, requestId: randomUUID() }, 'reader')).status, 403)
    assert.equal((await call('/intelligence', undefined, 'outsider')).status, 403)
    assert.equal((await call(`/intelligence/reports/${first.id}`, undefined, 'bob', 'personal')).status, 404)
    assert.equal((await (await call('/intelligence', undefined, 'bob', 'personal')).json()).collections.length, 0)
    const draft = await call('/studio/packages', { researchId: first.id, opportunityIndex: 9, requestId: randomUUID() }, 'bob')
    assert.equal(draft.status, 201); assert.equal(calls, 1)
    const refreshed = await (await call('/intelligence/research', { ...command, requestId: randomUUID(), refresh: true }, 'bob')).json()
    assert.notEqual(refreshed.id, first.id); assert.equal(calls, 2)
    assert.equal((await (await call('/intelligence')).json()).collections.length, 1)
    assert.equal((await call(`/intelligence/reports/${first.id}`)).status, 200)
    const different = await repository.studioPut(workspace, 'niche', randomUUID(), nicheSchema.parse({ ...niche, audience: 'Doctors' }), 0)
    assert.notEqual(different.id, saved.id)
    const control = repository.studioGet('__workspace_control__', 'workspace', workspace)
    repository.studioPut('__workspace_control__', 'workspace', workspace, { ...control, members: control.members.filter(member => member.uid !== 'bob') }, control.revision)
    assert.equal((await call(`/intelligence/reports/${first.id}`, undefined, 'bob')).status, 403)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('research accepts ten distinct sourced cards but rejects duplicates and unsupported citations', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...topic, title: `Announcement ${i}` }))
  assert.equal(validateIntelligence({ ...briefing, opportunities: ten }, [source]).opportunities.length, 10)
  assert.throws(() => validateIntelligence({ ...briefing, opportunities: [...ten, { ...ten[0], title: ' announcement 0 ' }] }, [source]), /duplicate/)
  assert.throws(() => validateIntelligence({ ...briefing, opportunities: [{ ...ten[9], evidenceIds: ['E404'] }] }, [source]), /unavailable/)
  assert.throws(() => validateIntelligence({ ...briefing, opportunities: Array.from({ length: 13 }, (_, i) => ({ ...topic, title: `Announcement ${i}` })) }, [source]))
})

test('overlapping admissions and duplicate niche IDs share a queued job; refresh retains saved collections', async () => {
  const repository = createRepository(':memory:')
  try {
    const niche = await repository.studioPut('alice', 'niche', randomUUID(), { name: 'Science', brief: 'Explain recent scientific announcements for readers.' }, 0)
    const duplicate = await repository.studioPut('alice', 'niche', randomUUID(), { name: niche.name, brief: niche.brief }, 0)
    const research = async () => briefing
    const attempts = await Promise.allSettled([niche, duplicate].map(value => createResearch({ repository, uid: 'alice', niche: value, requestId: randomUUID(), research })))
    const queued = attempts.find(value => value.status === 'fulfilled').value
    assert.equal(repository.studioPendingJobs(20).length, 1)
    const reused = await createResearch({ repository, uid: 'alice', niche: duplicate, requestId: randomUUID(), research })
    assert.equal(reused.jobId, queued.jobId); assert.equal(reused.reused, true); assert.equal(reused.niche.id, queued.nicheId)
    const { runContentJob, cancelContentJob } = await import('../studio/job-worker.js')
    const done = await runContentJob({ repository, uid: 'alice', requestId: queued.jobId, research })
    assert.equal(done.status, 'completed')
    const actual = repository.studioGet('alice', 'niche', queued.nicheId)
    const refresh = await createResearch({ repository, uid: 'alice', niche: actual, requestId: randomUUID(), refresh: true, research })
    const { researchCollections } = await import('../studio/intelligence.js')
    assert.equal((await researchCollections(repository, 'alice'))[0].reportId, done.result.id)
    await cancelContentJob({ repository, uid: 'alice', requestId: refresh.jobId })
    const cached = await createResearch({ repository, uid: 'alice', niche: actual, requestId: randomUUID(), research })
    assert.equal(cached.id, done.result.id); assert.equal(cached.reused, true)
  } finally { repository.close() }
})

test('automatic research never dispatches even for legacy opted-in niches', async () => {
  const repository = createRepository(':memory:')
  try {
    await repository.studioPut('alice', 'niche', randomUUID(), { name: 'Science', brief: 'Explain useful science developments for readers.', autoRefresh: true })
    let calls = 0
    assert.equal((await refreshNextNiche({ repository, research: async () => { calls++; return briefing } })).status, 'not-due')
    assert.equal(calls, 0)
    assert.equal(repository.studioList('alice', 'research').length, 0)
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
  app.use('/api/studio/intelligence', intelligenceRouter({ repository, dispatchMode: 'inline', auth, research: async () => { calls++; if (fail) throw new Error('No grounding'); return briefing } }))
  const content = { hooks: ['A preview [C1]'], script: 'A preview [C1]', scenes: [{ timing: '0–15s', narration: 'A preview [C1]', onScreen: 'Preview', visualPrompt: 'Abstract illustration', voiceDirection: 'Calm' }], captions: { reel: 'A preview [C1]', linkedin: 'A preview [C1]' }, website: { title: 'Preview', body: 'A preview [C1]' }, claims: [{ id: 'C1', text: 'A preview', evidenceId: 'E1', quote: 'The publisher announced a model preview', status: 'attributed' }] }
  content.strategy = {
    angle: 'Preview context', audience: 'Readers', whyNow: 'Recent announcement', factCheck: 'Independent review required', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Creative preference', delivery: 'Clear', keywords: ['preview'],
    platforms: ['Instagram'].map(platform => ({ platform, headline: 'Preview [C1]', hook: 'Preview [C1]', body: 'Preview [C1]', cta: 'Read the source', hashtags: ['preview'], thumbnail: 'Illustration', format: 'Post', retentionPlan: 'Explain the update', alternativeHook: 'Announcement [C1]', testPlan: 'Compare observed engagement' })),
    production: { videoPrompt: 'Illustration', audioPrompt: 'Clear narration', musicDirection: 'None', subtitleStyle: 'Readable', editingNotes: 'Use sources' }, experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Observed engagement', decisionRule: 'Equal exposure' }],
  }
  app.use('/api/studio', studioRouter({ repository, dispatchMode: 'inline', auth, generate: async (_evidence, _settings, supplied) => { context = supplied; return content } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const request = (path, body, uid = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/api/studio${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: uid }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    const saved = await repository.studioPut('alice', 'niche', randomUUID(), nicheSchema.parse({ name: 'Science', brief: 'Explain new science developments for curious readers.' }), 0)
    const input = { nicheId: saved.id, nicheRevision: saved.revision, confirmed: true, requestId: randomUUID() }
    assert.equal((await request('/intelligence/research', input, 'bob')).status, 404)
    assert.equal((await request('/intelligence/research', { ...input, confirmed: false })).status, 400)
    assert.equal((await request('/intelligence/research', { ...input, nicheRevision: saved.revision + 1 })).status, 409)
    assert.equal(calls, 0)
    assert.equal((await request('/intelligence/niches', { niche: { name: 'Science', brief: 'Explain new science developments for readers.', autoRefresh: true } })).status, 422)
    const unavailable = await repository.studioPut('alice', 'niche', randomUUID(), nicheSchema.parse({ name: 'Science', brief: 'Explain new science developments for readers.', mode: 'trending' }), 0)
    assert.equal((await request('/intelligence/research', { ...input, nicheId: unavailable.id, nicheRevision: unavailable.revision })).status, 422)
    assert.equal(calls, 0)
    const result = await request('/intelligence/research', input); assert.equal(result.status, 201)
    const report = await result.json()
    assert.equal((await request('/intelligence/research', input)).status, 200); assert.equal(calls, 1)
    assert.deepEqual((await (await request('/intelligence', undefined, 'bob')).json()).reports, [])
    const packInput = { researchId: report.id, opportunityIndex: 0, requestId: randomUUID(), settings: { industry: 'Science', voice: 'Auto', platform: 'Instagram', outputs: ['script', 'captions', 'website', 'platforms', 'production'] } }
    assert.equal((await request('/packages', packInput, 'bob')).status, 404)
    const pack = await (await request('/packages', packInput)).json()
    assert.equal(pack.settings.industry, 'Science'); assert.equal(pack.settings.voice, 'Auto')
    const reused = await request('/packages', { ...packInput, reuseExisting: true, requestId: randomUUID() })
    assert.equal(reused.status, 200)
    assert.equal((await reused.json()).id, pack.id)
    assert.equal((await request('/packages', { ...packInput, reuseExisting: true, requestId: randomUUID() }, 'bob')).status, 404)
    const generated = await (await request(`/packages/${pack.id}/generate`, { requestId: randomUUID(), revision: pack.revision, confirmed: true, instruction: 'Use a practical angle.' })).json()
    assert.equal(generated.status, 'completed'); assert.equal(context.revisionInstruction, 'Use a practical angle.')
    assert.equal(context.opportunity.title, topic.title); assert.deepEqual(reviewContent(generated.content, pack.evidence).issues, [])
    fail = true
    assert.equal((await request('/intelligence/research', { ...input, refresh: true, requestId: randomUUID() })).status, 502)
    const callsAfterFailure = calls
    assert.equal((await request('/intelligence/research', { ...input, requestId: randomUUID() })).status, 409)
    assert.equal(calls, callsAfterFailure)
    assert.equal((await (await request('/intelligence')).json()).reports.length, 1)
    const detail = `/intelligence/reports/${report.id}`
    assert.equal((await request(detail, undefined, 'bob')).status, 404)
    const callsBeforeBrowsing = calls
    assert.equal((await (await request(detail)).json()).evidence[0].excerpt, source.excerpt)
    await request(detail); await request('/intelligence')
    assert.equal(calls, callsBeforeBrowsing)
    for (let i = 0; i < 24; i++) repository.studioPut('alice', 'research', `history-${i}`, { ...briefing, nicheId: saved.id })
    const page = await (await request('/intelligence')).json()
    assert.equal(page.reports.length, 20); assert.ok(page.nextCursor)
    assert.equal(page.reports[0].evidence, undefined); assert.equal(page.reports[0].opportunities, undefined)
    const older = await (await request(`/intelligence/reports?${new URLSearchParams(page.nextCursor)}`)).json()
    assert.equal(older.reports.length, 5); assert.equal(older.nextCursor, null)
    assert.equal(new Set([...page.reports, ...older.reports].map(item => item.id)).size, 25)
    assert.equal((await request('/intelligence/reports?before=invalid')).status, 400)
    assert.equal(await repository.acquireLease('research:alice', 'check', 1000), true)
    const newReport = await repository.studioPut('alice', 'research', 'reuse-race', report, 0)
    const simultaneous = await Promise.all([1, 2].map(() => request('/packages', { researchId: newReport.id, opportunityIndex: 0, reuseExisting: true, requestId: randomUUID() })))
    const savedDrafts = await Promise.all(simultaneous.map(response => response.json()))
    assert.equal(savedDrafts[0].id, savedDrafts[1].id)
    assert.deepEqual(savedDrafts[0].evidence, pack.evidence)
    assert.equal(savedDrafts[0].content, null)



  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('news research uses explicit edition and blocks unsupported popularity modes before fetching', async () => {
  let reads = 0
  const options = {
    read: async ({ feedUrl }) => {
      reads++
      const params = new URL(feedUrl).searchParams
      assert.equal(params.get('hl'), 'hi-IN')
      assert.equal(params.get('gl'), 'IN')
      assert.equal(params.get('ceid'), 'IN:hi')
      assert.equal(params.get('q'), 'Gardening when:7d')
      return [{ url: source.url, title: source.title, excerpt: source.excerpt, publishedAt: new Date().toISOString() }]
    },
    generate: async () => ({ summary: 'A sourced gardening briefing.', opportunities: [], unknowns: [] }),
  }
  const niche = { name: 'Gardening', windowDays: 7, sourceLocale: 'hi-IN', mode: 'latest' }
  const result = await researchNiche(niche, options)
  assert.equal(result.sourceLocale, 'hi-IN')
  assert.equal(result.signals.views, 'unavailable')
  assert.equal(result.signals.trending, 'unavailable')
  for (const mode of ['trending', 'most-viewed']) await assert.rejects(researchNiche({ ...niche, mode }, options), { status: 422 })
  assert.equal(reads, 1)
})

test('research retains ambiguous dispatch after report persistence and blocks fresh request identifiers', async () => {
  const repository = createRepository(':memory:')
  try {
    const niche = await repository.studioPut('alice', 'niche', randomUUID(), { name: 'Science', brief: 'Explain useful science developments for readers.' })
    let calls = 0
    let failSettlement = true
    const guarded = { ...repository, studioJobUpdate(...args) {
      if (args[2].status === 'completed' && failSettlement) { failSettlement = false; throw new Error('Storage unavailable after result write') }
      return repository.studioJobUpdate(...args)
    } }
    const requestId = randomUUID()
    const run = nextId => createResearch({ repository: guarded, dispatchMode: 'inline', uid: 'alice', niche, requestId: nextId, research: async () => { calls++; return briefing } })
    await assert.rejects(run(requestId), /reconciliation/)
    assert.equal(repository.studioJobGet('alice', requestId).status, 'dispatch_unknown')
    assert.equal(repository.studioList('alice', 'research').length, 1)
    await assert.rejects(run(requestId), { status: 409 })
    await assert.rejects(run(randomUUID()), { status: 409 })
    assert.equal(calls, 1)
    assert.equal(repository.studioJobGet('bob', requestId), null)
  } finally { repository.close() }
})

test('supplied references are fetched first without crawling and latest sorts cited publication times', async () => {
  const events = []
  const result = await researchNiche({ name: 'Gardening', windowDays: 7, mode: 'latest', sourceLocale: 'en-US', referenceUrls: [source.url, source.url] }, {
    fetchReference: async url => { events.push(url); return { ...source, publishedAt: '2026-10-20T00:00:00Z' } },
    read: async () => { events.push('news'); return [{ url: 'https://example.com/new', title: 'New evidence', excerpt: source.excerpt, publishedAt: '2026-10-24T00:00:00Z' }] },
    generate: async ({ input }) => {
      assert.equal(input.evidence.length, 2)
      assert.equal(input.evidence[0].type, 'retrieved-source')
      assert.match(input.evidence[0].limitations.join(' '), /rights/)
      return { summary: 'Two announcements', opportunities: [{ ...topic, title: 'Older', evidenceIds: ['E1'] }, { ...topic, title: 'Newer', evidenceIds: ['E2'] }], unknowns: [] }
    },
  })
  assert.deepEqual(events, [source.url, 'news'])
  assert.deepEqual(result.opportunities.map(item => item.title), ['Newer', 'Older'])
})

test('unreadable references are explicit, partial evidence continues and empty evidence never invokes a model', async () => {
  let calls = 0
  const niche = { name: 'Science', windowDays: 7, referenceUrls: ['https://example.com/bad', 'https://example.com/good'] }
  const options = { read: async () => [], fetchReference: async url => { if (url.endsWith('bad')) throw new Error('Sensitive upstream detail'); return source }, generate: async request => { calls++; assert.equal(request.input.evidence.length, 1); return { summary: 'Supported evidence only', opportunities: [], unknowns: [] } } }
  const partial = await researchNiche(niche, options)
  assert.equal(calls, 1); assert.equal(partial.evidence.length, 1)
  assert.deepEqual(partial.sourceStates.map(value => value.status), ['unavailable', 'available'])
  assert.equal(partial.sourceStates[0].url, niche.referenceUrls[0])
  assert.ok(!JSON.stringify(partial).includes('Sensitive upstream detail'))
  const empty = await researchNiche({ ...niche, referenceUrls: [niche.referenceUrls[0]] }, options)
  assert.equal(calls, 1); assert.deepEqual(empty.evidence, []); assert.deepEqual(empty.opportunities, [])
  assert.match(empty.summary, /No model synthesis/)
  const blocked = Object.assign(new Error('Authorization revoked'), { code: 'JOB_BLOCKED' })
  await assert.rejects(researchNiche(niche, { ...options, beforeAttempt: async () => { throw blocked } }), error => error === blocked)
  assert.equal(calls, 1)
})


test('opted-in refresh waits seven days, queues free-only once, preserves saved data and respects disabling', async () => {
  const repository = createRepository(':memory:'); const uid = 'alice'; let dispatched = 0
  try {
    let niche = repository.studioPut(uid, 'niche', randomUUID(), { ...nicheSchema.parse({ name: 'AI news', brief: 'Explain practical AI news with source evidence.', autoRefresh: true, refreshIntervalDays: 7 }), autoRefreshConsent: 1, autoRefreshActor: uid }, 0)
    let report = repository.studioPut(uid, 'research', 'saved', { ...briefing, niche, researchedAt: new Date().toISOString() }, 0)
    repository.studioPut(uid, 'research_state', niche.id, { reportId: report.id }, 0)
    const options = { repository, research: async () => briefing, onResearchAdmitted: async () => { dispatched++ } }
    assert.equal((await refreshNextNiche(options)).status, 'not-due')
    assert.equal(dispatched, 0)
    assert.equal(Date.parse(refreshAvailableAt(report, niche)) - Date.parse(report.researchedAt), 7 * 86400000)
    report = repository.studioPut(uid, 'research', report.id, { ...report, researchedAt: new Date(Date.now() - 8 * 86400000).toISOString() }, report.revision)
    assert.equal((await refreshNextNiche(options)).status, 'queued'); assert.equal(dispatched, 1)
    assert.equal((await refreshNextNiche(options)).status, 'not-due'); assert.equal(dispatched, 1)
    const state = repository.studioGet(uid, 'research_state', niche.id)
    assert.equal(state.reportId, report.id)
    const job = repository.studioJobGet(uid, state.jobId)
    assert.equal(job.scope.freeOnly, true); assert.equal(job.scope.automatic, true)
    niche = repository.studioPut(uid, 'niche', niche.id, { ...niche, autoRefresh: false }, niche.revision)
    const outcome = await runContentJob({ repository, uid, requestId: job.id, research: async (_niche, { beforeAttempt }) => { await beforeAttempt(); throw new Error('Must never reach provider after disabling') } })
    assert.equal(outcome.status, 'failed')
    assert.equal(repository.studioGet(uid, 'research_state', niche.id).reportId, report.id)
    assert.equal((await refreshNextNiche(options)).status, 'not-due')
  } finally { repository.close() }
})


test('successful automatic refresh resets the interval and keeps previous snapshots', async () => {
  const repository = createRepository(':memory:'); const uid = 'alice'
  try {
    const niche = repository.studioPut(uid, 'niche', randomUUID(), { ...nicheSchema.parse({ name: 'Science', brief: 'Explain practical science with supporting source evidence.', autoRefresh: true, refreshIntervalDays: 7 }), autoRefreshConsent: 1, autoRefreshActor: uid }, 0)
    const old = repository.studioPut(uid, 'research', 'old', { ...briefing, niche, nicheId: niche.id, researchedAt: new Date(Date.now() - 8 * 86400000).toISOString() }, 0)
    repository.studioPut(uid, 'research_state', niche.id, { reportId: old.id }, 0)
    const research = async () => ({ ...briefing, researchedAt: new Date().toISOString() })
    assert.equal((await refreshNextNiche({ repository, research, dispatchMode: 'inline' })).status, 'completed')
    const state = repository.studioGet(uid, 'research_state', niche.id)
    assert.notEqual(state.reportId, old.id)
    assert.ok(repository.studioGet(uid, 'research', old.id))
    assert.equal((await refreshNextNiche({ repository, research })).status, 'not-due')
  } finally { repository.close() }
})

test('national and combined research use country and topic scope in retrieval and synthesis', async () => {
  const queries = []; let supplied
  await researchNiche({ name: 'AI news', brief: 'Practical developments.', coverage: 'both', country: 'India', topics: ['tools'], intent: 'Help businesses', exclusions: 'Rumours', windowDays: 7 }, {
    read: async ({ feedUrl }) => { queries.push(new URL(feedUrl).searchParams.get('q')); return [{ url: source.url, title: source.title, excerpt: source.excerpt, publishedAt: new Date().toISOString() }] },
    generate: async ({ input }) => { supplied = input; return briefing },
  })
  assert.equal(queries.length, 2); assert.match(queries[1], /India/); assert.match(queries[0], /tools/)
  assert.equal(supplied.niche.intent, 'Help businesses'); assert.equal(supplied.niche.exclusions, 'Rumours')
})


test('failed automatic refresh leaves the last successful collection available', async () => {
  const repository = createRepository(':memory:'); const uid = 'alice'
  try {
    const niche = repository.studioPut(uid, 'niche', randomUUID(), { ...nicheSchema.parse({ name: 'Science', brief: 'Explain practical science from original source evidence.', autoRefresh: true }), autoRefreshConsent: 1, autoRefreshActor: uid }, 0)
    const old = repository.studioPut(uid, 'research', 'old', { ...briefing, niche, researchedAt: new Date(Date.now() - 8 * 86400000).toISOString() }, 0)
    repository.studioPut(uid, 'research_state', niche.id, { reportId: old.id }, 0)
    const result = await refreshNextNiche({ repository, dispatchMode: 'inline', research: async () => { throw Object.assign(new Error('Free provider unavailable'), { code: 'MODEL_HTTP_ERROR', status: 401 }) } })
    assert.equal(result.status, 'blocked')
    assert.equal(repository.studioGet(uid, 'research_state', niche.id).reportId, old.id)
    assert.deepEqual(repository.studioGet(uid, 'research', old.id).opportunities, old.opportunities)
  } finally { repository.close() }
})
