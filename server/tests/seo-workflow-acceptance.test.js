import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createCompletePackageRouter } from '../studio/complete-package-router.js'
import { decisionParameters } from '../studio/complete-package.js'
import { contentHash } from '../studio/approval.js'
import { platforms } from '../studio/content.js'
import { auditSeoPage } from '../studio/seo-workflow.js'

const capturedAt = new Date().toISOString()
const source = { id: 'E1', url: 'https://example.com/announcement', title: 'Controlled announcement', publisher: 'example.com', excerpt: 'The publisher announced a limited model preview.', retrievedAt: capturedAt, type: 'retrieved-source' }
const seo = () => ({
  version: 'website-seo-v1', enabled: true, siteUrl: 'https://example.com/',
  business: { objectives: 'Explain the evidence behind AI releases.', audience: 'AI learners', industry: 'AI' },
  pages: [{ id: 'article', url: 'https://example.com/preview', purpose: 'Explain limited preview availability.', primaryKeywordId: 'preview', supportingKeywordIds: [], cluster: 'AI releases', action: 'create', rationale: 'A source-backed answer to an audience question.' }],
  keywords: [{ id: 'preview', phrase: 'limited model preview', intent: 'informational', role: 'primary', provider: 'Controlled research observation', sourceUrl: source.url, observedAt: capturedAt, region: 'Global', period: 'Current source snapshot' }],
  competitors: [], research: [{ id: 'official', url: source.url, kind: 'official', observation: 'The announcement describes a limited preview.', observedAt: capturedAt }],
  outline: [{ id: 'heading', level: 1, text: 'Understand the limited model preview', researchIds: ['official'] }],
  calendar: [{ id: 'slot', pageId: 'article', dueDate: capturedAt.slice(0, 10), owner: 'Content desk', status: 'writing' }],
  metrics: [], decisions: [],
})

