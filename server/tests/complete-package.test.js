import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { settingsSchema } from '../studio/content.js'
import { buildCompletePackage, completeContextSchema, completeInputHash, decisionParameters } from '../studio/complete-package.js'
import { analyzeCompletePackage, createCompletePackageRouter, recoverCompleteAnalysis } from '../studio/complete-package-router.js'
import { runPendingContentJobs } from '../studio/job-worker.js'

const config = { STUDIO_DAILY_GENERATIONS: 20, LLM_MODEL: 'nvidia/controlled-fixture:free' }
const context = { brand: 'Approved editorial brand', objective: 'Explain a supported announcement', rightsNote: 'Use cleared references only.', productionTools: { graphics: 'Approved graphics tool', editor: 'Approved editor' } }
function fixture(owner = 'alice') {
  const repository = createRepository(':memory:')
  const pack = repository.studioPut(owner, 'package', 'controlled-package', { title: 'A supported announcement', status: 'completed', settings: settingsSchema.parse({ platform: 'Instagram', outputs: ['platforms'] }), evidence: [{ id: 'E1', title: 'Announcement', url: 'https://example.com/announcement', excerpt: 'The publisher announced a limited preview.', retrievedAt: new Date().toISOString(), limitations: [] }], content: { claims: [{ id: 'C1', text: 'A limited preview was announced', evidenceId: 'E1', quote: 'The publisher announced a limited preview.', status: 'attributed' }], strategy: { platforms: [{ platform: 'Instagram', headline: 'Limited preview [C1]', hook: 'A preview was announced [C1]', body: 'A limited preview was announced [C1].', cta: 'Read the source.', format: 'image', thumbnail: 'An illustrative diagram' }] } } }, 0)
  repository.studioPut(owner, 'complete_context', pack.id, { context }, 0)
  return { repository, pack, owner }
}
const result = request => ({ summary: 'A controlled production hypothesis.', decisions: request.input.selectedPlatforms.flatMap(platform => decisionParameters.map(parameter => ({ id: `${platform}-${parameter}`, platform, parameter, value: ({ format: 'image', language: 'English', tone: 'Clear and factual', duration: '60', aspectRatio: '4:5', visualStyle: 'Illustrative diagram', audioApproach: 'Silent', coverApproach: 'Illustrative cover', cta: 'Read the source.', postingSlot: 'Unavailable', successMetric: 'Share rate', testVariable: 'Opening' })[parameter], method: 'hypothesis', evidenceIds: ['E1'], metricIds: [], rationale: 'Test this choice; no historical performance is supplied.', alternatives: [], confidence: 'low', missing: ['Historical account analytics are unavailable.'] }))) })
async function inputFor(repository, owner, pack, requestId = randomUUID()) {
  const complete = await buildCompletePackage(repository, owner, pack)
  return { requestId, contentHash: complete.contentHash, contextRevision: complete.contextRevision }
}

async function uncertainAnalysis({ shared = false, generationId = 'gen-123-analysis' } = {}) {
  const value = fixture(shared ? `ws:${randomUUID()}` : 'alice')
  const actor = 'alice'
  if (shared) value.repository.studioPut('__workspace_control__', 'workspace', value.owner, { members: [{ uid: actor, role: 'owner' }, { uid: 'editor', role: 'editor' }, { uid: 'viewer', role: 'viewer' }] }, 0)
  const input = await inputFor(value.repository, value.owner, value.pack)
  let generations = 0
  await analyzeCompletePackage({ ...value, actor, input, config, generate: async () => { generations++; throw Object.assign(new Error('Controlled incomplete response'), { code: 'MODEL_INCOMPLETE', generationId, transportStatus: 200, finishReason: 'error' }) } })
  return { ...value, actor, input, generations, jobId: `complete-analysis:${input.requestId}` }
}

