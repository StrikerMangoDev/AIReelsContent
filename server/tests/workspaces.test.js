import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { workspaceRouter, workspaceAuth, ownerScope, requireWriteRole, workspaceRole } from '../studio/workspaces.js'
import { studioRouter } from '../studio/routes.js'

async function fixture(run) {
  const repository = createRepository(':memory:')
  const auth = (req, res, next) => {
    if (!req.headers.authorization) return res.sendStatus(401)
    req.identity = { uid: req.headers.authorization, emailVerified: req.headers['x-verified'] !== 'false', role: 'user' }
    next()
  }
  const app = express(); app.use(express.json())
  app.use('/workspaces', workspaceRouter({ repository, auth }))
  app.use('/studio', studioRouter({ repository, auth, generate: async () => { throw new Error('No provider call is expected in workspace tests') } }))
  app.use('/content', workspaceAuth(repository, auth), requireWriteRole, (req, res) => res.json({ scope: ownerScope(req), uid: req.identity.uid, actor: req.actor.uid, role: req.workspace.role }))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, { uid = 'alice', method = 'GET', body, workspace, actor, verified = true } = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: uid, 'content-type': 'application/json', 'x-verified': String(verified), ...(actor ? { 'x-actor-id': actor } : {}), ...(workspace ? { 'x-workspace-id': workspace } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try { await run(repository, call) } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
}

test('personal scope preserves legacy owner and shared memberships cannot be spoofed or reused after revocation', async () => fixture(async (repo, call) => {
  assert.deepEqual(await (await call('/content')).json(), { scope: 'alice', uid: 'alice', actor: 'alice', role: 'owner' })
  assert.equal((await call('/content', { workspace: 'bob' })).status, 403)
  assert.equal((await call('/content', { uid: 'bob', actor: 'alice' })).status, 409)
  assert.equal((await call('/workspaces', { uid: 'bob', actor: 'alice' })).status, 409)
  assert.equal((await call('/content', { uid: 'ws:reserved' })).status, 403)
  const requestId = randomUUID()
  const workspace = await (await call('/workspaces', { method: 'POST', body: { name: 'Editorial team', requestId } })).json()
  assert.equal((await call('/workspaces', { method: 'POST', body: { name: 'Editorial team', requestId } })).status, 200)
  assert.equal((await call('/content', { uid: 'bob', workspace: workspace.id })).status, 403)
  assert.equal((await call(`/workspaces/${workspace.id}/invitations`, { uid: 'bob', method: 'POST', body: { targetUid: 'bob', role: 'owner', revision: workspace.revision } })).status, 403)
  let current = await (await call(`/workspaces/${workspace.id}`)).json()
  const invite = await (await call(`/workspaces/${workspace.id}/invitations`, { method: 'POST', body: { targetUid: 'bob', role: 'viewer', revision: current.revision } })).json()
  assert.equal((await call(`/workspaces/${workspace.id}/invitations/${invite.id}/accept`, { uid: 'charlie', method: 'POST', body: {} })).status, 403)
  assert.equal((await call(`/workspaces/${workspace.id}/invitations/${invite.id}/accept`, { uid: 'bob', verified: false, method: 'POST', body: {} })).status, 403)
  assert.equal((await call(`/workspaces/${workspace.id}/invitations/${invite.id}/accept`, { uid: 'bob', method: 'POST', body: {} })).status, 200)
  assert.deepEqual(await (await call('/content', { uid: 'bob', workspace: workspace.id })).json(), { scope: workspace.id, uid: 'bob', actor: 'bob', role: 'viewer' })
  assert.equal((await call('/content', { uid: 'bob', workspace: workspace.id, method: 'POST', body: {} })).status, 403)
  assert.equal((await call('/studio/usage', { uid: 'bob', workspace: workspace.id })).status, 403)
  await repo.budgetReserve(workspace.id, 'workspace-usage', 'a'.repeat(64), { currency: 'USD', upperBoundMicros: 0, priceVersion: 'fixture', priceExpiresAt: new Date(Date.now() + 60000).toISOString(), kind: 'research' })
  const sharedUsage = await call('/studio/usage', { workspace: workspace.id })
  assert.equal(sharedUsage.status, 200)
  assert.equal((await sharedUsage.json()).budget.unreconciledCount, 1)
  const personalUsage = await call('/studio/usage')
  assert.equal(personalUsage.status, 200)
  assert.equal((await personalUsage.json()).budget.unreconciledCount, 0)
  assert.equal(await workspaceRole(repo, workspace.id, 'bob'), 'viewer')
  current = await (await call(`/workspaces/${workspace.id}`)).json()
  assert.equal((await call(`/workspaces/${workspace.id}/members/bob`, { method: 'PATCH', body: { role: 'editor', revision: current.revision } })).status, 200)
  assert.equal((await call('/content', { uid: 'bob', workspace: workspace.id, method: 'POST', body: {} })).status, 200)
  current = await (await call(`/workspaces/${workspace.id}`)).json()
  assert.equal((await call(`/workspaces/${workspace.id}/members/bob`, { method: 'DELETE', body: { revision: current.revision } })).status, 200)
  assert.equal((await call('/content', { uid: 'bob', workspace: workspace.id })).status, 403)
  assert.equal(await workspaceRole(repo, workspace.id, 'bob'), null)
  assert.deepEqual((await (await call('/workspaces', { uid: 'bob' })).json()).workspaces.map(value => value.id), ['personal'])
  assert.equal((await call(`/workspaces/${workspace.id}/invitations/${invite.id}/accept`, { uid: 'bob', method: 'POST', body: {} })).status, 403)
}))

test('invitations expire or revoke and the final owner cannot be removed or demoted', async () => fixture(async (repo, call) => {
  const workspace = await (await call('/workspaces', { method: 'POST', body: { name: 'Access checks', requestId: randomUUID() } })).json()
  for (const method of ['PATCH', 'DELETE']) assert.equal((await call(`/workspaces/${workspace.id}/members/alice`, { method, body: { revision: workspace.revision, ...(method === 'PATCH' ? { role: 'viewer' } : {}) } })).status, 409)
  const invite = await (await call(`/workspaces/${workspace.id}/invitations`, { method: 'POST', body: { targetUid: 'bob', role: 'reviewer', revision: workspace.revision } })).json()
  let current = await (await call(`/workspaces/${workspace.id}`)).json()
  assert.equal((await call(`/workspaces/${workspace.id}/invitations/${invite.id}`, { method: 'DELETE', body: { revision: current.revision } })).status, 200)
  assert.equal((await call(`/workspaces/${workspace.id}/invitations/${invite.id}/accept`, { uid: 'bob', method: 'POST', body: {} })).status, 403)
  current = await (await call(`/workspaces/${workspace.id}`)).json()
  const expired = await (await call(`/workspaces/${workspace.id}/invitations`, { method: 'POST', body: { targetUid: 'bob', role: 'reviewer', revision: current.revision } })).json()
  current = await repo.studioGet('__workspace_control__', 'workspace', workspace.id)
  await repo.studioPut('__workspace_control__', 'workspace', workspace.id, { ...current, invitations: current.invitations.map(value => value.id === expired.id ? { ...value, expiresAt: '2000-01-01T00:00:00Z' } : value) }, current.revision)
  assert.equal((await call(`/workspaces/${workspace.id}/invitations/${expired.id}/accept`, { uid: 'bob', method: 'POST', body: {} })).status, 403)
  assert.equal((await (await call('/workspaces', { uid: 'bob' })).json()).invitations.length, 0)
}))

test('optional independent reviews reject contributors while creator-confirmed downloads do not depend on a reviewer', async () => fixture(async (repo, call) => {
  const workspace = await (await call('/workspaces', { method: 'POST', body: { name: 'Independent review', requestId: randomUUID() } })).json()
  for (const [uid, role] of [['bob', 'editor'], ['carol', 'editor'], ['dave', 'reviewer']]) {
    const current = await (await call(`/workspaces/${workspace.id}`)).json()
    const invite = await (await call(`/workspaces/${workspace.id}/invitations`, { method: 'POST', body: { targetUid: uid, role, revision: current.revision } })).json()
    assert.equal((await call(`/workspaces/${workspace.id}/invitations/${invite.id}/accept`, { uid, method: 'POST', body: {} })).status, 200)
  }
  const evidence = [{ id: 'E1', url: 'https://example.com', title: 'Publisher', excerpt: 'The publisher announced a preview with limited availability.', hash: 'fixture', limitations: [] }]
  const content = { website: { title: 'Preview', body: 'The publisher announced a preview [C1].' }, claims: [{ id: 'C1', text: 'Preview announced', evidenceId: 'E1', quote: 'The publisher announced a preview', status: 'attributed' }] }
  let pack = await repo.studioPut(workspace.id, 'package', 'shared-draft', { settings: { platform: 'X', outputs: ['website'] }, content, evidence, status: 'completed', editorialStatus: 'needs_review', createdBy: 'alice', generatedBy: 'alice', reviewerId: 'bob', contributorUids: ['alice'] }, 0)
  for (const uid of ['bob', 'carol']) {
    const result = await call('/studio/packages/shared-draft', { uid, workspace: workspace.id, method: 'PATCH', body: { revision: pack.revision, content } })
    assert.equal(result.status, 200)
    pack = await result.json()
  }
  assert.deepEqual(pack.contributorUids, ['alice', 'bob', 'carol'])
  const review = revision => ({ revision, claims: [{ id: 'C1', supported: true, note: 'The captured passage supports this attributed announcement.' }], rightsConfirmed: true, promiseAligned: true, freshnessConfirmed: true, contradictionsResolved: true })
  assert.equal((await call(`/studio/reviews/${workspace.id}/shared-draft`, { uid: 'bob', workspace: workspace.id, method: 'POST', body: review(pack.revision) })).status, 403)
  assert.equal((await call('/studio/packages/shared-draft/assign-reviewer', { workspace: workspace.id, method: 'POST', body: { revision: pack.revision, reviewerId: 'bob' } })).status, 422)
  pack = await (await call('/studio/packages/shared-draft/assign-reviewer', { workspace: workspace.id, method: 'POST', body: { revision: pack.revision, reviewerId: 'dave' } })).json()
  const reviewed = await call(`/studio/reviews/${workspace.id}/shared-draft`, { uid: 'dave', workspace: workspace.id, method: 'POST', body: review(pack.revision) })
  assert.equal(reviewed.status, 200); pack = await reviewed.json()
  assert.equal((await call('/studio/packages/shared-draft', { workspace: workspace.id, method: 'PATCH', body: { revision: pack.revision, editorialStatus: 'approved' } })).status, 200)
  assert.equal((await call('/studio/packages/shared-draft/export', { workspace: workspace.id })).status, 200)
  const current = await (await call(`/workspaces/${workspace.id}`)).json()
  assert.equal((await call(`/workspaces/${workspace.id}/members/dave`, { method: 'DELETE', body: { revision: current.revision } })).status, 200)
  assert.equal((await call('/studio/packages/shared-draft/export', { workspace: workspace.id })).status, 200)
  assert.equal((await call('/studio/packages/shared-draft', { uid: 'bob' })).status, 404)
}))
