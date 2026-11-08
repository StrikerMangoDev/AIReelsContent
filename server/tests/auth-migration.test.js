import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createAuthMiddleware, createHexclaveMiddleware } from '../auth/index.js'
import { createRepository } from '../storage/repository.js'
import { studioRouter } from '../studio/routes.js'
import { workspaceRouter } from '../studio/workspaces.js'

test('explicit Hexclave cutover and Firebase rollback preserve stable ownership, membership and review history without email linking', async () => {
  const repository = createRepository(':memory:')
  const legacyUid = 'legacy-firebase-editor'
  const email = 'same-address@example.test'
  const firebase = createAuthMiddleware(async token => {
    if (token !== 'firebase-owner') throw new Error('Invalid fixture token')
    return { uid: legacyUid, email, email_verified: true, admin: true }
  })
  const hexclave = createHexclaveMiddleware({ config: {
    AUTH_PROVIDER: 'hexclave', HEXCLAVE_PROJECT_ID: 'migration-fixture', HEXCLAVE_SECRET_SERVER_KEY: 'fixture-only',
    HEXCLAVE_MIGRATION_READY: 'true', HEXCLAVE_IDENTITY_MAP_JSON: JSON.stringify({ 'mapped-subject': legacyUid }),
  }, loadApp: async options => {
    assert.equal(options.projectId, 'migration-fixture')
    return { getUser: async ({ tokenStore }) => {
      const token = tokenStore.headers.authorization
      if (!['Hexclave mapped', 'Hexclave duplicate-email'].includes(token)) return null
      return { id: token === 'Hexclave mapped' ? 'mapped-subject' : 'unmapped-subject', primaryEmail: email, primaryEmailVerified: true, admin: true }
    } }
  } })
  let selected = firebase
  const auth = (req, res, next) => selected(req, res, next)
  const app = express(); app.use(express.json())
  app.get('/identity', auth, (req, res) => res.json(req.identity))
  app.use('/workspaces', workspaceRouter({ repository, auth }))
  app.use('/studio', studioRouter({ repository, auth, generate: async () => assert.fail('Migration must not invoke a provider') }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, token, { body, workspace } = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body ? 'POST' : 'GET', headers: { authorization: token, 'content-type': 'application/json', ...(workspace ? { 'x-workspace-id': workspace } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  try {
    const response = await call('/workspaces', 'Bearer firebase-owner', { body: { name: 'Preserved team', requestId: randomUUID() } })
    assert.equal(response.status, 201)
    const workspace = await response.json()
    const original = repository.studioPut(legacyUid, 'package', 'legacy-package', { title: 'Existing content', settings: {}, evidence: [], content: { claims: [] }, status: 'completed', reviewerId: 'independent-reviewer', independentReview: { status: 'passed', reviewerId: 'independent-reviewer', note: 'Historical review retained exactly' } }, 0)
    repository.studioPut(legacyUid, 'package', original.id, { ...original, title: 'Reviewed existing content' }, original.revision)
    repository.studioPut(workspace.id, 'package', 'team-package', { title: 'Shared package', status: 'draft' }, 0)
    const baseline = await (await call('/studio/packages/legacy-package', 'Bearer firebase-owner')).json()
    const history = await (await call('/studio/packages/legacy-package/history', 'Bearer firebase-owner')).json()
    assert.equal(baseline.title, 'Reviewed existing content')
    assert.equal(history.revisions.length, 2)
    assert.equal(history.revisions[0].independentReview.note, 'Historical review retained exactly')
    assert.equal((await (await call('/identity', 'Bearer firebase-owner')).json()).role, 'admin')
    selected = hexclave
    assert.equal((await call('/identity', 'Bearer firebase-owner')).status, 401)
    const migrated = await (await call('/identity', 'Hexclave mapped')).json()
    assert.equal(migrated.uid, legacyUid)
    assert.equal(migrated.role, 'user', 'Vendor admin and matching email must not infer application admin')
    assert.deepEqual(await (await call('/studio/packages/legacy-package', 'Hexclave mapped')).json(), baseline)
    assert.deepEqual(await (await call('/studio/packages/legacy-package/history', 'Hexclave mapped')).json(), history)
    const memberships = await (await call('/workspaces', 'Hexclave mapped')).json()
    assert.equal(memberships.workspaces.find(item => item.id === workspace.id).role, 'owner')
    assert.equal((await call('/studio/packages/team-package', 'Hexclave mapped', { workspace: workspace.id })).status, 200)
    const other = await (await call('/identity', 'Hexclave duplicate-email')).json()
    assert.notEqual(other.uid, legacyUid)
    assert.equal(other.role, 'user')
    assert.equal((await call('/studio/packages/legacy-package', 'Hexclave duplicate-email')).status, 404)
    assert.equal((await call('/studio/packages/team-package', 'Hexclave duplicate-email', { workspace: workspace.id })).status, 403)
    assert.equal((await (await call('/workspaces', 'Hexclave duplicate-email')).json()).workspaces.length, 1)
    selected = firebase
    assert.equal((await call('/identity', 'Hexclave mapped')).status, 401)
    assert.deepEqual(await (await call('/studio/packages/legacy-package', 'Bearer firebase-owner')).json(), baseline)
    assert.deepEqual(await (await call('/studio/packages/legacy-package/history', 'Bearer firebase-owner')).json(), history)
    assert.equal((await call('/studio/packages/team-package', 'Bearer firebase-owner', { workspace: workspace.id })).status, 200)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})

