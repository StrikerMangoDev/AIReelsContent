import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('review form and notes survive transient identity checking while submission is blocked', async () => {
  const source = await readFile(new URL('../../src/pages/app/StudioReviewPage.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const slots = []; const effects = []; let cursor = 0; let posts = 0
  const auth = { identity: { uid: 'bob' }, loading: false }
  const element = (type, props, key) => ({ type, props, key })
  const modules = {
    react: { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] }, useEffect(effect) { effects.push(effect) } },
    'react/jsx-runtime': { jsx: element, jsxs: element }, 'react-router-dom': { Link: 'a', useParams: () => ({ owner: 'alice', packageId: 'p1' }) },
    '@/context/auth-state': { useAuth: () => auth }, './ContentPreview': {}, '@/styles/studio.css': {},
    '@/services/studio-api': { studioRequest: async (_path, _body, method) => { if (method === 'POST') posts++; return { title: 'Draft', revision: 1, evidence: [], content: { claims: [{ id: 'C1', text: 'Claim', quote: 'Passage', evidenceId: 'E1' }] } } } },
  }
  modules['@/services/studio-api'].studioRead = (path, authenticated = true) => modules['@/services/studio-api'].studioRequest(path, undefined, 'GET', authenticated)
  const exports = {}; runInNewContext(code, { exports, require: name => modules[name] })
  const first = exports.StudioReviewPage(); const workspace = first.type
  const render = checkingIdentity => { cursor = 0; effects.length = 0; return workspace({ ...first.props, checkingIdentity }) }
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  render(false); effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve))
  let tree = render(false)
  flatten(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: 'My independent source rationale.' } })
  tree = render(true)
  assert.ok(flatten(tree).some(node => node.type === 'form'))
  assert.equal(flatten(tree).find(node => node.type === 'textarea').props.value, 'My independent source rationale.')
  assert.equal(flatten(tree).find(node => node.type === 'fieldset').props.disabled, true)
  flatten(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); assert.equal(posts, 0)
  auth.loading = true; assert.equal(exports.StudioReviewPage().key, first.key)
  auth.identity = { uid: 'charlie' }; assert.notEqual(exports.StudioReviewPage().key, first.key)
  tree = render(false); assert.equal(flatten(tree).find(node => node.type === 'fieldset').props.disabled, false)
  assert.equal(flatten(tree).find(node => node.type === 'textarea').props.value, 'My independent source rationale.')
})