async function fixture(run, outputs = ['website', 'platforms']) {
  const repository = createRepository(':memory:')
  const body = 'The publisher announced a limited model preview [C1].'
  const pack = repository.studioPut('alice', 'package', 'seo-acceptance', {
    title: 'Limited model preview', status: 'completed', createdBy: 'alice',
    settings: { industry: 'AI', audience: 'AI learners', language: 'English', tone: 'Clear', platform: platforms.join(','), duration: 30, outputs },
    evidence: [source], review: { issues: [] },
    content: { website: { title: 'A limited preview', body }, claims: [{ id: 'C1', text: 'The publisher announced a limited model preview', evidenceId: 'E1', quote: source.excerpt, status: 'attributed' }], strategy: { angle: 'Explain the limitations', platforms: platforms.map(platform => ({ platform, headline: body, hook: body, body, format: 'post', cta: 'Read the original source.' })) } },
  }, 0)
  for (const platform of platforms) repository.studioPut('alice', 'account_profile', platform, { platform, accountId: `seo-${platform}`, audience: 'AI learners', tone: 'Clear' }, 0)
  let calls = 0; let audits = 0; let analysisInput; let onAudit; let onGenerate
  const app = express(); app.use(express.json())
  app.use('/api/studio', createCompletePackageRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice' }; next() }, assessDownload: async () => ({ eligible: true }), auditPage: async url => {
    audits++; if (onAudit) await onAudit()
    return auditSeoPage(url, { fetchPage: async () => ({ url: new URL(url), headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html><head><title>Controlled preview</title></head><body><h1>Preview</h1></body></html>' }) })
  }, config: { STUDIO_DAILY_GENERATIONS: 10, LLM_MODEL: 'nvidia/controlled-seo:free' }, generate: async request => {
    calls++; analysisInput = request.input
    if (onGenerate) await onGenerate()
    return { summary: 'Controlled five-platform analysis; not live publishing evidence.', decisions: request.input.selectedPlatforms.flatMap(platform => decisionParameters.map(parameter => ({ id: `${platform}-${parameter}`, platform, parameter, value: 'Controlled hypothesis', method: 'hypothesis', evidenceIds: [], metricIds: [], rationale: 'No measured response is claimed.', alternatives: [], confidence: 'low', missing: ['Live performance evidence is unavailable.'] }))) }
  } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (suffix = '', method = 'GET', body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/api/studio/packages/${pack.id}/complete-package${suffix}`, { method, headers: { Authorization: actor, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try { await run({ repository, pack, call, calls: () => calls, audits: () => audits, onAudit: callback => { onAudit = callback }, onGenerate: callback => { onGenerate = callback }, analysisInput: () => analysisInput }) } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
}

test('website SEO and all five social destinations survive HTTP save, analysis and internal export with missing metrics preserved', () => fixture(async ({ repository, pack, call, calls, analysisInput }) => {
  const originalHash = contentHash(pack)
  const context = { seoWorkflow: seo(), platformAccounts: platforms.map(platform => ({ platform, accountId: `seo-${platform}` })) }
  let response = await call('/context', 'PUT', { expectedRevision: 0, context })
  assert.equal(response.status, 200, await response.clone().text())
  let complete = await response.json()
  assert.equal(complete.context.seoWorkflow.pages[0].primaryKeywordId, 'preview')
  assert.equal(complete.context.seoWorkflow.keywords[0].volume, undefined)
  assert.equal(complete.context.seoWorkflow.keywords[0].difficulty, undefined)
  assert.equal(complete.context.seoWorkflow.keywords[0].cpc, undefined)
  assert.equal(calls(), 0, 'Saving strategy cannot spend, infer keyword data or publish')
  assert.deepEqual(new Set(complete.platforms.filter(row => row.selected).map(row => row.platform)), new Set(platforms))
  response = await call('/analyze', 'POST', { requestId: randomUUID(), contentHash: complete.contentHash, contextRevision: complete.contextRevision })
  assert.equal(response.status, 200, await response.clone().text())
  complete = await response.json()
  assert.equal(complete.analysis.status, 'completed'); assert.equal(calls(), 1)
  assert.equal(analysisInput().context.seoWorkflow.keywords[0].intent, 'informational')
  assert.deepEqual(analysisInput().evidence.map(item => item.id), ['E1'], 'Workspace SEO research does not become captured factual evidence')
  response = await call('/download')
  assert.equal(response.status, 200, await response.clone().text())
  const exported = await response.json()
  assert.equal(exported.completePackage.context.seoWorkflow.outline[0].researchIds[0], 'official')
  assert.equal(exported.completePackage.context.seoWorkflow.calendar[0].pageId, 'article')
  assert.ok(exported.completePackage.seoWorkflow, 'SEO assessment is included in the same complete-package handoff')
  assert.equal(contentHash(repository.studioGet('alice', 'package', pack.id)), originalHash)
  assert.equal((await call('', 'GET', undefined, 'outsider')).status, 404)
  assert.equal((await call('/context', 'PUT', { expectedRevision: 0, context })).status, 409, 'Stale saves cannot overwrite a newer SEO strategy')
  response = await call('/context', 'PUT', { expectedRevision: complete.contextRevision, context: { ...context, seoWorkflow: { ...context.seoWorkflow, business: { ...context.seoWorkflow.business, objectives: 'A changed business goal requires fresh analysis.' } } } })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).analysis.status, 'stale')
}))

test('invalid SEO references fail at the same HTTP boundary and do not alter the saved social package', () => fixture(async ({ repository, pack, call }) => {
  for (const mutation of [
    value => { value.pages[0].primaryKeywordId = 'missing-keyword' },
    value => { value.outline[0].researchIds = ['missing-research'] },
    value => { value.calendar[0].pageId = 'missing-page' },
    value => { value.keywords[0].volume = -1 },
    value => { value.keywords[0].difficulty = 101 },
  ]) {
    const value = seo(); mutation(value)
    const response = await call('/context', 'PUT', { expectedRevision: 0, context: { seoWorkflow: value } })
    assert.equal(response.status, 400, await response.clone().text())
    assert.equal(repository.studioGet('alice', 'complete_context', pack.id), null)
  }
}))

test('existing social-only packages remain readable and exportable without opting into SEO', () => fixture(async ({ call }) => {
  let response = await call('/context', 'PUT', { expectedRevision: 0, context: { objective: 'Explain a source-backed release on social channels.' } })
  assert.equal(response.status, 200, await response.clone().text())
  const complete = await response.json()
  assert.equal(complete.context.seoWorkflow, undefined)
  assert.equal(complete.platforms.filter(row => row.selected).length, 5)
  response = await call('/download'); assert.equal(response.status, 200)
}), ['platforms'])

test('public page audit is owner-scoped, revision-bound and cannot retrieve an unmapped or private target', () => fixture(async ({ call, audits }) => {
  let response = await call('/context', 'PUT', { expectedRevision: 0, context: { seoWorkflow: seo() } })
  assert.equal(response.status, 200)
  const complete = await response.json()
  const input = { expectedRevision: complete.contextRevision, pageUrl: 'https://example.com/preview' }
  assert.equal((await call('/seo-audit', 'POST', input, 'outsider')).status, 404)
  assert.equal((await call('/seo-audit', 'POST', { ...input, expectedRevision: complete.contextRevision + 1 })).status, 409)
  assert.equal((await call('/seo-audit', 'POST', { ...input, pageUrl: 'https://example.com/unmapped' })).status, 422)
  assert.equal((await call('/seo-audit', 'POST', { ...input, pageUrl: 'https://127.0.0.1/preview' })).status, 422)
  assert.equal(audits(), 0, 'Rejected requests cannot send an outbound page fetch')
  response = await call('/seo-audit', 'POST', input)
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  assert.equal(audits(), 1)
  assert.equal(result.seoWorkflow.audits.length, 1)
  assert.equal(result.seoWorkflow.audits[0].pageUrl, input.pageUrl)
  assert.equal(result.seoWorkflow.audits[0].current, true)
  assert.equal(result.seoWorkflow.audits[0].provenance, 'server_public_html_capture')
  response = await call('/context', 'PUT', { expectedRevision: result.contextRevision, context: { ...result.context, website: { seoTitle: 'A changed supplied SEO title' } } })
  assert.equal(response.status, 200)
  const changed = await response.json()
  assert.equal(changed.seoWorkflow.audits.length, 1, 'Original capture remains available as history')
  assert.equal(changed.seoWorkflow.audits[0].current, false, 'Changed supplied metadata needs a fresh matching review')
}))

test('a context change during the public HTML read cannot save a current audit against a new strategy', () => fixture(async ({ repository, pack, call, onAudit }) => {
  let response = await call('/context', 'PUT', { expectedRevision: 0, context: { seoWorkflow: seo() } })
  assert.equal(response.status, 200)
  const complete = await response.json()
  onAudit(() => {
    const record = repository.studioGet('alice', 'complete_context', pack.id)
    repository.studioPut('alice', 'complete_context', pack.id, { ...record, context: { ...record.context, seoWorkflow: { ...record.context.seoWorkflow, business: { ...record.context.seoWorkflow.business, objectives: 'Changed during capture' } } } }, record.revision)
  })
  response = await call('/seo-audit', 'POST', { expectedRevision: complete.contextRevision, pageUrl: 'https://example.com/preview' })
  assert.equal(response.status, 409, await response.clone().text())
  const current = await (await call()).json()
  assert.ok(current.seoWorkflow.audits.every(audit => !audit.current), 'No stale capture is labelled current')
}))

test('AI analysis consumes current server HTML facts and a new audit invalidates the previous analysis', () => fixture(async ({ call, analysisInput }) => {
  let response = await call('/context', 'PUT', { expectedRevision: 0, context: { seoWorkflow: seo() } })
  assert.equal(response.status, 200)
  let complete = await response.json()
  const auditInput = { expectedRevision: complete.contextRevision, pageUrl: 'https://example.com/preview' }
  response = await call('/seo-audit', 'POST', auditInput)
  assert.equal(response.status, 200, await response.clone().text())
  complete = await response.json()
  response = await call('/analyze', 'POST', { requestId: randomUUID(), contentHash: complete.contentHash, contextRevision: complete.contextRevision })
  assert.equal(response.status, 200, await response.clone().text())
  complete = await response.json()
  assert.equal(complete.analysis.status, 'completed')
  assert.equal(analysisInput().websiteSeo.audits[0].title, 'Controlled preview')
  assert.equal(analysisInput().websiteSeo.audits[0].provenance, 'server_public_html_capture')
  assert.equal(analysisInput().websiteSeo.audits[0].capturedBy, undefined, 'Actor identifiers are not AI page facts')
  const previousInputHash = complete.inputHash
  response = await call('/seo-audit', 'POST', auditInput)
  assert.equal(response.status, 200, await response.clone().text())
  complete = await response.json()
  assert.equal(complete.contextRevision, auditInput.expectedRevision, 'A new observation does not rewrite saved strategy')
  assert.notEqual(complete.inputHash, previousInputHash)
  assert.equal(complete.analysis.status, 'stale')
}))

test('an audit record changed during AI generation cannot complete analysis against the earlier HTML facts', () => fixture(async ({ repository, call, onGenerate }) => {
  let response = await call('/context', 'PUT', { expectedRevision: 0, context: { seoWorkflow: seo() } })
  assert.equal(response.status, 200)
  let complete = await response.json()
  response = await call('/seo-audit', 'POST', { expectedRevision: complete.contextRevision, pageUrl: 'https://example.com/preview' })
  assert.equal(response.status, 200)
  complete = await response.json()
  onGenerate(() => {
    const audit = repository.studioList('alice', 'seo_audit')[0]
    repository.studioPut('alice', 'seo_audit', audit.id, { ...audit, responseHash: 'changed-during-analysis' }, audit.revision)
  })
  response = await call('/analyze', 'POST', { requestId: randomUUID(), contentHash: complete.contentHash, contextRevision: complete.contextRevision })
  assert.equal(response.status, 502, await response.clone().text())
  const result = await response.json()
  assert.notEqual(result.completePackage.analysis.status, 'completed')
  assert.equal(result.completePackage.decisions.length, 0, 'Rejected stale analysis cannot supply production decisions')
}))