test('unknown analysis cannot recover without acknowledgment; acknowledged free recovery retains its ledger and permits only a distinct explicit analysis', async () => {
  const value = await uncertainAnalysis()
  const { repository, owner, actor, pack, input, jobId } = value
  const readReceipt = async () => { throw Error('Controlled 404') }
  try {
    const cost = repository.budgetGet(owner, jobId)
    const active = repository.studioGet(owner, 'complete_analysis', pack.id)
    await assert.rejects(recoverCompleteAnalysis({ ...value, input, config, readReceipt }), { status: 409 })
    assert.equal(repository.studioGet(owner, 'complete_analysis', pack.id).revision, active.revision)
    const recovered = await recoverCompleteAnalysis({ ...value, input: { ...input, acknowledgeUnknownOutcome: true }, config, readReceipt })
    assert.equal(recovered.analysis.status, 'failed')
    assert.deepEqual(repository.budgetGet(owner, jobId), cost)
    const oldJob = repository.studioJobGet(owner, jobId)
    assert.equal(oldJob.status, 'failed')
    assert.equal(oldJob.result.recovery.billingOutcome, 'unknown-reservation-retained')
    assert.equal(oldJob.result.recovery.mode, 'acknowledged-unknown')
    assert.ok(repository.studioHistory(owner, 'complete_analysis', pack.id).some(entry => entry.status === 'dispatch_unknown'))
    const replay = await recoverCompleteAnalysis({ ...value, input, config, readReceipt: () => { throw Error('Replay must not fetch') } })
    assert.equal(replay.analysis.status, 'failed')
    assert.equal(repository.studioJobGet(owner, jobId).revision, oldJob.revision)
    let calls = 0
    await analyzeCompletePackage({ repository, owner, actor, pack, input, config, generate: async request => { calls++; return result(request) } })
    assert.equal(calls, 0, 'The original request ID is not dispatched again')
    const completed = await analyzeCompletePackage({ repository, owner, actor, pack, input: { ...input, requestId: randomUUID() }, config, generate: async request => { calls++; return result(request) } })
    assert.equal(completed.body.analysis.status, 'completed')
    assert.equal(calls, 1)
    assert.deepEqual(repository.budgetGet(owner, jobId), cost)
  } finally { repository.close() }
})

test('verified unusable zero receipt recovers only its matching analysis without settling the reservation', async () => {
  for (const finishReason of ['error', 'length']) {
    const value = await uncertainAnalysis()
    try {
      const cost = value.repository.budgetGet(value.owner, value.jobId)
      const recovered = await recoverCompleteAnalysis({ ...value, config, readReceipt: async id => ({ generationId: id, actualMicros: 0, finishReason }) })
      assert.equal(recovered.analysis.status, 'failed')
      assert.equal(value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id).recovery.mode, 'verified-unusable')
      assert.deepEqual(value.repository.budgetGet(value.owner, value.jobId), cost)
    } finally { value.repository.close() }
  }
  for (const receipt of [{ generationId: 'gen-wrong', actualMicros: 0, finishReason: 'error' }, { generationId: 'gen-123-analysis', actualMicros: 1, finishReason: 'error' }, { generationId: 'gen-123-analysis', actualMicros: 0, finishReason: 'stop' }]) {
    const value = await uncertainAnalysis()
    try {
      await assert.rejects(recoverCompleteAnalysis({ ...value, config, readReceipt: async () => receipt }), { status: 409 })
      assert.equal(value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id).status, 'dispatch_unknown')
    } finally { value.repository.close() }
  }
})

test('recovery rejects other actors, stale inputs, other attempts, paid and unbound scopes without writing', async () => {
  const cases = [
    () => ({ actor: 'other-owner' }),
    value => ({ input: { ...value.input, contentHash: '0'.repeat(64), acknowledgeUnknownOutcome: true } }),
    value => ({ input: { ...value.input, contextRevision: 0, acknowledgeUnknownOutcome: true } }),
    value => ({ input: { ...value.input, requestId: randomUUID(), acknowledgeUnknownOutcome: true } }),
    value => ({ repository: { ...value.repository, studioJobGet: (owner, id) => ({ ...value.repository.studioJobGet(owner, id), scope: { ...value.repository.studioJobGet(owner, id).scope, model: 'paid/provider' } }) } }),
    value => ({ repository: { ...value.repository, studioJobGet: (owner, id) => ({ ...value.repository.studioJobGet(owner, id), scope: { ...value.repository.studioJobGet(owner, id).scope, generationProvider: 'vertex' } }) } }),
    value => ({ repository: { ...value.repository, studioJobGet: (owner, id) => ({ ...value.repository.studioJobGet(owner, id), status: 'running' }) } }),
    value => ({ repository: { ...value.repository, studioJobGet: (owner, id) => ({ ...value.repository.studioJobGet(owner, id), status: 'completed' }) } }),
    value => ({ repository: { ...value.repository, budgetGet: (owner, id) => ({ ...value.repository.budgetGet(owner, id), quote: { ...value.repository.budgetGet(owner, id).quote, upperBoundMicros: 100 } }) } }),
  ]
  for (const change of cases) {
    const value = await uncertainAnalysis()
    try {
      const active = value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id)
      await assert.rejects(recoverCompleteAnalysis({ ...value, input: { ...value.input, acknowledgeUnknownOutcome: true }, config, readReceipt: async () => { throw Error('No receipt') }, ...change(value) }), error => [403, 409].includes(error.status))
      assert.equal(value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id).revision, active.revision)
      assert.equal(value.repository.studioJobGet(value.owner, value.jobId).status, 'dispatch_unknown')
    } finally { value.repository.close() }
  }
  const value = await uncertainAnalysis({ shared: true })
  try { await assert.rejects(recoverCompleteAnalysis({ ...value, actor: 'viewer', config, input: { ...value.input, acknowledgeUnknownOutcome: true } }), { status: 403 }) } finally { value.repository.close() }
})

