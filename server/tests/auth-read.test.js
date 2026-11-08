import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('session reads recover temporary failures but never retry denied sessions', async () => {
  const source = await readFile(new URL('../../src/services/auth-read.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  for (const statuses of [[502, 200], [503, 503], [401], [403]]) {
    const exports = {}; let calls = 0
    runInNewContext(code, { exports, AbortSignal, TypeError, setTimeout: callback => callback(), fetch: async (_path, options) => {
      assert.equal(options.cache, 'no-store'); assert.ok(options.signal)
      return { status: statuses[calls++] }
    } })
    assert.equal((await exports.authRead('/api/auth/me')).status, statuses.at(-1))
    assert.equal(calls, statuses.length)
  }
})

test('network retry is bounded and timeout cannot leave login pending forever', async () => {
  const source = await readFile(new URL('../../src/services/auth-read.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  for (const error of [new TypeError('offline'), Object.assign(new Error('timeout'), { name: 'TimeoutError' })]) {
    const exports = {}; let calls = 0
    runInNewContext(code, { exports, AbortSignal, TypeError, setTimeout: callback => callback(), fetch: async () => { calls++; throw error } })
    await assert.rejects(exports.authRead('/api/auth/me'))
    assert.equal(calls, 2)
  }
})
