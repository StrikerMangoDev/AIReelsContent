import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('actual download creates Markdown and JSON only from server-approved export, and denial creates no file', async () => {
  const source = await readFile(new URL('../../src/pages/app/StudioPage.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('StudioPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let download
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'download') download = node.getText(parsed); ts.forEachChild(node, visit) }
  visit(parsed); assert.ok(download)
  const preview = await readFile(new URL('../../src/pages/app/ContentPreview.tsx', import.meta.url), 'utf8')
  const exports = {}
  runInNewContext(ts.transpileModule(preview, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: () => ({}) })
  const pack = { id: 'fixture', revision: 7, title: 'Reviewed fixture', content: { script: 'Saved server text [C1]', claims: [{ id: 'C1', text: 'Supported claim', evidenceId: 'E1', quote: 'Exact saved passage' }] }, evidence: [{ id: 'E1', title: 'Source', url: 'https://example.com/source', limitations: ['Fixture only'] }] }
  const exported = { package: pack, manifest: { contentHash: 'reviewed-hash', revision: 7, reviewerId: 'fixture-reviewer' } }
  let blob; let denied = false; let changed = false; let approvalDenied = false; const approvals = []; const files = []; const urls = []
  const context = {
    item: { id: 'fixture', revision: 7, editorialStatus: 'approved', approval: { method: 'creator-confirmed' } }, busy: '', downloadDispatch: { current: false }, content: { script: 'Unsaved browser text' }, dirty: false,
    run: async (_label, action) => action(),
    studioRead: async path => { assert.equal(path, '/packages/fixture/export'); if (denied) throw new Error('Review required'); return changed ? { ...exported, package: { ...pack, revision: 8 } } : exported },
    contentMarkdown: exports.contentMarkdown, Blob,
    URL: { createObjectURL(value) { blob = value; return 'blob:test' }, revokeObjectURL(value) { urls.push(value) } },
    setNotice() {}, accept() {}, studioRequest: async (path, body, method) => { approvals.push({ path, body, method }); assert.equal(method, 'PATCH'); assert.equal(body.revision, 7); assert.equal(body.editorialStatus, 'approved'); if (approvalDenied) throw new Error('Citation issue'); return pack }, document: { createElement() { const anchor = { click() { files.push(anchor.download) } }; return anchor } }, trackEvent() {},
  }
  const code = ts.transpileModule(`${download}; download('md')`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  await runInNewContext(code, context)
  const markdown = await blob.text(); assert.match(markdown, /Saved server text/); assert.doesNotMatch(markdown, /Unsaved browser text/)
  assert.match(markdown, /Exact saved passage/); assert.match(markdown, /reviewed-hash/); assert.equal(blob.type, 'text/markdown')
  await runInNewContext(code.replace("download('md')", "download('json')"), context)
  assert.deepEqual(JSON.parse(await blob.text()), exported); assert.equal(blob.type, 'application/json')
  assert.deepEqual(files, ['content-fixture.md', 'content-fixture.json']); assert.equal(urls.length, 2)
  assert.equal(approvals.length, 2)
  changed = true; await assert.rejects(runInNewContext(code, context), /content changed/); assert.equal(files.length, 2); changed = false
  approvalDenied = true; await assert.rejects(runInNewContext(code, context), /Citation issue/); assert.equal(files.length, 2); approvalDenied = false
  denied = true; await assert.rejects(runInNewContext(code, context), /Review required/); assert.equal(files.length, 2)
  denied = false; const beforeDoubleClick = approvals.length
  await Promise.all([runInNewContext(code, context), runInNewContext(code, context)])
  assert.equal(approvals.length, beforeDoubleClick + 1); assert.equal(files.length, 3, 'double click confirms and downloads once')
  context.dirty = true; await runInNewContext(code, context); assert.equal(files.length, 3, 'unsaved edits cannot be downloaded')
})
