import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { loadExportModules } from './helpers/studio-export.js'

test('actual download creates Markdown and JSON only from server-validated owner export, and denial creates no file', async () => {
  const source = await readFile(new URL('../../src/pages/app/StudioPage.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('StudioPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let download
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'download') download = node.getText(parsed); ts.forEachChild(node, visit) }
  visit(parsed); assert.ok(download)
  const preview = await readFile(new URL('../../src/pages/app/ContentPreview.tsx', import.meta.url), 'utf8')
  const exports = {}
  runInNewContext(ts.transpileModule(preview, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: () => ({}) })
  const handoffExports = {}
  const handoffSource = await readFile(new URL('../../src/services/production-handoff.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(handoffSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: handoffExports })
  const pack = { settings: { audience: 'Readers', language: 'English', tone: 'Clear', platform: 'Instagram', duration: 45 }, id: 'fixture', revision: 7, title: 'Reviewed fixture', content: { script: 'Saved server text [C1]', claims: [{ id: 'C1', text: 'Supported claim', evidenceId: 'E1', quote: 'Exact saved passage' }] }, evidence: [{ id: 'E1', title: 'Source', url: 'https://example.com/source', limitations: ['Fixture only'] }] }
  const exported = { package: pack, manifest: { contentHash: 'reviewed-hash', revision: 7, reviewerId: 'fixture-reviewer' } }
  const exportHelpers = (await loadExportModules())['@/services/studio-export']
  let blob; let denied = false; let changed = false; let reads = 0; const files = []; const urls = []
  const context = {
    workingType: 'reel', item: { id: 'fixture', revision: 7, editorialStatus: 'approved', approval: { method: 'independent-human' } }, reviewReady: true, busy: '', downloadDispatch: { current: false }, downloadActive: { current: true }, content: { script: 'Unsaved browser text' }, dirty: false,
    run: async (_label, action) => action(),
    studioRead: async path => { reads++; assert.equal(path, '/packages/fixture/export'); if (denied) throw new Error('Review required'); return changed ? { ...exported, package: { ...pack, revision: 8 } } : exported },
    contentMarkdown: exports.contentMarkdown, ...handoffExports, ...exportHelpers, Blob, window: { setTimeout: action => action() }, activeWorkspace: () => 'personal', workspaceIdentity: () => 'owner',
    URL: { createObjectURL(value) { blob = value; return 'blob:test' }, revokeObjectURL(value) { urls.push(value) } },
    setNotice() {}, studioRequest: async () => assert.fail('downloading must never approve content'), document: { createElement() { const anchor = { click() { files.push(anchor.download) } }; return anchor } }, trackEvent() {},
  }
  const code = ts.transpileModule(`${download}; download('md')`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  await runInNewContext(code, context)
  const markdown = await blob.text(); assert.match(markdown, /Saved server text/); assert.doesNotMatch(markdown, /Unsaved browser text/)
  assert.match(markdown, /Exact saved passage/); assert.match(markdown, /reviewed-hash/); assert.match(markdown, /Team production prompts/); assert.match(markdown, /Complete video prompt/); assert.equal(blob.type, 'text/markdown')
  await runInNewContext(code.replace("download('md')", "download('json')"), context)
  const jsonExport = JSON.parse(await blob.text()); assert.deepEqual(jsonExport.package, pack); assert.deepEqual(jsonExport.manifest, exported.manifest); assert.equal(jsonExport.productionHandoffs.revision, 7); assert.match(jsonExport.productionHandoffs.video.prompt, /Saved server text/); assert.doesNotMatch(JSON.stringify(jsonExport.productionHandoffs), /Unsaved browser text/); assert.equal(blob.type, 'application/json')
  assert.deepEqual(files, ['content-fixture.md', 'content-fixture.json']); assert.equal(urls.length, 2)
  assert.equal(reads, 2)
  changed = true; await assert.rejects(runInNewContext(code, context), /content changed/); assert.equal(files.length, 2); changed = false
  denied = true; await assert.rejects(runInNewContext(code, context), /Review required/); assert.equal(files.length, 2)
  denied = false; const beforeDoubleClick = reads
  await Promise.all([runInNewContext(code, context), runInNewContext(code, context)])
  assert.equal(reads, beforeDoubleClick + 1); assert.equal(files.length, 3, 'double click downloads once without approving')
  context.dirty = true; await runInNewContext(code, context); assert.equal(files.length, 3, 'unsaved edits cannot be downloaded')
  context.dirty = false; context.item.review = { issues: ['Source changed. Recheck saved content.'] }
  const beforeBlocked = reads
  await runInNewContext(code, context); assert.equal(reads, beforeBlocked, 'unresolved source issues still block before export')
  context.item.review = { issues: [] }; context.item.status = 'dispatch_unknown'
  await runInNewContext(code, context); assert.equal(reads, beforeBlocked, 'uncertain generation blocks owner download')
  context.item.status = 'completed'; context.item.editorialStatus = 'needs_review'; delete context.item.approval; context.reviewReady = false
  await runInNewContext(code, context); assert.equal(reads, beforeBlocked + 1, 'owner can download without independent review or approval')
  context.downloadActive.current = false
  const beforeUnmount = files.length
  await runInNewContext(code.replace("download('md')", "download('zip')"), context)
  assert.equal(files.length, beforeUnmount, 'leaving the account or package cancels the pending download')
  context.downloadActive.current = true
  context.buildExportFile = async (...args) => { const result = await exportHelpers.buildExportFile(...args); context.activeWorkspace = () => 'different'; return result }
  await assert.rejects(runInNewContext(code, context), /Workspace changed/)
  assert.equal(files.length, beforeUnmount, 'workspace changes during file assembly cancel the download')
})
