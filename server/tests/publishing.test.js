import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID, createHash } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createPublishingRouter, createPublishingService, approvedCaption } from '../publishing/router.js'
import { createPostizProvider, publishingConfig } from '../publishing/provider.js'
import { buildAssurance } from '../studio/assurance.js'
import { contentHash } from '../studio/approval.js'
import { settingsSchema, reviewContent } from '../studio/content.js'
import { reviewFixture } from './fixtures/finalization.js'
import { mediaManifest } from '../media/acceptance.js'
import { platformSettings, xWeightedLength, renderSocialCaption, socialSourceUrls } from '../publishing/constraints.js'
import { createApp } from '../http/app.js'
import { postizContentMatches } from '../publishing/readback.js'
import { setTimeout as delay } from 'node:timers/promises'

test('saved social preview is owner-scoped, uses exact server captions and current media metadata without release or provider side effects', async () => {
  const repository = createRepository(':memory:'); const selected = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']
  const pack = repository.studioPut('alice', 'package', 'preview-pack', { settings: settingsSchema.parse({ platform: selected.join(', ') }), status: 'completed', content: { claims: [{ id: 'C1', evidenceId: 'E1' }], strategy: { platforms: selected.map(platform => ({ platform, body: `${platform} saved words [C1].` })) } }, evidence: [{ id: 'E1', url: 'https://example.com/original-source' }] }, 0)
  repository.studioPut('alice', 'asset', 'current-image', { packageId: pack.id, packageContentHash: contentHash(pack), kind: 'image', mime: 'image/png', status: 'completed', bytes: 1024, operation: 'private-provider-operation', verification: { status: 'passed', privateNote: 'private reviewer details' } }, 0)
  repository.studioPut('alice', 'asset', 'stale-image', { packageId: pack.id, packageContentHash: 'older-content', kind: 'image', mime: 'image/png', status: 'completed', bytes: 2048 }, 0)
  repository.studioPut('bob', 'asset', 'other-owner-image', { packageId: pack.id, packageContentHash: contentHash(pack), kind: 'image', mime: 'image/png', status: 'completed' }, 0)
  const app = express(); app.use((req, _res, next) => { Object.defineProperty(req, 'query', { configurable: true, value: { __studioPath: 'internal-rewrite', platform: 'invalid-host-cache' } }); next() }); app.use(createPublishingRouter({ repository, auth: (req, res, next) => { if (!req.headers.authorization) return res.status(401).json({ error: 'Sign in' }); req.identity = { uid: req.headers.authorization }; next() }, config: () => ({ enabled: false, accounts: [] }), assessReady: () => assert.fail('Preview must not run release assessments or write machine approvals'), provider: { upload: () => assert.fail('Preview cannot upload'), create: () => assert.fail('Preview cannot post') } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const read = (platform, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/packages/${pack.id}/social-preview?platform=${encodeURIComponent(platform)}`, { headers: actor ? { Authorization: actor } : {} })
  try {
    assert.equal((await read('Instagram', '')).status, 401)
    assert.equal((await read('Instagram', 'bob')).status, 404)
    assert.equal((await read('TikTok')).status, 400)
    for (const query of ['platform=Instagram&platform=Facebook', 'platform=Instagram&unexpected=true']) assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/packages/${pack.id}/social-preview?${query}`, { headers: { Authorization: 'alice' } })).status, 400)
    for (const platform of selected) {
      const response = await read(platform); assert.equal(response.status, 200)
      const preview = await response.json()
      assert.equal(preview.platform, platform); assert.equal(preview.revision, pack.revision)
      assert.equal(preview.contentHash, contentHash(pack)); assert.equal(preview.caption, approvedCaption(pack, platform))
      assert.ok(preview.caption.endsWith('Source: https://example.com/original-source'))
      assert.equal(preview.approval, 'not_assessed')
      assert.equal(preview.assets.find(asset => asset.id === 'current-image').current, true)
      assert.equal(preview.assets.find(asset => asset.id === 'stale-image').current, false)
      assert.equal(preview.assets.some(asset => asset.id === 'other-owner-image'), false)
      assert.equal(JSON.stringify(preview).includes('private-'), false)
      assert.deepEqual(preview.assets.find(asset => asset.id === 'current-image').verification, { status: 'passed' })
    }
    assert.equal(repository.studioList('alice', 'social_publication').length, 0)
    assert.equal(repository.studioGet('alice', 'package', pack.id).revision, pack.revision)
    repository.studioPut('alice', 'package', pack.id, { ...pack, settings: { ...pack.settings, platform: 'LinkedIn' } }, pack.revision)
    assert.equal((await read('X')).status, 422)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('publishing binds exact approved text/assets/account, dispatches once and requires matching provider readback', async () => {
  const repository = createRepository(':memory:')
  const bytes = Buffer.from('controlled publishing fixture bytes')
  const evidence = [{ id: 'E1', url: 'https://example.com/release', hash: 'capture', excerpt: 'The publisher announced a model preview with support for text and image inputs. The preview is available only to existing customers.', retrievedAt: new Date().toISOString() }]
  const content = { captions: { reel: 'The publisher announced a preview [C1].', linkedin: 'The publisher announced a preview [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a preview', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }] }
  let pack = { content, settings: settingsSchema.parse({ outputs: ['captions'], platform: 'LinkedIn' }), evidence, reviewerId: 'bob', createdBy: 'alice', editorialStatus: 'approved', status: 'completed' }
  pack.assurance = buildAssurance(pack, { runId: 'actual-test-validation' }); pack.independentReview = reviewFixture(pack)
  pack.approval = { method: 'independent-human', contentHash: contentHash(pack), approvedBy: 'alice', approvedAt: new Date().toISOString() }
  pack = repository.studioPut('alice', 'package', 'draft', pack, 0)
  const asset = repository.studioPut('alice', 'asset', 'asset-one', { packageId: pack.id, packageContentHash: contentHash(pack), createdBy: 'alice', kind: 'image', status: 'completed', mime: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 0)
  const manifest = mediaManifest(pack, [asset]); const now = Date.now()
  pack = repository.studioPut('alice', 'package', pack.id, { ...pack, mediaReview: { method: 'independent-human', status: 'passed', reviewerId: 'bob', assetIds: [asset.id], manifestHash: manifest.hash, rightsConfirmed: true, consentConfirmed: true, accessibilityConfirmed: true, playbackConfirmed: true, visualTruthConfirmed: true, note: 'Controlled fixture review of the rendered media; not a genuine human acceptance.', reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() }, mediaApproval: { method: 'independent-human', approvedBy: 'alice', approvedAt: new Date(now).toISOString(), manifestHash: manifest.hash } }, pack.revision)
  let creates = 0; let uploads = 0; let payload; let corrupt = false; let providerFails = false; let postState = 'PUBLISHED'
  const config = () => ({ enabled: true, accounts: [{ ownerScope: 'alice', accountId: 'linked-account', name: 'Fixture account', platform: 'LinkedIn', provider: 'linkedin' }] })
  const app = express(); app.use(express.json())
  app.use(createPublishingRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice' }; next() }, config, readFile: async () => corrupt ? Buffer.from('changed') : bytes, provider: { upload: async () => { uploads++; return { id: 'upload-one', path: 'https://uploads.postiz.com/fixture.png' } }, create: async value => { creates++; payload = value; if (providerFails) throw new Error('uncertain transport outcome'); return { postId: 'post-one', integration: 'linked-account' } }, list: async () => [{ id: 'post-one', content: approvedCaption(pack, 'LinkedIn'), state: postState, releaseURL: 'https://www.linkedin.com/posts/test', integration: { id: 'linked-account' } }] } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, body, actor = 'alice', method = body ? 'POST' : 'GET') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: actor, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const input = { requestId: randomUUID(), revision: pack.revision, accountId: 'linked-account', platform: 'LinkedIn', mode: 'now', caption: approvedCaption(pack, 'LinkedIn'), assetIds: [asset.id], confirmed: true }
  try {
    assert.equal((await call('/packages/draft/social-publications', input, 'outsider')).status, 422)
    assert.equal((await call('/packages/draft/social-publications', { ...input, caption: 'Unreviewed viral claim' })).status, 422)
    assert.equal((await call('/packages/draft/social-publications', { ...input, confirmed: false })).status, 400)
    const first = await call('/packages/draft/social-publications', input); assert.equal(first.status, 201)
    let receipt = await first.json(); assert.equal(receipt.status, 'submitted'); assert.equal(receipt.releaseUrl, null)
    assert.equal(creates, 1); assert.equal(uploads, 1); assert.equal(payload.type, 'now'); assert.equal(payload.posts[0].integration.id, 'linked-account')
    assert.equal((await call('/packages/draft/social-publications', input)).status, 200)
    assert.equal((await call('/packages/draft/social-publications', { ...input, requestId: randomUUID() })).status, 200); assert.equal(creates, 1)
    receipt = await (await call(`/social-publications/${receipt.id}/refresh`, {})).json()
    assert.equal(receipt.status, 'published'); assert.equal(receipt.releaseUrl, 'https://www.linkedin.com/posts/test')
    assert.equal((await call('/packages/draft/social-publications', { ...input, mode: 'draft' })).status, 409, 'same request cannot change publication mode')
    providerFails = true
    const uncertain = await call('/packages/draft/social-publications', { ...input, requestId: randomUUID(), mode: 'draft' }); assert.equal(uncertain.status, 502)
    const unknown = await uncertain.json(); assert.equal(unknown.status, 'dispatch_unknown')
    assert.equal((await call('/packages/draft/social-publications', { ...input, requestId: randomUUID(), mode: 'draft' })).status, 200); assert.equal(creates, 2, 'unknown request never dispatches a duplicate')
    assert.equal((await (await call(`/social-publications/${unknown.id}/refresh`, {})).json()).status, 'dispatch_unknown')
    corrupt = true
    const damaged = await call('/packages/draft/social-publications', { ...input, requestId: randomUUID(), mode: 'schedule', publishAt: new Date(Date.now() + 3600000).toISOString() }); assert.equal(damaged.status, 502); assert.equal((await damaged.json()).status, 'blocked'); assert.equal(creates, 2)
    postState = 'QUEUE'
    const profiles = { accountId: 'linked-account', revision: 0, weeklyBrief: 'Explain source-backed AI developments to developers', audience: 'Developers', tone: 'Factual', contentPillars: ['AI research'], weeklyCadence: 3, dailyNews: true, maxDailyPosts: 1, enabled: true, automationConsent: true }
    const saved = await call('/publishing/profiles', profiles, 'alice', 'PUT'); assert.equal(saved.status, 200); const profile = await saved.json(); assert.equal(profile.automaticPolicy.consentedBy, 'alice'); assert.equal(profile.automaticPolicy.paidBudgetMicros, 0)
    assert.equal((await call('/packages/draft/social-publications', { ...input, requestId: randomUUID(), automatic: true })).status, 422, 'automated policy needs a distinct explicit evaluator')
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('Postiz client follows documented auth, preserves ordered payload and never retries failed creates', async () => {
  const previous = process.env.POSTIZ_API_KEY; const previousUrl = process.env.POSTIZ_API_URL
  process.env.POSTIZ_API_KEY = 'fixture-secret'; delete process.env.POSTIZ_API_URL
  let calls = 0
  const provider = createPostizProvider({ fetcher: async (url, options) => { calls++; assert.equal(url.origin, 'https://api.postiz.com'); assert.equal(options.headers.Authorization, 'fixture-secret'); assert.equal(options.redirect, 'error'); return new Response('provider unavailable', { status: 503 }) } })
  try {
    await assert.rejects(provider.create({ type: 'now' })); assert.equal(calls, 1)
    await assert.rejects(provider.upload(Buffer.from('svg'), { id: 'one', mime: 'image/svg+xml' })); assert.equal(calls, 1)
    const config = publishingConfig(); assert.equal(config.enabled, false)
  } finally { if (previous === undefined) delete process.env.POSTIZ_API_KEY; else process.env.POSTIZ_API_KEY = previous; if (previousUrl === undefined) delete process.env.POSTIZ_API_URL; else process.env.POSTIZ_API_URL = previousUrl }
})

test('automatic publishing counts uncertain daily attempts and rejects a profile change during upload', async () => {
  const repository = createRepository(':memory:'); const bytes = Buffer.from('controlled original fixture')
  const pack = repository.studioPut('alice', 'package', 'automatic-pack', { content: { captions: { linkedin: 'Saved platform text [C1]' }, claims: [{ id: 'C1', evidenceId: 'E1' }] }, evidence: [{ id: 'E1', url: 'https://example.com/approved-source' }] }, 0)
  const asset = repository.studioPut('alice', 'asset', 'automatic-asset', { packageId: pack.id, kind: 'image', status: 'completed', mime: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 0)
  let creates = 0; let mutate = true; let uploads = 0
  const app = express(); app.use(express.json())
  app.use(createPublishingRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice' }; next() }, config: () => ({ enabled: true, accounts: [{ ownerScope: 'alice', accountId: 'automatic-account', platform: 'LinkedIn', provider: 'linkedin', name: 'Fixture account' }] }), readFile: async () => bytes, assessReady: async () => ({ eligible: true, issues: [], method: 'controlled-test-only' }), provider: { upload: async () => { uploads++; if (mutate) { const profile = repository.studioList('alice', 'account_profile')[0]; repository.studioPut('alice', 'account_profile', profile.id, { ...profile, tone: 'Changed after consented snapshot' }, profile.revision) } return { id: 'uploaded', path: 'https://uploads.postiz.com/fixture.png' } }, create: async () => { creates++; return { postId: 'automatic-post', integration: 'automatic-account' } } } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const request = (path, body, method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const profile = await request('/publishing/profiles', { accountId: 'automatic-account', revision: 0, weeklyBrief: 'Explain current AI developments to developers', audience: 'Developers', tone: 'Factual', contentPillars: ['AI'], weeklyCadence: 3, maxDailyPosts: 1, dailyNews: true, enabled: true, automationConsent: true }, 'PUT')
    assert.equal(profile.status, 200)
    assert.equal(repository.studioList('__automation_registry__', 'automation_owner')[0].enabled, true)
    const held = repository.studioPut('alice', 'social_publication', 'uncertain-old-post', { accountId: 'automatic-account', status: 'dispatch_unknown', publishAt: new Date().toISOString() }, 0)
    const input = { requestId: randomUUID(), revision: pack.revision, accountId: 'automatic-account', platform: 'LinkedIn', mode: 'now', caption: approvedCaption(pack, 'LinkedIn'), assetIds: [asset.id], confirmed: true, automatic: true }
    assert.equal((await request(`/packages/${pack.id}/social-publications`, input)).status, 429); assert.equal(uploads, 0)
    repository.studioPut('alice', 'social_publication', held.id, { ...held, status: 'blocked' }, held.revision)
    const changed = await request(`/packages/${pack.id}/social-publications`, input)
    assert.equal(changed.status, 502); assert.equal((await changed.json()).status, 'blocked'); assert.equal(creates, 0)
    mutate = false
    const valid = await request(`/packages/${pack.id}/social-publications`, { ...input, requestId: randomUUID() })
    assert.equal(valid.status, 201); assert.equal(creates, 1)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('platform constraints derive YouTube titles from approved text and reject oversized X posts before publishing', () => {
  const video = [{ kind: 'video', mime: 'video/mp4' }]
  const pack = { content: { strategy: { platforms: [{ platform: 'YouTube', headline: 'An approved AI update [C1]', body: 'Supported facts [C1]' }, { platform: 'X', body: 'x'.repeat(281) }] } } }
  const settings = platformSettings(pack, { platform: 'YouTube', provider: 'youtube', settings: { title: 'Incorrect static title', type: 'public', selfDeclaredMadeForKids: 'no' } }, video)
  assert.equal(settings.title, 'An approved AI update'); assert.equal(settings.type, 'public'); assert.equal(settings.selfDeclaredMadeForKids, 'no')
  assert.throws(() => platformSettings(pack, { platform: 'YouTube', provider: 'youtube', settings: {} }, video), /visibility/)
  assert.throws(() => platformSettings(pack, { platform: 'YouTube', provider: 'youtube', settings: settings }, [{ kind: 'image', mime: 'image/png' }]), /MP4/)
  pack.content.strategy.platforms[0].headline = 'y'.repeat(101)
  assert.throws(() => platformSettings(pack, { platform: 'YouTube', provider: 'youtube', settings }, video), /100 characters/)
  assert.throws(() => platformSettings(pack, { platform: 'X', provider: 'x' }, [{ kind: 'image' }]), /280/)
  assert.equal(xWeightedLength('abc [C1]'), 3); assert.equal(xWeightedLength('नमस्ते'), 12)
  assert.equal(platformSettings(pack, { platform: 'Instagram', provider: 'instagram-standalone' }, [{ kind: 'image' }]).post_type, 'post')
  const evidence = [{ id: 'E1', excerpt: 'The publisher announced a limited preview for existing customers.' }]
  const strategy = { angle: 'A preview', audience: 'Developers', whyNow: 'An announcement', factCheck: 'Confirm scope', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Factual', keywords: ['AI'], platforms: [{ platform: 'X', headline: 'A preview [C1]', hook: 'A preview [C1]', body: `${'x'.repeat(281)} [C1]`, cta: 'Read', hashtags: [], thumbnail: 'Original diagram', format: 'Post', retentionPlan: 'Clarity', alternativeHook: 'A model update [C1]', testPlan: 'Observe' }], experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Clicks', decisionRule: 'Comparable views' }] }
  const draft = { strategy, claims: [{ id: 'C1', text: 'A preview', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }] }
  assert.ok(reviewContent(draft, evidence, settingsSchema.parse({ outputs: ['platforms'], platform: 'X' })).issues.some(issue => issue.startsWith('X: keep')))
})

test('mounting publishing leaves public studio configuration anonymous and protects private receipts', async () => {
  const repository = createRepository(':memory:')
  const app = createApp({ repository, sources: [], verifyIdentity: async () => { throw new Error('no valid identity') } })
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/studio/config`)).status, 200)
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/studio/publishing/receipts`)).status, 401)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('social captions preserve reviewed prose and append only actual cited evidence URLs within platform limits', () => {
  const body = 'Supported finding [C1]. Another finding [C2]. A third [C3].'
  const pack = { content: { captions: { linkedin: body }, strategy: { platforms: [{ platform: 'X', body }] }, claims: [{ id: 'C1', evidenceId: 'E1' }, { id: 'C2', evidenceId: 'E2' }, { id: 'C3', evidenceId: 'E3' }, { id: 'C4', evidenceId: 'unused' }] }, evidence: [{ id: 'E1', url: 'https://publisher.example/actual-announcement' }, { id: 'E2', url: 'https://research.example/actual-paper' }, { id: 'E3', url: 'https://third.example/actual-source' }, { id: 'unused', url: 'https://irrelevant.example/not-cited' }] }
  const caption = renderSocialCaption(pack, 'LinkedIn')
  assert.ok(caption.startsWith('Supported finding. Another finding. A third.'))
  assert.ok(caption.includes('https://publisher.example/actual-announcement')); assert.ok(caption.includes('https://research.example/actual-paper'))
  assert.equal(caption.includes('third.example'), false); assert.equal(caption.includes('irrelevant.example'), false)
  assert.equal(socialSourceUrls(pack, 'X').length, 1)
  assert.equal(xWeightedLength('https://publisher.example/a-very-long-supported-source-url'), 23)
  pack.content.strategy.platforms[0].body = `${'x'.repeat(260)} [C1]`
  assert.throws(() => platformSettings(pack, { platform: 'X', provider: 'x' }, [{ kind: 'image' }]), /280/)
  pack.content.captions.linkedin = `${'x'.repeat(2980)} [C1]`
  assert.throws(() => platformSettings(pack, { platform: 'LinkedIn', provider: 'linkedin' }, [{ kind: 'image' }]), /3000/)
  pack.evidence[0].url = 'https://user:password@publisher.example/not-public'
  assert.equal(socialSourceUrls(pack, 'X').length, 0)
})

test('Postiz readback decodes HTML entities without accepting changed prose, newlines or link targets', () => {
  const caption = 'R&D reports a finding.\n\nSource: https://example.com/paper?a=1&b=2'
  assert.equal(postizContentMatches(caption, 'R&amp;D reports a finding.\n\nSource: https://example.com/paper?a=1&amp;b=2'), true)
  assert.equal(postizContentMatches(caption, '<p>R&amp;D reports a finding.</p><p>Source: <a href="https://example.com/paper?a=1&amp;b=2">https://example.com/paper?a=1&amp;b=2</a></p>'), true)
  assert.equal(postizContentMatches(caption, '<p>R&amp;D reports a finding.</p><p>Source: <a href="https://evil.example/">https://example.com/paper?a=1&amp;b=2</a></p>'), false)
  assert.equal(postizContentMatches(caption, caption.replace('reports', 'proves')), false)
  assert.equal(postizContentMatches(caption, caption.replace('\n\n', '\n')), false)
  assert.equal(postizContentMatches(caption, `${caption}<script>doSomething()</script>`), false)
  assert.equal(postizContentMatches('A\nB', '<p>A<br>B</p>'), true)
  assert.equal(postizContentMatches('A\n\nSource: https://example.com/a\nhttps://example.com/b', '<p>A</p><p></p><p>Source: https://example.com/a</p><p>https://example.com/b</p>'), true)
  assert.equal(postizContentMatches('A\nB', 'Changed<p>A</p><p>B</p>'), false)
  assert.equal(postizContentMatches('A\n\nB', '<p>A</p><p>B</p>'), true)
  assert.equal(postizContentMatches('A\n\nB', '<p>A</p><p>Changed</p><p>B</p>'), false)
})

test('concurrent accounts wait for the owner admission lease and retain cross-account request identity', async () => {
  const repository = createRepository(':memory:'); const bytes = Buffer.from('controlled concurrency asset')
  const pack = repository.studioPut('alice', 'package', 'concurrent-pack', { content: { captions: { linkedin: 'Supported source [C1]' }, claims: [{ id: 'C1', evidenceId: 'E1' }] }, evidence: [{ id: 'E1', url: 'https://example.com/actual-source' }] }, 0)
  const asset = repository.studioPut('alice', 'asset', 'concurrent-asset', { packageId: pack.id, kind: 'image', status: 'completed', mime: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 0)
  const actualPut = repository.studioPut
  let firstAdmission = true; const created = []
  repository.studioPut = async (...args) => { if (args[1] === 'social_publication' && args[4] === 0 && firstAdmission) { firstAdmission = false; await delay(60) } return actualPut(...args) }
  const service = createPublishingService({ repository, config: () => ({ enabled: true, accounts: ['account-a', 'account-b'].map(accountId => ({ accountId, ownerScope: 'alice', platform: 'LinkedIn', provider: 'linkedin', name: accountId })) }), assessReady: async () => ({ eligible: true, issues: [], method: 'controlled-concurrency-fixture' }), readFile: async () => bytes, provider: { upload: async () => ({ id: 'uploaded', path: 'https://uploads.postiz.com/asset.png' }), create: async payload => { const accountId = payload.posts[0].integration.id; created.push(accountId); return { postId: `post-${accountId}`, integration: accountId } } } })
  const input = { revision: pack.revision, platform: 'LinkedIn', mode: 'now', caption: approvedCaption(pack, 'LinkedIn'), assetIds: [asset.id], confirmed: true }
  const requestA = randomUUID(); const requestB = randomUUID()
  try {
    const results = await Promise.all(['account-a', 'account-b'].map((accountId, index) => service.publish({ owner: 'alice', actorUid: 'alice', packageId: pack.id, input: { ...input, accountId, requestId: index === 0 ? requestA : requestB } })))
    assert.deepEqual(results.map(result => result.status), [201, 201])
    assert.deepEqual(created.sort(), ['account-a', 'account-b'])
    await assert.rejects(service.publish({ owner: 'alice', actorUid: 'alice', packageId: pack.id, input: { ...input, accountId: 'account-b', requestId: requestA } }), { status: 409 })
    assert.equal(created.length, 2)
  } finally { repository.close() }
})

test('automatic hash GUIDs dispatch once while pre-provider failures are classified without weakening manual IDs', async () => {
  const repository = createRepository(':memory:'); const bytes = Buffer.from('controlled automatic GUID fixture')
  const pack = repository.studioPut('alice', 'package', 'guid-pack', { content: { captions: { linkedin: 'Supported source [C1]' }, claims: [{ id: 'C1', evidenceId: 'E1' }] }, evidence: [{ id: 'E1', url: 'https://example.com/actual-source' }] }, 0)
  const asset = repository.studioPut('alice', 'asset', 'guid-asset', { packageId: pack.id, kind: 'image', status: 'completed', mime: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 0)
  repository.studioPut('alice', 'account_profile', createHash('sha256').update('guid-account').digest('hex').slice(0, 32), { enabled: true, automationConsent: true, automaticPolicy: { consentedBy: 'alice' }, maxDailyPosts: 1 }, 0)
  let enabled = false; let uploads = 0; let creates = 0
  const service = createPublishingService({ repository, config: () => ({ enabled, accounts: [{ ownerScope: 'alice', accountId: 'guid-account', platform: 'LinkedIn', provider: 'linkedin' }] }), assessReady: async () => ({ eligible: true, issues: [] }), readFile: async () => bytes, provider: { upload: async () => { uploads++; return { id: 'uploaded', path: 'https://uploads.postiz.com/guid.png' } }, create: async () => { creates++; return { postId: 'guid-post', integration: 'guid-account' } } } })
  const input = { requestId: '864a148f-c0ca-5976-ff2a-db8e18b0e03d', revision: pack.revision, accountId: 'guid-account', platform: 'LinkedIn', mode: 'now', caption: approvedCaption(pack, 'LinkedIn'), assetIds: [asset.id], confirmed: true, automatic: true }
  const publish = changes => service.publish({ owner: 'alice', actorUid: 'alice', packageId: pack.id, input: { ...input, ...changes } })
  try {
    await assert.rejects(publish({}), { status: 503, preDispatch: true })
    await assert.rejects(publish({ automatic: false }), error => error.name === 'ZodError' && error.preDispatch === true)
    enabled = true
    await assert.rejects(publish({ accountId: 'other-account' }), { status: 422, preDispatch: true })
    await assert.rejects(publish({ caption: 'Changed unreviewed text' }), { status: 422, preDispatch: true })
    assert.equal(uploads, 0); assert.equal(creates, 0); assert.equal(repository.studioList('alice', 'social_publication').length, 0)
    assert.equal((await publish({})).status, 201)
    assert.equal((await publish({})).status, 200)
    assert.equal(uploads, 1); assert.equal(creates, 1)
  } finally { repository.close() }
})
