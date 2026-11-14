import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'
import { settingsSchema } from '../studio/content.js'

test('owner exports without a reviewer, recomputes validation, and preserves access/source/job gates', async () => {
  const repository = createRepository(':memory:')
  const evidence = [{ id: 'E1', url: 'https://example.com/preview', title: 'Preview', publisher: 'Example', hash: 'original', excerpt: 'The publisher announced a limited preview for existing customers. Independent capability testing has not yet been published.', limitations: ['Publisher announcement'], retrievedAt: new Date().toISOString(), type: 'retrieved-source' }]
  const content = { website: { title: 'Limited preview [C1]', body: 'The publisher announced a limited preview for existing customers [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a limited preview for existing customers', quote: evidence[0].excerpt, evidenceId: 'E1', status: 'attributed' }] }
  const settings = settingsSchema.parse({ outputs: ['website'], platform: 'LinkedIn' })
  const fixture = { title: 'Owner content', content, evidence, settings, status: 'completed', editorialStatus: 'needs_review', createdBy: 'alice', generatedBy: 'alice', review: { issues: [] } }
  const save = (id, patch = {}, scope = 'alice') => repository.studioPut(scope, 'package', id, { ...fixture, ...patch }, 0)
  save('valid')
  save('bad-quote', { content: { ...content, claims: [{ ...content.claims[0], quote: 'This invented quotation is absent from the evidence.' }] }, assurance: { checks: [{ status: 'passed' }] } })
  save('uncertain', { status: 'dispatch_unknown' })
  save('running', { status: 'generating' })
  save('changed-source', { review: { issues: ['Source text changed. Recheck saved content.'] } })
  repository.studioPut('alice', 'library_source', 'reference', { reviewStatus: 'rejected', evidence: evidence[0] }, 0)
  save('rejected-reference', { sourceIds: ['reference'] })
  const scope = 'ws:22222222-2222-4222-8222-222222222222'
  repository.studioPut('__workspace_control__', 'workspace', scope, { name: 'Owner tool', members: [{ uid: 'alice', role: 'owner' }, { uid: 'editor', role: 'editor' }] }, 0)
  save('shared', {}, scope)
  let externalReads = 0
  const app = express(); app.use(express.json())
  app.use(studioRouter({ repository, auth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization, role: 'user' }; next() }, fetchSource: async () => { externalReads++; throw new Error('Owner export must use saved evidence, not start research.') } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (id, actor = 'alice', workspace = 'personal') => fetch(`http://127.0.0.1:${server.address().port}/packages/${id}/export`, { headers: { Authorization: actor, 'X-Workspace-Id': workspace } })
  try {
    const result = await call('valid'); assert.equal(result.status, 200)
    const exported = await result.json()
    assert.equal(exported.manifest.releasePolicy, 'owner-download-v1')
    assert.equal(exported.manifest.downloadedBy, 'alice')
    assert.equal(exported.manifest.reviewerId, undefined)
    assert.equal(exported.manifest.quality, undefined)
    assert.equal(exported.manifest.assurance.assessment.eligible, true)
    assert.ok(exported.manifest.assurance.assessment.checks.filter(check => check.method === 'human').every(check => check.status === 'unknown'), 'no fabricated human or expert approval')
    assert.equal(repository.studioGet('alice', 'package', 'valid').revision, exported.package.revision, 'download does not change the draft or approve it')
    assert.equal((await call('valid', 'outsider')).status, 404)
    for (const id of ['bad-quote', 'uncertain', 'running', 'changed-source']) assert.equal((await call(id)).status, 409, id)
    assert.equal((await call('rejected-reference')).status, 409)
    assert.equal((await call('shared', 'editor', scope)).status, 403)
    assert.equal((await call('shared', 'alice', scope)).status, 200)
    assert.equal(externalReads, 0, 'no generation or new source fetch during export')
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
