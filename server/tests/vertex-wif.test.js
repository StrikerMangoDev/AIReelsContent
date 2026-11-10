import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { vertexGoogleAuthOptions, vertexProductionProject, vertexWifAudience, vertexWifServiceAccount, generateVertexJson, vertexDemoCallUpperBoundMicros } from '../providers/vertex-fallback.js'
import { createDemoFixture } from './fixtures/demo.js'
import { demoAuthorizationActive } from '../automation/demo.js'
import { firebaseCredentials } from '../auth/firebase.js'

const config = { CONTENT_VERTEX_FALLBACK: 'true', VERTEX_FALLBACK_PROJECT: vertexProductionProject, VERTEX_FALLBACK_MODEL: 'gemini-3.8-flash', VERTEX_FALLBACK_APPROVED_UNTIL: new Date(Date.now() + 3600000).toISOString(), VERTEX_WIF_AUDIENCE: vertexWifAudience, VERTEX_WIF_SERVICE_ACCOUNT: vertexWifServiceAccount }
test('installed federation libraries construct and retrieve the supplied subject without network', async () => {
  const { ExternalAccountClient, IdentityPoolClient } = await import('google-auth-library')
  const { getVercelOidcToken } = await import('@vercel/functions/oidc')
  assert.equal(typeof getVercelOidcToken, 'function')
  let client
  const options = await vertexGoogleAuthOptions(config, { ExternalAccountClient: { fromJSON: settings => {
    assert.equal(settings.audience, vertexWifAudience.replace(/^https:/, ''))
    client = ExternalAccountClient.fromJSON(settings)
    assert.ok(client instanceof IdentityPoolClient)
    client.getAccessToken = async () => { assert.equal(await client.retrieveSubjectToken(), 'fake-subject'); return { token: 'fake-access' } }
    return client
  } }, getVercelOidcToken: async options => { assert.deepEqual(options, { audience: vertexWifAudience }); return 'fake-subject' } })
  assert.equal(options.authClient, client)
})

