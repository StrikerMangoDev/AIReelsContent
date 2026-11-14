import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('Hexclave refresh verifies on the server and clears identity after denial or sign-out', async () => {
  const source = await readFile(new URL('../../src/context/AuthProvider.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const state = []; const effects = []; const listeners = new Map()
  let allowed = true; let checks = 0; let status = 401; let networkError = false; let subject = 'subject'; let heldResponse; let sdkError
  const modules = {
    react: { useState(initial) { const index = state.length; state.push(initial); return [initial, value => { state[index] = value }] }, useEffect(effect) { effects.push(effect) } },
    'react/jsx-runtime': { jsx: () => null },
    '@/services/firebase': { authConfiguration: async () => ({ provider: 'hexclave', configured: true }), hexclaveClient: async () => ({ getUser: async () => { if (sdkError) throw sdkError; return subject ? { id: subject } : null } }), authHeaders: async () => ({ Authorization: 'test-session' }) },
    '@/services/auth-read': { authRead: async (path, headers) => { checks++; assert.equal(path, '/api/auth/me'); assert.equal(headers.Authorization, 'test-session'); if (networkError) throw new TypeError('Network unavailable'); if (heldResponse) return heldResponse; return { ok: allowed, status: allowed ? 200 : status, json: async () => ({ uid: 'server-verified', role: 'user' }) } } },
    '@/services/workspace-session': { setWorkspaceIdentity() {} },
    './auth-state': { AuthContext: { Provider: null } },
  }
  const exports = {}
  runInNewContext(code, { Error, exports, require: name => modules[name], setInterval: () => 1, clearInterval() {}, window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) } })
  exports.AuthProvider({ children: null }); const cleanup = effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1].uid, 'server-verified'); assert.equal(checks, 1)
  listeners.get('focus')()
  assert.equal(state[2], false, 'same-account focus refresh does not hide the page')
  assert.equal(state[1].uid, 'server-verified')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2, 'focus still verifies authentication on the server')
  for (const rejection of [{ status: 401 }, { statusCode: 403 }]) {
    sdkError = Object.assign(new Error('Provider session denied'), rejection)
    listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(state[1], null, 'explicit SDK session rejection clears prior identity')
    assert.equal(state[0], null)
    sdkError = null; listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(state[1].uid, 'server-verified')
  }
  sdkError = Object.assign(new Error('Provider temporarily unavailable'), { status: 503 })
  listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1].uid, 'server-verified', 'SDK outage preserves prior verified identity')
  sdkError = null
  const verified = state[1]
  for (const outage of ['network', 500, 503]) {
    networkError = outage === 'network'; allowed = false; status = outage
    listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(state[1], verified, `${outage} retains the previously verified identity`)
    assert.equal(state[0].uid, 'server-verified'); assert.equal(state[2], false)
    assert.ok(state[3], 'outage remains observable as an error')
  }
  networkError = false; status = 401
  allowed = false; listeners.get('auth-refresh')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1], null); assert.equal(state[0], null); assert.equal(state[2], false)
  allowed = true; listeners.get('auth-refresh')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1].uid, 'server-verified')
  allowed = false; status = 403; listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1], null, 'explicit authorization denial clears cached identity')
  allowed = true; listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
  subject = 'other'; allowed = false; status = 503
  listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1], null, 'an unavailable new account never inherits the previous identity')
  allowed = true; listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
  let resolveStale
  heldResponse = new Promise(resolve => { resolveStale = resolve })
  listeners.get('focus')(); await new Promise(resolve => setImmediate(resolve))
  heldResponse = null; subject = ''; listeners.get('auth-refresh')(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1], null, 'explicit provider logout clears identity')
  resolveStale({ ok: true, json: async () => ({ uid: 'stale-account' }) }); await new Promise(resolve => setImmediate(resolve))
  assert.equal(state[1], null, 'late session success cannot undo logout')
  listeners.get('auth-signout-start')(); assert.equal(state[1], null); assert.equal(state[0], null)
  cleanup(); assert.equal(listeners.size, 0)
})

test('Firebase refresh preserves drafts during outages but clears denied, switched and signed-out identities', async () => {
  const source = await readFile(new URL('../../src/context/AuthProvider.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const state = []; const effects = []; const responses = new Map()
  let listener; let cleanup
  const services = { authConfiguration: async () => ({ provider: 'firebase', configured: true }), configuredAuth: async () => ({}) }
  const modules = {
    react: { useState(initial) { const index = state.length; state.push(initial); return [initial, value => { state[index] = typeof value === 'function' ? value(state[index]) : value }] }, useEffect(effect) { effects.push(effect) } },
    'react/jsx-runtime': { jsx: () => null },
    '@/services/firebase': services,
    '@/services/auth-read': { authRead: async (_url, headers) => responses.get(headers.Authorization) },
    '@/services/workspace-session': { setWorkspaceIdentity() {} },
    './auth-state': { AuthContext: { Provider: null } },
    'firebase/auth': { onIdTokenChanged(_auth, callback) { listener = callback; return () => {} } },
  }
  const exports = {}
  runInNewContext(code, {
    Error, exports, require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name] },
    fetch: async (_url, { headers }) => responses.get(headers.Authorization),
  })
  exports.AuthProvider({ children: null })
  for (const effect of effects) cleanup = effect()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof listener, 'function')
  const account = (uid, token = uid) => ({ uid, getIdToken: async () => token })
  const response = uid => ({ ok: true, json: async () => ({ uid, role: 'user' }) })
  responses.set('Bearer alice', response('alice'))
  await listener(account('alice'))
  const verifiedAlice = state[1]
  assert.equal(verifiedAlice.uid, 'alice')

  let finishRefresh
  responses.set('Bearer refresh', new Promise(resolve => { finishRefresh = resolve }))
  const refresh = listener(account('alice', 'refresh'))
  assert.equal(state[1], verifiedAlice)
  assert.equal(state[2], false, 'background token refresh must not unmount the editor')
  finishRefresh(response('alice')); await refresh
  assert.equal(state[1].uid, 'alice'); assert.equal(state[2], false)
  for (const status of [500, 503]) {
    responses.set('Bearer outage', { ok: false, status })
    await listener(account('alice', 'outage'))
    assert.equal(state[1].uid, 'alice'); assert.equal(state[0].uid, 'alice'); assert.equal(state[2], false)
    assert.match(state[3], /temporarily unavailable/)
  }
  await listener({ uid: 'alice', getIdToken: async () => { throw new TypeError('Network unavailable') } })
  assert.equal(state[1].uid, 'alice'); assert.equal(state[2], false)

  let finishOld
  responses.set('Bearer old', new Promise(resolve => { finishOld = resolve }))
  const stale = listener(account('alice', 'old'))
  responses.set('Bearer bob', response('bob'))
  const switchAccount = listener(account('bob'))
  assert.equal(state[1], null)
  await switchAccount
  finishOld({ ok: false, status: 401 }); await stale
  assert.equal(state[1].uid, 'bob')

  responses.set('Bearer denied', { ok: false, status: 401 })
  await listener(account('bob', 'denied'))
  assert.equal(state[1], null); assert.equal(state[0], null); assert.equal(state[2], false)
  await listener(account('bob'))
  await listener(null)
  assert.equal(state[1], null); assert.equal(state[0], null)
  cleanup()
})
