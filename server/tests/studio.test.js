import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'
import { safeSourceUrl, publicAddress } from '../studio/evidence.js'
import { reviewContent, settingsSchema } from '../studio/content.js'
import { generateContent } from './helpers/passage-model.js'

const excerpt = 'The publisher announced a new model with support for text and image inputs. Availability remains limited to the preview programme.'
const content = { hooks: ['A model update [C1]'], script: 'The publisher announced a model [C1].', scenes: [{ timing: '0–30s', narration: 'The publisher announced a model [C1].', onScreen: 'Model update', visualPrompt: 'Abstract illustration', voiceDirection: 'Clear' }], captions: { reel: 'Model update [C1]', linkedin: 'Model update [C1]' }, website: { title: 'Model update', body: 'The publisher announced a model [C1].' }, claims: [{ id: 'C1', text: 'A model was announced', evidenceId: 'E1', quote: excerpt, status: 'attributed' }] }

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
  const staleScenes = structuredClone(content); staleScenes.script = 'The publisher announced a model with limited availability [C1].'
  assert.ok(reviewContent(staleScenes, evidence).issues.some(issue => issue.includes('Scene narration')))
})

function withPlatforms(selected) {
  const value = structuredClone(content)
  value.strategy = {
    angle: 'An attributed update', audience: 'Readers', whyNow: 'Recent source', factCheck: 'Independent review required',
    language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Creative preference', delivery: 'Clear', keywords: ['model'],
    platforms: selected.map(platform => ({ platform, headline: 'Model update [C1]', hook: 'Model update [C1]', body: 'Model update [C1]', cta: 'Read the evidence', hashtags: ['model'], thumbnail: 'Illustrative model graphic', format: 'Post', retentionPlan: 'Explain the update', alternativeHook: 'Publisher update [C1]', testPlan: 'Compare observed engagement' })),
    production: { videoPrompt: 'Illustration', audioPrompt: 'Clear narration', musicDirection: 'None', subtitleStyle: 'Readable', editingNotes: 'Use sources' },
    experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Observed engagement', decisionRule: 'Compare after equal exposure' }],
  }
  return value
}

test('selected platforms accept all five destinations and reject unknown or duplicate preferences', () => {
  assert.equal(settingsSchema.parse({ platform: 'Facebook, X' }).platform, 'Facebook, X')
  assert.equal(settingsSchema.parse({ platform: 'Reels' }).platform, 'Reels')
  for (const platform of ['TikTok', 'Instagram, Instagram', 'Facebook,', '']) assert.equal(settingsSchema.safeParse({ platform }).success, false)
  const evidence = [{ id: 'E1', excerpt }]
  assert.deepEqual(reviewContent(withPlatforms(['Facebook', 'X']), evidence, { platform: 'Facebook, X' }).issues, [])
  assert.ok(reviewContent(withPlatforms(['Instagram']), evidence, { platform: 'Facebook' }).issues.some(issue => issue.includes('selected platforms')))
  assert.ok(reviewContent(withPlatforms(['X', 'X']), evidence).issues.some(issue => issue.includes('one adaptation')))
})

test('generation enforces selected platforms without accepting an unwanted adaptation', async () => {
  const evidence = [{ id: 'E1', excerpt }]
  let calls = 0
  const generated = await generateContent(evidence, { platform: 'Facebook, X' }, {}, async request => {
    calls++
    assert.match(request.system, /selected platform \(Facebook, X\)/)
    return withPlatforms(calls === 1 ? ['Instagram'] : ['Facebook', 'X'])
  })
  assert.equal(calls, 2)
  assert.deepEqual(generated.strategy.platforms.map(value => value.platform), ['Facebook', 'X'])
  await assert.rejects(generateContent(evidence, { platform: 'X' }, {}, async () => withPlatforms(['Instagram'])), { code: 'EVIDENCE_VALIDATION' })
})

