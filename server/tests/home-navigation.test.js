import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { safeRedirect } from '../../src/services/safe-redirect.ts'

test('default login and home open the library while new-idea entry stays separate', async () => {
  const source = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const element = (type, props) => ({ type, props })
  const exports = {}
  runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element }
    if (name === 'react-router-dom') return { Route: 'Route', Routes: 'Routes', Navigate: 'Navigate' }
    if (name === 'react') return { Suspense: 'Suspense', lazy: () => 'LazyPage' }
    return {}
  } })
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const routes = flatten(exports.default()).filter(node => node.type === 'Route')
  const home = routes.find(node => node.props.index).props.element
  assert.equal(home.type, 'Navigate')
  assert.equal(home.props.to, '/ideas')
  assert.equal(home.props.replace, true)
  assert.ok(routes.some(node => node.props.path === '/find-ideas'))
  assert.ok(routes.some(node => node.props.path === '/ideas'))
  assert.equal(safeRedirect(null), '/')
  assert.equal(safeRedirect('/ideas/category-1'), '/ideas/category-1')
})