test('recovery rechecks role and context after receipt lookup and does not mutate either old attempt', async () => {
  for (const mutate of ['role', 'context']) {
    const value = await uncertainAnalysis({ shared: true })
    try {
      const readReceipt = async id => {
        if (mutate === 'role') value.repository.studioPut('__workspace_control__', 'workspace', value.owner, { members: [{ uid: value.actor, role: 'viewer' }] }, 1)
        else value.repository.studioPut(value.owner, 'complete_context', value.pack.id, { context: { ...context, objective: 'Changed while the receipt was being read' } }, 1)
        return { generationId: id, actualMicros: 0, finishReason: 'error' }
      }
      await assert.rejects(recoverCompleteAnalysis({ ...value, config, readReceipt }), { status: mutate === 'role' ? 403 : 409 })
      assert.equal(value.repository.studioJobGet(value.owner, value.jobId).status, 'dispatch_unknown')
      assert.equal(value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id).status, 'dispatch_unknown')
    } finally { value.repository.close() }
  }
})

test('recovery safely resumes after its job CAS succeeds but the analysis write fails', async () => {
  const value = await uncertainAnalysis()
  let failWrite = true
  const repository = { ...value.repository, studioPut: (...args) => { if (args[1] === 'complete_analysis' && failWrite) { failWrite = false; throw Error('Controlled interrupted storage write') } return value.repository.studioPut(...args) } }
  try {
    await assert.rejects(recoverCompleteAnalysis({ ...value, repository, input: { ...value.input, acknowledgeUnknownOutcome: true }, config, readReceipt: async () => { throw Error('No receipt') } }), /Controlled interrupted storage write/)
    const oldJob = value.repository.studioJobGet(value.owner, value.jobId)
    assert.equal(oldJob.status, 'failed')
    assert.equal(value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id).status, 'dispatch_unknown')
    const resumed = await recoverCompleteAnalysis({ ...value, repository, config, readReceipt: () => { throw Error('Resuming must not fetch again') } })
    assert.equal(resumed.analysis.status, 'failed')
    assert.equal(value.repository.studioJobGet(value.owner, value.jobId).revision, oldJob.revision)
    assert.equal(value.repository.budgetGet(value.owner, value.jobId).status, 'dispatch_unknown')
  } finally { value.repository.close() }
})

test('recovery rejects a concurrent analysis revision change during the receipt check', async () => {
  const value = await uncertainAnalysis()
  try {
    await assert.rejects(recoverCompleteAnalysis({ ...value, config, readReceipt: async id => {
      const active = value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id)
      value.repository.studioPut(value.owner, 'complete_analysis', value.pack.id, { ...active, error: 'Concurrent diagnostics update' }, active.revision)
      return { generationId: id, actualMicros: 0, finishReason: 'error' }
    } }), { status: 409 })
    assert.equal(value.repository.studioJobGet(value.owner, value.jobId).status, 'dispatch_unknown')
    assert.equal(value.repository.studioGet(value.owner, 'complete_analysis', value.pack.id).error, 'Concurrent diagnostics update')
  } finally { value.repository.close() }
})