test('generation requests only selected output formats and validates their dependencies', async () => {
  const evidence = [{ id: 'E1', excerpt }]
  const platformContent = withPlatforms(['X'])
  const { production, ...strategy } = platformContent.strategy
  assert.ok(production)
  const onlyPlatforms = { claims: platformContent.claims, strategy }
  const result = await generateContent(evidence, { platform: 'X', outputs: ['platforms'] }, {}, async request => {
    assert.deepEqual(Object.keys(request.schema.properties).sort(), ['claims', 'strategy'])
    assert.equal(request.schema.properties.strategy.properties.production, undefined)
    assert.doesNotMatch(request.system, /Provide hooks and a duration-appropriate script/)
    return onlyPlatforms
  })
  assert.deepEqual(result, onlyPlatforms)
  assert.deepEqual(reviewContent(result, evidence, { platform: 'X', outputs: ['platforms'] }).issues, [])
  assert.ok(reviewContent({ ...result, script: content.script }, evidence, { platform: 'X', outputs: ['platforms'] }).issues.some(issue => issue.includes('selected output formats')))
  const scriptOnly = { script: content.script, hooks: content.hooks, claims: content.claims }
  assert.deepEqual(await generateContent(evidence, { outputs: ['script'] }, {}, async request => { assert.deepEqual(Object.keys(request.schema.properties).sort(), ['claims', 'hooks', 'script']); return scriptOnly }), scriptOnly)
  const captionsOnly = { captions: content.captions, claims: content.claims }
  assert.deepEqual(await generateContent(evidence, { outputs: ['captions'] }, {}, async () => captionsOnly), captionsOnly)
  for (const outputs of [[], ['production'], ['script', 'script'], ['unknown']]) assert.equal(settingsSchema.safeParse({ outputs }).success, false)
  assert.ok(reviewContent({ claims: content.claims }, evidence, { outputs: ['script'] }).issues.length)
})

