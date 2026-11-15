import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('session refresh preserves drafts during outages, clears denial and ignores responses after logout', async () => {
  const source = await readFile(new URL('../../src/context/AuthProvider.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const state = []; const effects = []; const listeners = new Map()
  let status = 200; let held; let networkError = false
  const modules = {
    react: { useState(initial) { const index = state.length; state.push(initial); return [initial, value => { state[index] = value }] }, useEffect(effect) { effects.push(effect) } },
    'react/jsx-runtime': { jsx: () => null },
    '@/services/auth-read': { authRead: async () => { if (networkError) throw new TypeError('Network unavailable'); return held || { ok: status === 200, status, json: async () => ({ uid: 'existing-owner' }) } } },
    '@/services/workspace-session': { setWorkspaceIdentity() {} },
    './auth-state': { AuthContext: { Provider: null } },
  }
  const exports = {}
  runInNewContext(code, { Error, exports, require: name => modules[name], setInterval: () => 1, clearInterval() {}, window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) } })
  exports.AuthProvider({ children: null }); const cleanup = effects[0]()
  const settle = () => new Promise(resolve => setImmediate(resolve))
  await settle()
  assert.equal(state[0].uid, 'existing-owner'); assert.equal(state[1], false)
  for (const outage of [500,503,'network']) {
    status=outage; networkError=outage==='network'; listeners.get('focus')(); await settle()
    assert.equal(state[0].uid, 'existing-owner'); assert.ok(state[2]); assert.equal(state[1],false)
  }
  networkError=false
  for (const denied of [401,403]) {
    status=denied; listeners.get('focus')(); await settle(); assert.equal(state[0],null)
    status=200; listeners.get('auth-refresh')(); await settle(); assert.equal(state[0].uid,'existing-owner')
  }
  let resolveStale
  held=new Promise(resolve => { resolveStale=resolve })
  listeners.get('focus')(); await settle(); listeners.get('auth-signout')()
  resolveStale({ok:true,json:async()=>({uid:'stale'})}); await settle()
  assert.equal(state[0],null)
  held=null; listeners.get('focus')(); await settle()
  listeners.get('storage')({key:'studio-signout'}); assert.equal(state[0],null)
  cleanup(); assert.equal(listeners.size,0)
})