test('protected recovery route rejects viewer and injected receipt fields while permitting an editor to acknowledge the saved free attempt', async () => {
  const value = await uncertainAnalysis({ shared: true })
  const { repository, owner, pack, input } = value
  let receiptReads = 0
  const app = express(); app.use(express.json()); app.use(createCompletePackageRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization }; next() }, config, readReceipt: async () => { receiptReads++; throw Error('Controlled 404') } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (actor, body) => fetch(`http://127.0.0.1:${server.address().port}/packages/${pack.id}/complete-package/recover-analysis`, { method: 'POST', headers: { Authorization: actor, 'X-Workspace-Id': owner, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await call('viewer', { ...input, acknowledgeUnknownOutcome: true })).status, 403)
    assert.equal((await call('editor', { ...input, acknowledgeUnknownOutcome: true, generationId: 'gen-client-injected' })).status, 400)
    assert.equal(receiptReads, 0)
    assert.equal((await call('editor', input)).status, 409)
    assert.equal(repository.studioGet(owner, 'complete_analysis', pack.id).status, 'dispatch_unknown')
    const response = await call('editor', { ...input, acknowledgeUnknownOutcome: true })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).analysis.status, 'failed')
    assert.equal(repository.studioGet(owner, 'complete_analysis', pack.id).recovery.recoveredBy, 'editor')
    assert.equal(repository.budgetGet(owner, value.jobId).status, 'dispatch_unknown')
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('complete input hashing is stable across JSON key reordering and tracks selected account changes', async () => {
  const { repository, pack } = fixture()
  try {
    const a = { ...context, platformAccounts: [{ platform: 'Instagram', accountId: 'account-one' }] }
    const b = Object.fromEntries(Object.entries(a).reverse())
    assert.equal(completeInputHash(pack, a), completeInputHash(pack, b))
    const profile = { accountId: 'account-one', platform: 'Instagram', audience: 'Professionals', tone: 'Clear' }
    assert.notEqual(completeInputHash(pack, a, [profile]), completeInputHash(pack, a, [{ ...profile, audience: 'Students' }]))
  } finally { repository.close() }
})

test('context rejects cross-account metrics, credential URLs, forged attestations and duplicate measurements', () => {
  const metric = { observationId: 'first', accountId: 'account-one', postId: 'post-one', platform: 'Instagram', format: 'image', distribution: 'organic', publishedAt: '2026-11-01T00:00:00Z', measuredAt: '2026-11-02T00:00:00Z', source: { kind: 'manual', label: 'Reported observation' }, metrics: { reach: 100, shares: 2 } }
  assert.equal(completeContextSchema.safeParse({ accountId: 'another-account', metrics: [metric] }).success, false)
  assert.equal(completeContextSchema.safeParse({ assetReferences: [{ id: 'asset', url: 'https://user:password@example.com/image', role: 'reference', rightsNote: 'Unverified' }] }).success, false)
  assert.equal(completeContextSchema.safeParse({ attestations: { legallyCertified: true } }).success, false)
  assert.equal(completeContextSchema.safeParse({ accountId: 'account-one', metrics: [metric, { ...metric, observationId: 'second', metrics: { reach: 200 } }] }).success, false)
  assert.equal(completeContextSchema.safeParse({ platformAccounts: [{ platform: 'Instagram', accountId: 'account-one' }], platformAttestations: [{ platform: 'Instagram', accountId: 'account-two', attestations: { connectorFormatVerified: true } }] }).success, false)
})

test('one durable analysis is admitted once and cannot be consumed by the research/content worker', async () => {
  const { repository, pack, owner } = fixture()
  let resolveProvider; let notifyEntered
  const entered = new Promise(resolve => { notifyEntered = resolve })
  const wait = new Promise(resolve => { resolveProvider = resolve })
  let calls = 0
  const generate = async request => { calls++; notifyEntered(); await wait; return result(request) }
  try {
    const input = await inputFor(repository, owner, pack)
    const first = analyzeCompletePackage({ repository, owner, actor: owner, pack, input, generate, config })
    await entered
    const job = repository.studioJobGet(owner, `complete-analysis:${input.requestId}`)
    assert.equal(job.status, 'running'); assert.notEqual(job.ready, true)
    assert.deepEqual(await runPendingContentJobs(repository, { generate: () => { throw Error('Wrong worker consumed analysis') } }), [])
    const duplicate = await analyzeCompletePackage({ repository, owner, actor: owner, pack, input, generate, config })
    assert.equal(duplicate.status, 202); assert.equal(calls, 1)
    resolveProvider()
    const completed = await first
    assert.equal(completed.status, 200); assert.equal(completed.body.analysis.status, 'completed')
    assert.equal((await analyzeCompletePackage({ repository, owner, actor: owner, pack, input, generate, config })).status, 200)
    assert.equal(calls, 1)
    assert.equal(repository.budgetGet(owner, job.id).status, 'dispatch_unknown', 'No invoice receipt was invented from a zero-price ceiling')
  } finally { resolveProvider(); repository.close() }
})

