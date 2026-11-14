import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function pollingEffect() {
  const source = await readFile(new URL('../../src/pages/app/StudioPage.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('StudioPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect' && node.arguments[0]?.getText(parsed).includes('const jobId = item.jobId')) effect = node.arguments[0].getText(parsed)
    ts.forEachChild(node, visit)
  }
  visit(parsed); assert.ok(effect); return effect
}

test('actual Studio polling recovers after timeout and a terminal job/package write race without mutation', async () => {
  const effect = await pollingEffect()
  let tick; let calls = 0; let panel; let mobileView; let saved; let error; let completedContent; let release
  const pending = new Promise(resolve => { release = resolve })
  const code = ts.transpileModule(`const effect = ${effect}; effect();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    item: { id: 'p1', jobId: 'j1', status: 'generating' },
    studioRead: async path => {
      calls++
      if (path.startsWith('/jobs/') && calls === 1) { await pending; throw Object.assign(new Error('Loading took too long'), { name: 'TimeoutError' }) }
      return path.startsWith('/jobs/') ? { id: 'j1', status: 'completed' } : { id: 'p1', status: calls <= 4 ? 'generating' : 'completed', content: { script: 'Saved output' } }
    },
    studioRequest: () => { throw new Error('Polling must not use unbounded reads or mutations') },
    window: { setInterval: callback => { tick = callback; return 1 }, clearInterval() {} },
    packageContextDirty: false, setPanelValue: value => { panel = value }, setMobileView: value => { mobileView = value }, focusGeneratedContent: { current: true }, setChosenFormat() {}, setPreviewSection() {}, setPreviewPlatform() {}, setActiveSlide() {}, setJob() {}, setItem: value => { saved = value }, setContent: value => { completedContent = value }, setNotice() {}, setError: value => { error = typeof value === 'function' ? value(error) : value }, message: value => value.message,
  })
  await new Promise(resolve => setImmediate(resolve)); tick(); assert.equal(calls, 2)
  release(); await new Promise(resolve => setImmediate(resolve)); assert.match(error, /too long/)
  tick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 4); assert.equal(saved.status, 'generating'); assert.equal(completedContent, undefined)
  tick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 6); assert.equal(saved.status, 'completed'); assert.equal(completedContent.script, 'Saved output')
  assert.equal(error, '')
  assert.equal(panel, 'write'); assert.equal(mobileView, 'editor')
  tick(); assert.equal(calls, 6)
})

test('failed regeneration retains old content without announcing or focusing a new successful draft', async () => {
  const effect = await pollingEffect()
  let notice = ''; let error = ''; const focus = { current: true }; const oldContent = { script: 'Previously saved output' }
  const code = ts.transpileModule(`const effect = ${effect}; effect();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    item: { id: 'p1', jobId: 'j1', status: 'generating' }, packageContextDirty: false, focusGeneratedContent: focus,
    studioRead: async path => path.startsWith('/jobs/') ? { id: 'j1', status: 'failed' } : { id: 'p1', status: 'failed', content: oldContent },
    window: { setInterval() { return 1 }, clearInterval() {} },
    setChosenFormat() {}, setPreviewSection() {}, setPreviewPlatform() {}, setActiveSlide() {}, setJob() {}, setItem() {},
    setContent: value => assert.equal(value, oldContent), setNotice: value => { notice = value },
    setPanelValue() { assert.fail('A failed attempt must not navigate as a success') }, setMobileView() {},
    setError: value => { error = value }, message: value => value.message,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(error, '')
  assert.match(notice, /did not produce a new draft/)
  assert.doesNotMatch(notice, /Draft generated/)
  assert.equal(focus.current, false)
})