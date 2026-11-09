import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createRepository } from '../storage/repository.js'
import { createAutomationRouter } from '../automation/router.js'
import { createAutomationServices, assessAutomationRelease, runAutomationRequest } from '../automation/services.js'
import { settingsSchema } from '../studio/content.js'
import { reviewAutomaticText } from '../automation/review.js'
import { ratingsFixture } from './fixtures/finalization.js'
import { contentHash } from '../studio/approval.js'
import { createHash, randomUUID } from 'node:crypto'
import { costScopeHash } from '../budget/policy.js'
import { env } from '../config/env.js'

test('automation route queues owner-consented account runs, isolates owners and does not invent execution', async () => {
  const repository = createRepository(':memory:'); const app = express(); app.use(express.json())
  let admitted
  app.use(createAutomationRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'owner' }; next() }, onAutomationAdmitted: async value => { admitted = value } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const call = (path, method = 'GET', body, actor = 'owner') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: actor, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    assert.equal((await call('/automation/run', 'POST', {})).status, 422)
    await repository.studioPut('owner', 'account_profile', 'profile-a', { accountId: 'account-a', enabled: true, automationConsent: true })
    const response = await call('/automation/run', 'POST', { accountIds: ['account-a'] })
    assert.equal(response.status, 202)
    const request = await response.json(); assert.equal(request.status, 'queued')
    assert.equal(admitted.requestId, request.id); assert.equal(admitted.owner, 'owner')
    assert.equal((await (await call('/automation', 'GET', undefined, 'other')).json()).requests.length, 0)
    assert.equal((await call('/automation/run', 'POST', { accountIds: ['account-a'], trustedPass: true })).status, 400)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('automation router does not intercept unrelated public configuration requests', async () => {
  let authCalls = 0
  const app = express()
  app.use(createAutomationRouter({ repository: {}, auth: (_req, res) => { authCalls++; res.sendStatus(401) } }))
  app.get('/config', (_req, res) => res.json({ public: true }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/config`)
    assert.equal(response.status, 200); assert.equal(authCalls, 0)
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/automation`)).status, 401)
    assert.equal(authCalls, 1)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('actual automation services are complete and automatic release re-inspects bytes without requiring fabricated humans', async () => {
  const repository = createRepository(':memory:')
  try {
    const services = createAutomationServices(repository)
    for (const stage of ['research', 'generate', 'review', 'render', 'publish', 'readback', 'reconcile']) assert.equal(typeof services[stage], 'function')
    const profile = { accountId: 'account-a', platform: 'LinkedIn', weeklyBrief: 'Explain source-supported AI previews.', audience: 'Developers', tone: 'Clear', contentPillars: ['AI previews'], enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', consentedBy: 'owner', consentedAt: new Date().toISOString(), scope: 'research-generation-and-social-publishing' } }
    const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted and the announcement does not establish broad deployment.'
    const pack = { id: 'pack-a', createdBy: 'owner', settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [{ id: 'E1', url: 'https://example.com/update', hash: 'hash', excerpt, retrievedAt: new Date().toISOString() }], content: { website: { title: 'Developer preview', body: 'The publisher announced a limited developer preview [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a limited preview', quote: excerpt, evidenceId: 'E1', status: 'attributed' }] } }
    pack.automaticReview = await reviewAutomaticText(pack, profile, { generate: async () => ({ claims: [{ id: 'C1', verdict: 'supported', evidenceIds: ['E1'], supportQuote: excerpt, reason: 'The saved publisher passage supports this attributed and qualified claim.' }], ratings: ratingsFixture(), checks: { semanticSupport: true, contradictionsResolved: true, scopePreserved: true, promisesAligned: true, privacySafe: true, audienceClaimsSupported: true, provenanceClear: true }, issues: [], summary: 'The exact saved preview claim preserves the publisher qualifications.' }) })
    const bytes = Buffer.from('<svg width="1080" height="1920"><text x="40" y="80">Attributed developer preview</text></svg>')
    const asset = { id: 'asset-a', kind: 'image', mime: 'image/svg+xml', packageId: pack.id, packageContentHash: contentHash(pack), createdBy: 'owner', status: 'completed', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), provenance: { method: 'server-local-render', rights: 'original-text-and-vectors' } }
    const context = { repository, owner: 'owner', pack, assets: [asset], profile, actorUid: 'owner', input: { automatic: true, accountId: 'account-a', platform: 'LinkedIn' }, readFile: async () => bytes }
    assert.equal((await assessAutomationRelease(context)).eligible, true)
    assert.equal(pack.independentReview, undefined)
    assert.equal((await assessAutomationRelease({ ...context, readFile: async () => Buffer.from('changed') })).eligible, false)
    assert.equal((await assessAutomationRelease({ ...context, actorUid: 'other' })).eligible, false)
    assert.equal((await assessAutomationRelease({ ...context, profile: { ...profile, enabled: false } })).eligible, false)
    assert.equal((await runAutomationRequest({ repository, owner: 'owner', requestId: 'missing' })).status, 'skipped')
  } finally { repository.close() }
})

test('real research service reuses a matching current weekly report and admits only date-supported current news', async () => {
  const repository = createRepository(':memory:'); const at = new Date()
  const day = at.toISOString().slice(0, 10)
  const topic = { title: 'A supported AI preview', whatChanged: 'The publisher described a preview.', eventDate: day, verification: 'reported', whyItMatters: 'A practical developer example.', evidenceIds: ['E1'], positive: [], negative: [], audienceReaction: { status: 'insufficient-evidence', summary: 'No audience observations.', evidenceIds: [], limitations: 'No audience sample collected.' }, angle: 'Explain the limited preview.', hook: 'A limited preview explained.', counterpoint: 'Availability is limited.', opportunityReason: 'Editorial relevance, not measured popularity.', keywords: ['AI preview'] }
  let calls = 0; const scopes = []
  const services = createAutomationServices(repository, { research: async niche => {
    calls++; scopes.push(niche)
    return { summary: 'A source-supported briefing.', opportunities: niche.contentApproach === 'news' ? [topic, { ...topic, title: 'Undated news must not be treated as latest', eventDate: null }, { ...topic, title: 'Old news must not be treated as latest', eventDate: '2000-01-01' }] : [topic, { ...topic, title: 'Another supported weekly angle' }], unknowns: ['Audience demand is unknown.'], evidence: [{ id: 'E1', hash: 'stable-source', url: 'https://example.com/update', publishedAt: at.toISOString(), retrievedAt: at.toISOString(), excerpt: 'The publisher described a limited preview for developers. Availability remains restricted and independent outcomes have not been established.' }], researchedAt: at.toISOString(), methodology: 'Injected source-backed acceptance fixture; no actual provider call.' }
  } })
  try {
    let profile = await repository.studioPut('owner', 'account_profile', 'profile-a', { accountId: 'account-a', platform: 'LinkedIn', name: 'AI account', weeklyBrief: 'Explain AI preview features and their limitations.', audience: 'Developers', tone: 'Clear', contentPillars: ['AI previews'], enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'owner', consentedAt: at.toISOString(), paidBudgetMicros: 0 } })
    const context = { owner: 'owner', profile, slot: { kind: 'weekly' }, localDate: day, now: at, actorUid: 'owner', requestId: randomUUID() }
    const first = await services.research(context)
    assert.equal(first.status, 'completed'); assert.equal(calls, 1); assert.equal(first.topics.length, 2)
    const later = new Date(at.getTime() + 2 * 86400000)
    const reused = await services.research({ ...context, requestId: randomUUID(), now: later, localDate: later.toISOString().slice(0, 10) })
    assert.equal(reused.reportId, first.reportId); assert.equal(calls, 1)
    assert.equal(reused.topics.length, 2, 'other distinct weekly topics remain available without another provider request')
    const news = await services.research({ ...context, requestId: randomUUID(), slot: { kind: 'news' } })
    assert.equal(news.status, 'completed'); assert.equal(news.topics.length, 1); assert.equal(news.topics[0].eventDate, day)
    assert.equal(scopes.find(scope => scope.contentApproach === 'news').refreshIntervalDays, 1)
    assert.equal(scopes.find(scope => scope.contentApproach === 'evergreen').refreshIntervalDays, 7)
    profile = await repository.studioPut('owner', 'account_profile', profile.id, { ...profile, tone: 'Different account mindset' }, profile.revision)
    const changed = await services.research({ ...context, profile, requestId: randomUUID() })
    assert.notEqual(changed.reportId, first.reportId); assert.equal(calls, 3)
  } finally { repository.close() }
})

