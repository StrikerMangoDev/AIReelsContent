import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = node => node == null ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => node == null ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
async function setup(packages) {
  const source = await readFile(new URL('../../src/pages/app/StudioDraftList.tsx', import.meta.url), 'utf8')
  const slots = []; let cursor = 0; let retries = 0
  const element = (type, props) => ({ type, props })
  const modules = {
    react: { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value }] } },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-router-dom': { Link: 'a' }, 'lucide-react': { ArrowRight: 'svg', Search: 'svg' },
    '@/services/studio-package': { savedContentFormats: () => ['post'], formatLabels: { post: 'Social post' } },
  }
  const exports = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, fetch() { assert.fail('Draft browsing must not dispatch provider or mutation work') } })
  return {
    render(overrides = {}) { cursor = 0; return exports.StudioDraftList({ packages, loading: false, error: '', onRetry() { retries++ }, ...overrides }) },
    get retries() { return retries },
  }
}
const pack = (id, title, platform, content = {}, updatedAt = '2026-11-13T10:00:00Z') => ({ id, title, settings: { platform }, content, updatedAt })
const links = tree => flatten(tree).filter(node => node.type === 'a')
const control = (tree, name) => flatten(tree).find(node => node.props?.name === name)
const action = (tree, label) => flatten(tree).find(node => node.type === 'button' && text(node) === label)

test('draft filters combine title, exact platform and content presence; sorting never changes saved records', async () => {
  const packages = [pack('1', 'Alpha AI research', 'X, Instagram'), pack('2', 'Beta AI research', 'X', null, '2026-11-12T10:00:00Z'), pack('3', 'Gamma AI notes', 'LinkedIn', {}, 'invalid')]
  const snapshot = structuredClone(packages)
  const view = await setup(packages)
  let tree = view.render()
  assert.equal(links(tree).length, 3)
  control(tree, 'draft-platform').props.onChange({ target: { value: 'X' } }); tree = view.render()
  assert.deepEqual(links(tree).map(node => node.props.to), ['/studio/1', '/studio/2'])
  control(tree, 'draft-stage').props.onChange({ target: { value: 'brief' } }); tree = view.render()
  assert.equal(links(tree)[0].props['aria-label'], 'Finish setup: Beta AI research')
  control(tree, 'draft-search').props.onChange({ target: { value: '  ALPHA  ' } }); tree = view.render()
  assert.equal(links(tree).length, 0)
  assert.match(text(tree), /No matching drafts/)
  action(tree, 'Clear filters').props.onClick(); tree = view.render()
  assert.equal(links(tree).length, 3)
  control(tree, 'draft-sort').props.onChange({ target: { value: 'title' } }); tree = view.render()
  assert.equal(links(tree)[0].props.to, '/studio/1')
  control(tree, 'draft-sort').props.onChange({ target: { value: 'oldest' } }); tree = view.render()
  assert.equal(links(tree)[0].props.to, '/studio/3')
  assert.match(text(tree), /Date unavailable/)
  assert.deepEqual(packages, snapshot)
})

test('draft pages are bounded and return to the first page when searching; loading, empty and failure have honest states', async () => {
  const view = await setup(Array.from({ length: 23 }, (_, index) => pack(String(index), `Draft ${index}`, 'X')))
  let tree = view.render()
  assert.equal(links(tree).length, 10)
  assert.equal(action(tree, 'Previous drafts').props.disabled, true)
  action(tree, 'Next drafts').props.onClick(); tree = view.render()
  assert.match(text(tree), /Page 2 of 3/)
  action(tree, 'Next drafts').props.onClick(); tree = view.render()
  assert.equal(links(tree).length, 3)
  control(tree, 'draft-search').props.onChange({ target: { value: 'Draft 1' } }); tree = view.render()
  assert.match(text(tree), /Page 1 of 2/)
  assert.equal(action(tree, 'Previous drafts').props.disabled, true)
  assert.equal(links(view.render({ loading: true })).length, 0)
  assert.match(text(view.render({ packages: [] })), /Your first draft starts above/)
  tree = view.render({ error: 'Connection unavailable' })
  assert.equal(links(tree).length, 0)
  action(tree, 'Try loading drafts again').props.onClick()
  assert.equal(view.retries, 1)
})
