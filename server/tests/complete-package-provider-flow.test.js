import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { contentHash } from '../studio/approval.js'
import { createCompletePackageMetricsRouter, parseProviderPostAnalytics } from '../studio/complete-package-metrics-router.js'
import { prepareAutomaticCompletePackage } from '../studio/complete-package-automation.js'
import { buildCompletePackage, completeInputHash } from '../studio/complete-package.js'
import { runContentJob } from '../studio/job-worker.js'
import { studioRouter } from '../studio/routes.js'

const platforms = ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']
const fixedNow = new Date('2026-11-11T12:00:00.000Z')
const series = [{ label: 'Views', data: [{ total: '150', date: '2026-11-10', secret: 'do-not-store' }, { total: null, date: '2026-11-11' }], percentageChange: null, authorization: 'do-not-store' }]

async function metricsFixture(run) {
  const repository = createRepository(':memory:')
  const owner = 'ws:11111111-1111-4111-8111-111111111111'
  let control = repository.studioPut('__workspace_control__', 'workspace', owner, { members: [{ uid: 'alice', role: 'owner' }, { uid: 'editor', role: 'editor' }, { uid: 'viewer', role: 'viewer' }] }, 0)
  const pack = repository.studioPut(owner, 'package', 'metrics-pack', { content: { script: 'A supported preview.' }, settings: { platform: platforms.join(',') }, evidence: [] }, 0)
  const accounts = platforms.map(platform => ({ platform, accountId: `account-${platform}`, ownerScope: owner }))
  const config = { enabled: true, accounts, serverKey: 'never-return-this-key' }
  const publications = platforms.map(platform => repository.studioPut(owner, 'social_publication', `receipt-${platform}`, { packageId: pack.id, platform, accountId: `account-${platform}`, status: 'published', providerState: 'PUBLISHED', providerPostId: `native-${platform}`, releaseUrl: `https://example.com/${platform}`, contentHash: contentHash(pack) }, 0))
  let reads = 0; let respond = async () => series
  const app = express(); app.use(express.json())
  app.use(createCompletePackageMetricsRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice' }; next() }, provider: { async postAnalytics(postId, days) { reads++; return respond(postId, days) } }, config: () => config, now: () => fixedNow }))
  app.use((_error, _req, res, _next) => res.status(500).json({ error: 'Unexpected test error' }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (suffix = '/config', body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/packages/${pack.id}/complete-package/metrics${suffix}`, { method: body ? 'POST' : 'GET', headers: { Authorization: actor, 'X-Workspace-Id': owner, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const revokeEditor = () => { control = repository.studioPut('__workspace_control__', 'workspace', owner, { ...control, members: control.members.filter(member => member.uid !== 'editor') }, control.revision) }
  try { await run({ repository, owner, pack, publications, config, call, reads: () => reads, respond: fn => { respond = fn }, revokeEditor }) } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
}

test('authenticated analytics HTTP flow covers all five receipts and caches sanitized raw series', () => metricsFixture(async ({ repository, owner, pack, publications, call, reads }) => {
  const configResponse = await call(); assert.equal(configResponse.status, 200)
  const configuration = await configResponse.json(); assert.equal(configuration.eligiblePublications.length, 5)
  assert.equal(JSON.stringify(configuration).includes('never-return-this-key'), false)
  assert.equal(reads(), 0)
  for (const publication of publications) {
    let response = await call('/sync', { publicationId: publication.id, days: 7 }); assert.equal(response.status, 200, await response.clone().text())
    const { snapshot, cached } = await response.json()
    assert.equal(cached, false); assert.equal(snapshot.platform, publication.platform)
    assert.equal(snapshot.normalization, 'raw_series_only'); assert.equal(snapshot.series[0].data[0].total, '150')
    assert.equal(snapshot.series[0].data[1].total, null); assert.equal(snapshot.series[0].percentageChange, null)
    assert.equal(JSON.stringify(snapshot).includes('do-not-store'), false)
    assert.equal(snapshot.source.kind, 'provider_read'); assert.equal(snapshot.status, 'available')
    response = await call('/sync', { publicationId: publication.id, days: 7 }); assert.equal((await response.json()).cached, true)
  }
  assert.equal(reads(), 5)
  assert.equal(repository.studioList(owner, 'complete_provider_metrics').length, 5)
  repository.studioPut(owner, 'complete_context', pack.id, { context: { platformAccounts: publications.map(({ platform, accountId }) => ({ platform, accountId })) } }, 0)
  const complete = await buildCompletePackage(repository, owner, pack, fixedNow)
  assert.equal(complete.analytics.providerSnapshots.length, 5)
  for (const snapshot of complete.analytics.providerSnapshots) {
    assert.equal(snapshot.publishedContentHash, contentHash(pack))
    assert.equal(snapshot.releaseUrl, `https://example.com/${snapshot.platform}`)
    assert.match(snapshot.reason, /Provider-returned daily series/)
    assert.equal(snapshot.requestedBy, undefined, 'Actor identity is not part of the public-safe analytics projection')
  }
}))

test('analytics rejects disabled configuration, foreign mappings, viewer and outsider without provider reads', () => metricsFixture(async ({ config, call, reads }) => {
  assert.equal((await call('/sync', { publicationId: 'receipt-X' }, 'viewer')).status, 403)
  assert.equal((await call('/sync', { publicationId: 'receipt-X' }, 'outsider')).status, 403)
  config.enabled = false
  assert.equal((await call('/config')).status, 200)
  assert.equal((await call('/sync', { publicationId: 'receipt-X' })).status, 503)
  config.enabled = true; config.accounts = config.accounts.filter(account => account.platform !== 'X')
  assert.equal((await call('/sync', { publicationId: 'receipt-X' })).status, 422)
  assert.equal((await call('/sync', { publicationId: 'receipt-YouTube', days: 8 })).status, 422)
  assert.equal(reads(), 0)
}))

test('changed receipt association cannot reuse a cached native-post series', () => metricsFixture(async ({ repository, owner, publications, call, reads }) => {
  await call('/sync', { publicationId: 'receipt-X' })
  const receipt = publications[0]
  repository.studioPut(owner, 'social_publication', receipt.id, { ...receipt, providerPostId: 'replacement-native-X' }, receipt.revision)
  const response = await call('/sync', { publicationId: receipt.id }); assert.equal(response.status, 200)
  const value = await response.json(); assert.equal(value.cached, false); assert.equal(value.snapshot.providerPostId, 'replacement-native-X')
  assert.equal(reads(), 2)
}))

test('analytics mid-read permission revocation discards the result', () => metricsFixture(async ({ repository, owner, call, respond, revokeEditor }) => {
  respond(async () => { revokeEditor(); return series })
  const response = await call('/sync', { publicationId: 'receipt-Instagram' }, 'editor')
  assert.equal(response.status, 403); assert.equal(repository.studioList(owner, 'complete_provider_metrics').length, 0)
}))

test('analytics mid-read content, receipt or account-configuration changes discard the result', async () => {
  for (const change of ['content', 'receipt', 'config']) await metricsFixture(async ({ repository, owner, pack, publications, config, call, respond }) => {
    respond(async () => {
      if (change === 'content') repository.studioPut(owner, 'package', pack.id, { ...pack, content: { script: 'Changed writing.' } }, pack.revision)
      if (change === 'receipt') repository.studioPut(owner, 'social_publication', publications[0].id, { ...publications[0], providerState: 'ERROR' }, publications[0].revision)
      if (change === 'config') config.accounts = []
      return series
    })
    const response = await call('/sync', { publicationId: 'receipt-X' })
    assert.equal(response.status, 409, change); assert.equal(repository.studioList(owner, 'complete_provider_metrics').length, 0)
  })
})

test('malformed provider data and private provider errors never save invented metrics or expose diagnostics', async () => {
  for (const invalid of [null, [{ label: 'Views', data: [{ date: '2026-11-11', total: 'NaN' }] }], [{ label: 'Views', data: [{ date: 'not-a-date', total: 1 }] }]]) await metricsFixture(async ({ repository, owner, call, respond }) => {
    respond(async () => invalid)
    const response = await call('/sync', { publicationId: 'receipt-X' }); assert.equal(response.status, 422)
    assert.equal(repository.studioList(owner, 'complete_provider_metrics').length, 0)
  })
  await metricsFixture(async ({ repository, owner, call, respond }) => {
    respond(async () => { throw new Error('private-provider-token-do-not-expose') })
    const response = await call('/sync', { publicationId: 'receipt-X' }); assert.equal(response.status, 502)
    assert.equal((await response.text()).includes('private-provider-token'), false)
    assert.equal(repository.studioList(owner, 'complete_provider_metrics').length, 0)
  })
  assert.equal(parseProviderPostAnalytics({ missing: true, token: 'secret' }).status, 'missing_release_id')
  assert.equal(parseProviderPostAnalytics([{ label: 'Views', data: [{ total: null, date: '2026-11-11' }] }]).status, 'unavailable')
})

function automaticFixture() {
  const repository = createRepository(':memory:'); const owner = 'alice'
  const pack = repository.studioPut(owner, 'package', 'automatic-pack', { settings: { platform: 'X', audience: 'Professionals', language: 'English', duration: 30 }, evidence: [], content: { script: 'Supported writing.', strategy: { platforms: [{ platform: 'X', body: 'Supported writing.' }] } } }, 0)
  const context = { autoAnalyze: true, objective: 'Explain the development.', brand: 'Approved editorial brand', productionTools: { graphics: 'Approved graphics tool' } }
  return { repository, owner, actor: owner, pack, context, save: value => repository.studioPut(owner, 'complete_context', pack.id, { context: value }) }
}

test('automatic analysis requires explicit preference and usable inputs, then binds a stable request UUID', async () => {
  const value = automaticFixture(); const requests = []
  const analyze = async input => { requests.push(input); return { body: { analysis: { status: 'completed' } } } }
  try {
    for (const patch of [{ autoAnalyze: undefined }, { autoAnalyze: false }, { objective: '' }, { brand: '' }, { productionTools: {} }]) {
      value.save({ ...value.context, ...patch })
      assert.equal((await prepareAutomaticCompletePackage({ ...value, analyze })).status, 'not_requested')
    }
    assert.equal(requests.length, 0)
    value.save(value.context)
    assert.equal((await prepareAutomaticCompletePackage({ ...value, analyze })).status, 'completed')
    await prepareAutomaticCompletePackage({ ...value, analyze })
    assert.equal(requests.length, 2); assert.equal(requests[0].input.requestId, requests[1].input.requestId)
    assert.match(requests[0].input.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/)
    value.save({ ...value.context, objective: 'A changed objective.' })
    await prepareAutomaticCompletePackage({ ...value, analyze }); assert.notEqual(requests[0].input.requestId, requests[2].input.requestId)
  } finally { value.repository.close() }
})

test('automatic analysis reuses current/in-flight attempts and safely contains storage/provider failures', async () => {
  const value = automaticFixture(); let calls = 0; const analyze = async () => { calls++; throw new Error('private provider detail') }
  try {
    value.save(value.context)
    for (const status of ['running', 'reserved', 'dispatch_unknown', 'completed']) {
      value.repository.studioPut(value.owner, 'complete_analysis', value.pack.id, { status, inputHash: completeInputHash(value.pack, value.context), result: { decisions: [] } })
      assert.equal((await prepareAutomaticCompletePackage({ ...value, analyze })).status, status)
    }
    assert.equal(calls, 0)
    value.repository.studioPut(value.owner, 'complete_analysis', value.pack.id, { status: 'failed' })
    const before = JSON.stringify(value.repository.studioGet(value.owner, 'package', value.pack.id))
    const failed = await prepareAutomaticCompletePackage({ ...value, analyze }); assert.equal(failed.status, 'blocked'); assert.equal(failed.reason.includes('private'), false)
    assert.equal(JSON.stringify(value.repository.studioGet(value.owner, 'package', value.pack.id)), before)
    const unavailable = { ...value.repository, studioGet: () => { throw new Error('private storage detail') } }
    assert.equal((await prepareAutomaticCompletePackage({ ...value, repository: unavailable, analyze })).status, 'blocked')
    const buildFailure = { ...value.repository, studioList: () => { throw new Error('private list detail') } }
    assert.equal((await prepareAutomaticCompletePackage({ ...value, repository: buildFailure, analyze })).status, 'blocked')
  } finally { value.repository.close() }
})

test('successful content worker invokes automatic analysis once after durable writing and preserves writing on hook failure', async () => {
  const repository = createRepository(':memory:'); let hooks = 0
  const evidence = [{ id: 'E1', hash: 'source', excerpt: 'The publisher announced a preview today. Availability is limited, and these captured source passages do not establish performance or audience reception.' }]
  const content = { script: 'The publisher announced a preview [C1].', hooks: ['A publisher preview [C1]'], claims: [{ id: 'C1', text: 'The publisher announced a preview', evidenceId: 'E1', quote: 'The publisher announced a preview today.', status: 'attributed' }] }
  const generate = async () => content
  const app = express(); app.use(express.json()); app.use(studioRouter({ repository, generate, auth: (req, _res, next) => { req.identity = { uid: 'alice' }; next() } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const draft = repository.studioPut('alice', 'package', 'hook-pack', { settings: { platform: 'X', outputs: ['script'] }, evidence, content: null, status: 'draft' }, 0)
    const response = await fetch(`http://127.0.0.1:${server.address().port}/packages/${draft.id}/generate`, { method: 'POST', headers: { Authorization: 'alice', 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'hook-request', revision: draft.revision, confirmed: true }) })
    assert.equal(response.status, 202)
    const prepareCompletePackage = async ({ pack, owner, actor }) => { hooks++; assert.equal(owner, 'alice'); assert.equal(actor, 'alice'); assert.deepEqual(pack.content, content); assert.equal(repository.studioJobGet('alice', 'hook-request').status, 'completed'); throw new Error('supplementary analysis unavailable') }
    const result = await runContentJob({ repository, uid: 'alice', requestId: 'hook-request', generate, prepareCompletePackage })
    assert.equal(result.status, 'completed'); assert.equal(hooks, 1)
    assert.deepEqual(repository.studioGet('alice', 'package', draft.id).content, content)
    assert.equal(repository.studioGet('alice', 'package', draft.id).status, 'completed')
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId: 'hook-request', generate, prepareCompletePackage })).status, 'skipped'); assert.equal(hooks, 1)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