test('federation diagnostics retain only known failure phase, code and HTTP status', async () => {
  await assert.rejects(vertexGoogleAuthOptions(config, { ExternalAccountClient: { fromJSON: () => ({ getAccessToken: async () => { throw Object.assign(new Error('private token'), { code: 'ETIMEDOUT', response: { status: 504, data: 'private body' } }) } }) }, getVercelOidcToken: async () => 'unused' }), error => {
    assert.deepEqual(error.authFailure, { phase: 'google_token_exchange', code: 'ETIMEDOUT', httpStatus: 504 })
    assert.equal(JSON.stringify(error).includes('private'), false)
    return true
  })
  await assert.rejects(vertexGoogleAuthOptions(config, { ExternalAccountClient: { fromJSON: () => ({ getAccessToken: async () => { throw { response: { status: 400, data: { error: 'invalid_request', error_description: 'private token details' } } } } }) }, getVercelOidcToken: async () => 'unused' }), error => {
    assert.deepEqual(error.authFailure, { phase: 'google_token_exchange', code: 'invalid_request', httpStatus: 400 })
    assert.equal(JSON.stringify(error).includes('private'), false)
    return true
  })
})
test('production WIF authenticates exact audience and target before inference without reading Firebase JSON', async () => {
  let oidcOptions; let settings; let authenticated = false
  const authClient = { getAccessToken: async () => { assert.equal(await settings.subject_token_supplier.getSubjectToken(), 'controlled-subject-token'); authenticated = true; return { token: 'controlled-access-token' } } }
  const options = await vertexGoogleAuthOptions({ ...config, GOOGLE_SERVICE_ACCOUNT_JSON: 'invalid-private-legacy-json-must-not-be-read', VERTEX_FALLBACK_CREDENTIALS: 'nonexistent-private-file' }, { ExternalAccountClient: { fromJSON: value => { settings = value; return authClient } }, getVercelOidcToken: async value => { oidcOptions = value; return 'controlled-subject-token' } })
  assert.equal(authenticated, true); assert.equal(options.authClient, authClient); assert.equal(options.projectId, vertexProductionProject); assert.equal(options.credentials, undefined)
  assert.equal(settings.audience, vertexWifAudience.replace(/^https:/, '')); assert.deepEqual(oidcOptions, { audience: vertexWifAudience })
  assert.deepEqual(settings.scopes, ['https://www.googleapis.com/auth/cloud-platform'])
  assert.equal(settings.token_url, 'https://sts.googleapis.com/v1/token')
  assert.equal(settings.service_account_impersonation_url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${vertexWifServiceAccount}:generateAccessToken`)
  const legacy = { type: 'service_account', project_id: 'ai-vertical-495712', client_email: 'controlled-source@example.com', private_key: 'controlled-fake-key' }
  assert.deepEqual(firebaseCredentials({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(legacy) }), legacy)
})

test('provider descriptions become fixed diagnostic reasons without retaining raw private descriptions', async () => {
  for (const [description, reason] of [['The attribute condition rejected private-token', 'attribute_condition_rejected'], ['Invalid audience private-token', 'audience_rejected'], ['Invalid issuer private-token', 'issuer_rejected'], ['Denied iam.serviceAccounts.getAccessToken private-token', 'impersonation_permission_denied']]) {
    await assert.rejects(vertexGoogleAuthOptions(config, { ExternalAccountClient: { fromJSON: () => ({ getAccessToken: async () => { throw { response: { status: 400, data: { error: 'invalid_grant', error_description: description } } } } }) }, getVercelOidcToken: async () => 'unused' }), error => {
      assert.equal(error.authFailure.reason, reason)
      assert.equal(JSON.stringify(error).includes('private-token'), false)
      return true
    })
  }
})

test('wrong WIF target, project, audience and rejected token exchange cannot reserve or call the model', async () => {
  for (const patch of [{ VERTEX_WIF_AUDIENCE: vertexWifAudience.replace('487106620228', '123456789012') }, { VERTEX_WIF_AUDIENCE: vertexWifAudience.replace(/^https:/, '') }, { VERTEX_WIF_SERVICE_ACCOUNT: 'other@cs-project-bvfzp2zn.iam.gserviceaccount.com' }, { VERTEX_FALLBACK_PROJECT: 'ai-vertical-495712' }]) await assert.rejects(vertexGoogleAuthOptions({ ...config, ...patch }), error => error.code === 'BUDGET_BLOCKED' && error.configurationFailure === true && error.preDispatch === true)
  const repository = createRepository(':memory:'); let calls = 0
  try {
    repository.budgetConfigure('USD', 'wif-preflight', 5000000, 5000000)
    await assert.rejects(generateVertexJson({ system: 'Test', input: {}, schema: {}, maxTokens: 1000 }, { repository, owner: 'wif-preflight', requestId: 'auth-rejected', config, authenticate: value => vertexGoogleAuthOptions(value, { ExternalAccountClient: { fromJSON: () => ({ getAccessToken: async () => { throw new Error('private STS token details') } }) }, getVercelOidcToken: async () => 'not-retrieved' }), request: async () => { calls++; throw new Error('Must not run') }, worstCaseModelBound: true }), error => error.code === 'BUDGET_BLOCKED' && error.configurationFailure && error.preDispatch && !error.message.includes('private'))
    assert.equal(repository.budgetGet('wif-preflight', 'auth-rejected'), null); assert.equal(calls, 0)
    assert.equal(vertexDemoCallUpperBoundMicros, 1277952)
  } finally { repository.close() }
})

test('active Vertex demos must select production while historical Firebase-project records stay readable but ineligible', async () => {
  const repository = createRepository(':memory:')
  try {
    const { authorization } = await createDemoFixture(repository)
    assert.equal(demoAuthorizationActive(authorization), true)
    assert.equal(demoAuthorizationActive({ ...authorization, projectId: 'ai-vertical-495712' }), false)
  } finally { repository.close() }
})
