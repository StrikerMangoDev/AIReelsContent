import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
import * as fflate from 'fflate'

export async function loadExportModules() {
  const modules = { react: {}, 'react/jsx-runtime': {}, fflate }
  for (const [path, name] of [
    ['pages/app/ContentPreview.tsx', '../pages/app/ContentPreview'],
    ['services/production-handoff.ts', './production-handoff'],
    ['services/studio-export.ts', '@/services/studio-export'],
  ]) {
    const source = await readFile(new URL(`../../../src/${path}`, import.meta.url), 'utf8')
    const exports = {}
    runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports, Blob, Uint8Array, require: name => { assert.ok(name in modules, name); return modules[name] },
    })
    modules[name] = exports
  }
  return modules
}