test('automated export stays private, binds the current profile and describes only machine acceptance', async () => {
  const repository = createRepository(':memory:'); const app = express()
  app.use(createAutomationRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'owner' }; next() }, assessReady: async context => ({ eligible: context.input.automatic === true && context.assets.length === 1, issues: [], media: { method: 'automated-media-v1', eligible: true } }) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  try {
    const profile = await repository.studioPut('owner', 'account_profile', 'profile-a', { accountId: 'account-a', platform: 'LinkedIn', enabled: true })
    const pack = await repository.studioPut('owner', 'package', 'export-a', { settings: {}, content: { claims: [] }, evidence: [{ id: 'E1', url: 'https://example.com/update', retrievedAt: new Date().toISOString(), hash: 'source-hash' }], automaticReview: { profileHash: costScopeHash(profile, null), method: 'automated-model-review' } })
    await repository.studioPut('owner', 'asset', 'asset-a', { packageId: pack.id, packageContentHash: contentHash(pack), status: 'completed', mime: 'image/png', bytes: 20, sha256: 'hash' })
    const call = actor => fetch(`http://127.0.0.1:${server.address().port}/automation/packages/export-a/export`, { headers: { Authorization: actor } })
    assert.equal((await call('other')).status, 404)
    const response = await call('owner'); assert.equal(response.status, 200)
    const exported = await response.json()
    assert.equal(exported.manifest.scope, 'automated-text-and-media-package')
    assert.equal(exported.manifest.method, 'automated-content-release-v1')
    assert.equal(exported.package.independentReview, undefined)
    assert.equal(exported.assets[0].fileUrl, '/api/studio/assets/asset-a/file')
    await repository.studioPut('owner', 'account_profile', profile.id, { ...profile, enabled: false }, profile.revision)
    assert.equal((await call('owner')).status, 422)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('concurrent account research waits only for owner admission contention and dispatches each durable job once', async () => {
  const repository = createRepository(':memory:')
  const acquire = repository.acquireLease
  let first = true; let busy = 0; let signalHeld
  const held = new Promise(resolve => { signalHeld = resolve })
  repository.acquireLease = async (...args) => {
    const acquired = await acquire(...args)
    if (args[0] === 'research:owner') {
      if (!acquired) busy++
      if (acquired && first) { first = false; signalHeld(); await new Promise(resolve => setTimeout(resolve, 50)) }
    }
    return acquired
  }
  let calls = 0
  const services = createAutomationServices(repository, { research: async () => {
    calls++
    return { summary: 'No supported opportunity in this controlled fixture.', opportunities: [], unknowns: ['No supporting source was supplied.'], evidence: [], researchedAt: new Date().toISOString(), methodology: 'Controlled concurrent admission test, not actual source research.' }
  } })
  try {
    const profiles = await Promise.all(['a', 'b'].map(id => repository.studioPut('owner', 'account_profile', `profile-${id}`, { accountId: `account-${id}`, platform: 'LinkedIn', weeklyBrief: `Explain practical AI for account ${id} and preserve uncertainty.`, audience: `Account ${id} readers`, tone: 'Clear', contentPillars: ['AI previews'], enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'owner', consentedAt: new Date().toISOString(), paidBudgetMicros: 0 } })))
    const contexts = profiles.map(profile => ({ owner: 'owner', profile, slot: { kind: 'weekly' }, localDate: new Date().toISOString().slice(0, 10), now: new Date(), actorUid: 'owner', requestId: randomUUID() }))
    const a = services.research(contexts[0]); await held
    const results = await Promise.all([a, services.research(contexts[1])])
    assert.ok(busy >= 1, 'the actual shared owner research lease was contended')
    assert.equal(calls, 2, 'waiting for admission must not duplicate provider dispatch')
    for (let index = 0; index < contexts.length; index++) {
      assert.equal((await repository.studioJobGet('owner', contexts[index].requestId)).status, 'completed')
      assert.equal(results[index].status, 'blocked', 'empty genuine research is blocked rather than inventing topics')
      assert.ok(results[index].reportId)
    }
  } finally { repository.close() }
})

test('automatic generation quota rejection is known pre-dispatch and leaves no new job or cost', async () => {
  const repository = createRepository(':memory:'); let calls = 0
  const services = createAutomationServices(repository, { write: async () => { calls++; throw new Error('Quota must prevent dispatch') } })
  try {
    for (let index = 0; index < env.STUDIO_DAILY_GENERATIONS; index++) await repository.studioJobReserve('owner', randomUUID(), 'a'.repeat(64), env.STUDIO_DAILY_GENERATIONS, { operation: 'generation' })
    const run = { id: 'quota-unit' }; const requestId = randomUUID()
    const packageId = createHash('sha256').update(`${run.id}:package`).digest('hex').slice(0, 32)
    const draft = await repository.studioPut('owner', 'package', packageId, { settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [], content: null, status: 'draft' })
    await assert.rejects(services.generate({ owner: 'owner', profile: {}, actorUid: 'owner', requestId, run }), { code: 'STUDIO_QUOTA', preDispatch: true })
    assert.equal(calls, 0)
    assert.equal(await repository.studioJobGet('owner', requestId), null)
    assert.equal(await repository.budgetGet('owner', requestId), null)
    assert.equal((await repository.studioGet('owner', 'package', packageId)).revision, draft.revision)
  } finally { repository.close() }
})

test('new automatic drafts request the account platform and website and publish its exact strategy body without generic captions', async () => {
  const repository = createRepository(':memory:'); let publishingInput
  const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted and independent deployment outcomes have not been established.'
  const body = 'The publisher announced a limited developer preview [C1].'
  const content = { website: { title: 'Developer preview', body }, claims: [{ id: 'C1', text: 'The publisher announced a limited developer preview', evidenceId: 'E1', quote: excerpt, status: 'attributed' }], strategy: { angle: 'Limited preview', audience: 'Developers', whyNow: 'A preview', factCheck: 'Check scope', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Clear', keywords: ['AI'], platforms: [{ platform: 'X', headline: 'Limited developer preview [C1]', hook: 'A limited preview [C1]', body, cta: 'Read the source', hashtags: [], thumbnail: 'Original diagram', format: 'Post', retentionPlan: 'Clear scope', alternativeHook: 'Developer preview [C1]', testPlan: 'Observe clicks' }], experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Clicks', decisionRule: 'Comparable views' }] } }
  const services = createAutomationServices(repository, { write: async (_evidence, settings) => { assert.deepEqual(settings.outputs, ['platforms', 'website']); return content }, publisher: { publish: async value => { publishingInput = value.input; return { receipt: { id: 'controlled-receipt', status: 'submitted' } } } } })
  try {
    const profile = repository.studioPut('owner', 'account_profile', 'profile-x', { accountId: 'account-x', platform: 'X', audience: 'Developers', tone: 'Factual', contentPillars: ['AI'], weeklyBrief: 'Explain a limited developer preview.', enabled: true, automationConsent: true }, 0)
    const topic = { index: 0, title: 'Limited developer preview', evidenceIds: ['E1'] }
    const report = repository.studioPut('owner', 'research', 'report-x', { opportunities: [topic], evidence: [{ id: 'E1', hash: 'source-hash', url: 'https://example.com/update', excerpt, retrievedAt: new Date().toISOString() }] }, 0)
    const context = { owner: 'owner', actorUid: 'owner', profile, requestId: randomUUID(), run: { id: 'two-output-unit', researchId: report.id, topic } }
    const result = await services.generate(context)
    assert.equal(result.status, 'completed'); assert.equal(result.package.content.captions, undefined)
    await services.publish({ ...context, requestId: randomUUID(), run: { ...context.run, packageId: result.package.id, assetIds: ['controlled-asset'] } })
    assert.equal(publishingInput.platform, 'X'); assert.equal(publishingInput.accountId, 'account-x')
    assert.equal(publishingInput.caption, 'The publisher announced a limited developer preview.\n\nSource: https://example.com/update')
    assert.deepEqual(result.package.settings.outputs, ['platforms', 'website'])
  } finally { repository.close() }
})