test('an uncertain provider outcome stays durable and prevents blind replacement requests', async () => {
  const { repository, pack, owner } = fixture()
  let calls = 0
  const generate = async () => { calls++; throw Object.assign(new Error('Controlled timeout'), { code: 'MODEL_TIMEOUT' }) }
  try {
    const input = await inputFor(repository, owner, pack)
    const failure = await analyzeCompletePackage({ repository, owner, actor: owner, pack, input, generate, config })
    assert.equal(failure.status, 502); assert.equal(failure.body.completePackage.analysis.status, 'dispatch_unknown')
    await assert.rejects(analyzeCompletePackage({ repository, owner, actor: owner, pack, input: { ...input, requestId: randomUUID() }, generate, config }), { status: 409 })
    assert.equal(calls, 1)
  } finally { repository.close() }
})

test('incomplete analysis retains only safe provider diagnostics and still blocks blind retries', async () => {
  const { repository, pack, owner } = fixture()
  try {
    const generate = async () => { throw Object.assign(new Error('private provider response'), { code: 'MODEL_INCOMPLETE', generationId: 'gen-123-safe', finishReason: 'error', transportStatus: 200, providerErrorCode: 503, raw: 'private provider body', apiKey: 'private credential' }) }
    const input = await inputFor(repository, owner, pack)
    const outcome = await analyzeCompletePackage({ repository, owner, actor: owner, pack, input, generate, config })
    assert.equal(outcome.body.completePackage.analysis.status, 'dispatch_unknown')
    const saved = repository.studioGet(owner, 'complete_analysis', pack.id)
    assert.deepEqual(saved.diagnostics, { code: 'MODEL_INCOMPLETE', generationId: 'gen-123-safe', finishReason: 'error', transportStatus: 200, providerErrorCode: 503 })
    assert.equal(JSON.stringify(saved).includes('private'), false)
    assert.equal(repository.budgetGet(owner, `complete-analysis:${input.requestId}`).status, 'dispatch_unknown')
    await assert.rejects(analyzeCompletePackage({ repository, owner, actor: owner, pack, input: { ...input, requestId: randomUUID() }, generate, config }), { status: 409 })
  } finally { repository.close() }
})

test('a response cannot attach AI decisions after the context changes during the provider call', async () => {
  const { repository, pack, owner } = fixture()
  try {
    const input = await inputFor(repository, owner, pack)
    const outcome = await analyzeCompletePackage({ repository, owner, actor: owner, pack, input, config, generate: async request => {
      repository.studioPut(owner, 'complete_context', pack.id, { context: { ...context, objective: 'Changed after dispatch' } }, 1)
      return result(request)
    } })
    assert.equal(outcome.status, 502)
    assert.equal(outcome.body.completePackage.analysis.stale, true)
    assert.equal(outcome.body.completePackage.decisions.length, 0)
    assert.equal(repository.studioGet(owner, 'complete_analysis', pack.id).result, null)
    assert.equal(repository.studioGet(owner, 'package', pack.id).revision, pack.revision)
  } finally { repository.close() }
})

test('a provider response with fabricated evidence references is rejected and cannot yield ready prompts', async () => {
  const { repository, pack, owner } = fixture()
  try {
    const outcome = await analyzeCompletePackage({ repository, owner, actor: owner, pack, input: await inputFor(repository, owner, pack), config, generate: async request => {
      const response = result(request); response.decisions[0].evidenceIds = ['invented-source']; return response
    } })
    assert.equal(outcome.status, 502)
    assert.equal(outcome.body.completePackage.analysis.status, 'failed')
    assert.ok(outcome.body.completePackage.prompts.every(item => item.status !== 'ready'))
    assert.equal(repository.studioGet(owner, 'package', pack.id).content.strategy.platforms[0].headline, 'Limited preview [C1]')
  } finally { repository.close() }
})

