import test from 'node:test'
import assert from 'node:assert/strict'
import { createHexclaveMiddleware, publicAuthConfig } from '../auth/index.js'

const config = { AUTH_PROVIDER: 'hexclave', HEXCLAVE_PROJECT_ID: 'project-one', HEXCLAVE_SECRET_SERVER_KEY: 'server-secret', HEXCLAVE_MIGRATION_READY: 'true' }
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value }, status(code) { this.statusCode = code; return this }, json(body) { this.body = body } })

test('Hexclave configuration never exposes server keys and blocks unverified migration', () => {
  assert.deepEqual(publicAuthConfig(config), { provider: 'hexclave', configured: true, config: { projectId: 'project-one' } })
  assert.equal(publicAuthConfig({ ...config, HEXCLAVE_MIGRATION_READY: 'false' }).configured, false)
  assert.equal(publicAuthConfig({ ...config, HEXCLAVE_IDENTITY_MAP_JSON: '{"a":"same","b":"same"}' }).configured, false)
})

test('Hexclave uses project-bound SDK verification and explicit stable mappings, never email merging or client roles', async () => {
  const options = []
  const middleware = createHexclaveMiddleware({ config: { ...config, HEXCLAVE_IDENTITY_MAP_JSON: '{"subject-one":"existing-firebase-uid"}' }, loadApp: async value => {
    options.push(value)
    return { getUser: async ({ tokenStore }) => {
      assert.equal(tokenStore.headers.authorization, 'Hexclave verified-session')
      return { id: 'subject-one', primaryEmail: 'yeshaswi3@gmail.com', primaryEmailVerified: true, displayName: 'Name', admin: true }
    } }
  } })
  const req = { headers: { authorization: 'Hexclave verified-session' } }; const res = response()
  let called = false
  await middleware(req, res, () => { called = true })
  assert.equal(called, true)
  assert.equal(options[0].projectId, 'project-one')
  assert.equal(options[0].tokenStore, null)
  assert.equal(req.identity.uid, 'existing-firebase-uid')
  assert.equal(req.identity.role, 'user')
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
})

test('Hexclave denied sessions fail closed and new IDs are project-scoped', async () => {
  for (const account of [null, { id: 'anonymous', isAnonymous: true }, { id: 'restricted', isRestricted: true }, { id: '' }]) {
    const res = response()
    await createHexclaveMiddleware({ config, loadApp: async () => ({ getUser: async () => account }) })({ headers: { authorization: 'session' } }, res, () => assert.fail('Denied identity'))
    assert.equal(res.statusCode, 401)
  }
  const ids = []
  for (const projectId of ['project-one', 'project-two']) {
    const req = { headers: { authorization: 'session' } }
    await createHexclaveMiddleware({ config: { ...config, HEXCLAVE_PROJECT_ID: projectId }, loadApp: async () => ({ getUser: async () => ({ id: 'same-subject', primaryEmail: 'same@example.com' }) }) })(req, response(), () => {})
    ids.push(req.identity.uid)
  }
  assert.notEqual(ids[0], ids[1])
  const res = response()
  await createHexclaveMiddleware({ config, loadApp: async () => { throw new Error('private secret') } })({ headers: { authorization: 'session' } }, res, () => assert.fail('Denied identity'))
  assert.equal(res.statusCode, 401)
  assert.doesNotMatch(JSON.stringify(res.body), /private|secret/)
})