test('studio preserves generation checks and lets the author confirm valid saved content without another reviewer', async () => {
  const repository = createRepository(':memory:')
  const app = express(); app.use(express.json())
  let admin = false
  const auth = (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization, role: admin ? 'admin' : 'user' }; next() }
  let calls = 0; let sourceHash = 'original'
  const generatedContent = withPlatforms(['Instagram'])
  app.use('/api/studio', studioRouter({ repository, dispatchMode: 'inline', auth, generate: async () => { calls++; return generatedContent }, fetchSource: async () => ({ id: 'E1', title: 'Example', url: 'https://example.com', excerpt, hash: sourceHash, limitations: [] }) }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/api/studio`
  const call = (path, method = 'GET', body, owner = 'alice') => fetch(base + path, { method, headers: { Authorization: owner, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  try {
    await repository.studioPut('alice', 'library_source', 'rejected', { evidence: { id: 'E1', excerpt }, reviewStatus: 'rejected' })
    assert.equal((await call('/packages', 'POST', { sourceIds: ['rejected'], requestId: 'rejected-1234' })).status, 422)
    const created = await call('/packages', 'POST', { sourceUrl: 'https://example.com', requestId: 'create-1234' }); assert.equal(created.status, 201)
    const draft = await created.json()
    assert.equal((await call(`/packages/${draft.id}`, 'GET', undefined, 'bob')).status, 404)
    assert.equal((await call(`/packages/${draft.id}/generate`, 'POST', { requestId: 'unconfirmed-1234' })).status, 400)
    const request = { requestId: 'generate-1234', revision: draft.revision, confirmed: true }
    const response = await call(`/packages/${draft.id}/generate`, 'POST', request); assert.equal(response.status, 200)
    const generated = await response.json(); assert.equal(generated.status, 'completed'); assert.equal(generated.editorialStatus, 'needs_review')
    await call(`/packages/${draft.id}/generate`, 'POST', request); assert.equal(calls, 1)
    assert.equal((await call(`/packages/${draft.id}`, 'PATCH', { revision: draft.revision, content: generatedContent })).status, 409)
    assert.equal((await call(`/packages/${draft.id}`, 'PATCH', { revision: generated.revision, content: generatedContent, editorialStatus: 'approved' })).status, 422)
    const confirmed = await call(`/packages/${draft.id}`, 'PATCH', { revision: generated.revision, editorialStatus: 'approved' })
    assert.equal(confirmed.status, 200)
    const ready = await confirmed.json()
    assert.equal(ready.approval.method, 'creator-confirmed')
    assert.equal(ready.approval.approvedBy, 'alice')
    assert.equal(ready.independentReview ?? null, null)
    const authorExport = await (await call(`/packages/${draft.id}/export`)).json()
    assert.equal(authorExport.manifest.approvalMethod, 'creator-confirmed')
    assert.equal(authorExport.manifest.reviewerId, undefined)
    const reset = await (await call(`/packages/${draft.id}`, 'PATCH', { revision: ready.revision, editorialStatus: 'needs_review' })).json()
    generated.revision = reset.revision
    assert.equal((await call(`/packages/${draft.id}/export`)).status, 409)
    assert.equal((await call(`/packages/${draft.id}/assign-reviewer`, 'POST', { revision: generated.revision, reviewerId: 'alice' })).status, 422)
    const assigned = await (await call(`/packages/${draft.id}/assign-reviewer`, 'POST', { revision: generated.revision, reviewerId: 'bob' })).json()
    assert.equal((await call(`/reviews/alice/${draft.id}`, 'GET', undefined, 'charlie')).status, 404)
    assert.equal((await call(`/reviews/alice/${draft.id}`, 'GET', undefined, 'bob')).status, 200)
    const reviewBody = { revision: assigned.revision, claims: [{ id: 'C1', supported: true, note: 'The captured publisher passage supports the attributed announcement.' }], rightsConfirmed: true, promiseAligned: true, freshnessConfirmed: true, contradictionsResolved: true }
    assert.equal((await call(`/reviews/alice/${draft.id}`, 'POST', reviewBody)).status, 404)
    assert.equal((await call(`/reviews/alice/${draft.id}`, 'POST', { ...reviewBody, claims: [...reviewBody.claims, ...reviewBody.claims] }, 'bob')).status, 422)
    assert.equal((await call(`/reviews/alice/${draft.id}`, 'POST', { ...reviewBody, revision: assigned.revision - 1 }, 'bob')).status, 409)
    const reviewedResponse = await call(`/reviews/alice/${draft.id}`, 'POST', reviewBody, 'bob'); assert.equal(reviewedResponse.status, 200)
    const reviewed = await reviewedResponse.json()
    assert.equal((await call(`/packages/${draft.id}`, 'PATCH', { revision: reviewed.revision, editorialStatus: 'approved' })).status, 200)
    const exportedResponse = await call(`/packages/${draft.id}/export`); assert.equal(exportedResponse.status, 200)
    const exported = await exportedResponse.json(); assert.equal(exported.manifest.approvedBy, 'alice'); assert.equal(exported.manifest.reviewerId, undefined); assert.equal(exported.package.editorialStatus, 'approved')
    assert.ok(exported.manifest.contentHash)
    assert.equal((await call(`/packages/${draft.id}/publish`, 'POST', {})).status, 403)
    admin = true
    assert.equal((await call(`/packages/${draft.id}/publish`, 'POST', {})).status, 503)
    sourceHash = 'changed'
    const refreshed = await (await call(`/packages/${draft.id}/refresh-evidence`, 'POST', { confirmed: true })).json()
    assert.equal(refreshed.editorialStatus, 'needs_review')
    assert.equal((await call(`/packages/${draft.id}/export`)).status, 409)
    const history = await (await call(`/packages/${draft.id}/history`)).json(); assert.ok(history.revisions.length >= 3)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