test('shared-workspace read access does not grant context writes or complete-package downloads', async () => {
  const workspace = `ws:${randomUUID()}`
  const { repository, pack } = fixture(workspace)
  repository.studioPut('__workspace_control__', 'workspace', workspace, { members: [{ uid: 'alice', role: 'owner' }, { uid: 'bob', role: 'viewer' }, { uid: 'carol', role: 'editor' }] }, 0)
  let assessments = 0
  const app = express(); app.use(express.json()); app.use(createCompletePackageRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization }; next() }, assessDownload: async (_repository, _owner, _pack, options) => { assessments++; assert.deepEqual(options, { requireApproval: false, policy: 'owner-download' }); return { eligible: true } } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (actor, suffix = '', method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/packages/${pack.id}/complete-package${suffix}`, { method, headers: { Authorization: actor, 'X-Workspace-Id': workspace, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    assert.equal((await call('bob')).status, 200)
    assert.equal((await call('bob', '/context', 'PUT', { expectedRevision: 1, context })).status, 403)
    assert.equal((await call('carol', '/download')).status, 403)
    assert.equal(assessments, 0)
    assert.equal((await call('alice', '/download')).status, 200)
    assert.equal(assessments, 1)
    assert.equal((await call('alice', '/context', 'PUT', { expectedRevision: 0, context })).status, 409)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('account-specific attestations never propagate from one platform to another', async () => {
  const { repository, pack, owner } = fixture()
  try {
    repository.studioPut(owner, 'account_profile', 'instagram', { accountId: 'account-one', platform: 'Instagram' }, 0)
    repository.studioPut(owner, 'complete_context', pack.id, { context: { ...context, platformAccounts: [{ platform: 'Instagram', accountId: 'account-one' }], attestations: { connectorFormatVerified: true, accountConnectionVerified: true, rightsConfirmed: true } } }, 1)
    const complete = await buildCompletePackage(repository, owner, pack)
    assert.equal(complete.rules[0].checks.find(item => item.id === 'connector').status, 'needs_review')
    assert.equal(complete.rules[0].checks.find(item => item.id === 'rights').status, 'confirmed')
  } finally { repository.close() }
})

test('website planning fields validate URLs and preserve supplied metadata without claiming publication', async () => {
  const website = { slug: 'limited-model-preview', seoTitle: 'A limited model preview explained', metaDescription: 'An attributed overview of the publisher announcement.', canonicalUrl: 'https://example.com/articles/limited-model-preview', internalLinks: [{ label: 'More AI explainers', url: 'https://example.com/ai' }], heroAlt: 'An illustrative diagram labelled limited model preview.', heroAspectRatio: '16:9' }
  assert.equal(completeContextSchema.safeParse({ website }).success, true)
  for (const unsafe of [{ canonicalUrl: 'javascript:alert(1)' }, { internalLinks: [{ label: 'Unsafe', url: 'https://user:password@example.com/' }] }, { slug: '../private' }, { heroAspectRatio: 'execute arbitrary instructions' }, { canonicalUrl: 'https://example.com/', verified: true }]) assert.equal(completeContextSchema.safeParse({ website: unsafe }).success, false)
  const { repository, pack, owner } = fixture()
  try {
    const article = repository.studioPut(owner, 'package', pack.id, { ...pack, settings: { ...pack.settings, outputs: ['platforms', 'website'] }, content: { ...pack.content, website: { title: 'A limited preview', body: 'The publisher announced a limited preview [C1].' } } }, pack.revision)
    repository.studioPut(owner, 'complete_context', pack.id, { context: { ...context, website } }, 1)
    const completed = await analyzeCompletePackage({ repository, owner, actor: owner, pack: article, input: await inputFor(repository, owner, article), config, generate: async request => result(request) })
    assert.equal(completed.status, 200)
    const complete = completed.body
    const section = complete.sections.find(item => item.id === 'website')
    assert.equal(section.status, 'partial')
    assert.equal(section.value.slug, website.slug)
    assert.equal(section.value.metadata.seoTitle, website.seoTitle)
    assert.equal(section.value.metadata.provenance, 'reported_unverified')
    assert.equal(section.value.internalLinks[0].url, website.internalLinks[0].url)
    assert.equal(section.value.publication.status, 'unavailable')
    const hero = complete.prompts.find(item => item.kind === 'website-hero')
    assert.equal(hero.settings.aspectRatio, '16:9')
    assert.match(hero.prompt, /Website hero canvas: 16:9/)
    assert.ok(!hero.prompt.includes('Canvas: 4:5'), 'Social canvas is not reused for the article hero')
    assert.match(hero.prompt, /illustrative diagram labelled limited model preview/)
    assert.equal(hero.status, 'ready', 'Only the prompt is ready, not a generated image or published article')
    repository.studioPut(owner, 'complete_context', pack.id, { context: { ...context, website: { ...website, metaDescription: 'A revised supplied description.' } } }, 2)
    const changed = await buildCompletePackage(repository, owner, article)
    assert.equal(changed.analysis.stale, true)
    assert.equal(changed.prompts.find(item => item.kind === 'website-hero').status, 'partial')
  } finally { repository.close() }
})
