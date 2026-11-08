import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function harness(fetch, authHeaders = async () => ({})) {
  const source = await readFile(new URL('../../src/services/studio-api.ts', import.meta.url), 'utf8')
  const exports = {}; const scope = { actor: 'alice', workspace: 'personal' }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, fetch, AbortController, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 12000 ? 15 : 1),
    require: name => name.includes('firebase') ? { authHeaders } : { activeWorkspace: () => scope.workspace, workspaceIdentity: () => scope.actor },
  })
  return { ...exports, scope }
}
const ok = () => ({ ok: true, json: async () => ({ saved: true }) })
test('saved reads recover once from temporary network and gateway failures', async () => {
  for (const status of [0, 500, 502, 503, 504]) {
    let calls = 0
    const api = await harness(async () => {
      if (++calls === 1) { if (!status) throw new TypeError('offline'); return { ok: false, status, json: async () => ({}) } }
      return ok()
    })
    assert.equal((await api.studioRead('/intelligence')).saved, true)
    assert.equal(calls, 2)
  }
})
test('denied reads and all mutations are never retried', async () => {
  for (const status of [401, 403, 404, 429]) {
    let calls = 0
    const api = await harness(async () => { calls++; return { ok: false, status, json: async () => ({}) } })
    await assert.rejects(api.studioRead('/intelligence'), { status }); assert.equal(calls, 1)
  }
  let calls = 0
  const api = await harness(async () => { calls++; throw new TypeError('offline') })
  await assert.rejects(api.studioRequest('/intelligence/research', {}, 'POST')); assert.equal(calls, 1)
})
test('hung authentication is bounded and cannot dispatch after timeout', async () => {
  let finish; let calls = 0
  const pending = new Promise(resolve => { finish = resolve })
  const api = await harness(async () => { calls++; return ok() }, () => pending)
  await assert.rejects(api.studioRead('/intelligence'), { name: 'TimeoutError' })
  finish({}); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0)
})
test('hung fetch is aborted and late data from a changed workspace is rejected', async () => {
  let calls = 0; let aborted = 0
  const api = await harness((_url, { signal }) => { calls++; signal.addEventListener('abort', () => aborted++); return new Promise(() => {}) })
  await assert.rejects(api.studioRead('/intelligence'), { name: 'TimeoutError' }); assert.equal(calls, 2); assert.equal(aborted, 2)
  let finish
  const switched = await harness(() => new Promise(resolve => { finish = resolve }))
  const read = switched.studioRead('/intelligence'); await new Promise(resolve => setImmediate(resolve))
  switched.scope.workspace = 'another'; finish(ok())
  await assert.rejects(read, /Workspace changed/)
})
