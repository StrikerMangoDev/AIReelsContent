import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('workspace navigation closes on selection and Escape, restores focus and preserves workspace isolation', async () => {
  const source = await readFile(new URL('../../src/layouts/AppLayout.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const slots = []; let cursor = 0; let focused = false
  let scope = 'personal'; let identity = { uid: 'author', name: 'Author', role: 'member' }
  const element = (type, props, key) => ({ type, props, key })
  const modules = {
    react: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value }] },
      useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
      useEffect() {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'lucide-react': {},
    'react-router-dom': { Link: 'Link', NavLink: 'NavLink', Outlet: 'Outlet', useLocation: () => ({ pathname: '/ideas/topic' }), useSearchParams: () => [new URLSearchParams(), () => {}] },
    '@/context/auth-state': { useAuth: () => ({ identity }) },
    '@/services/workspace-session': { subscribeWorkspace() {}, activeWorkspace: () => scope },
    '@/services/firebase': {}, '@/components/common/Logo': {}, '@/components/ui/RegionPicker': {}, '@/styles/workspace.css': {},
  }
  const exports = {}
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, URLSearchParams })
  const render = () => { cursor = 0; return exports.AppLayout() }
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const find = (tree, predicate) => flatten(tree).find(predicate)
  const toggle = tree => find(tree, n => n.type === 'button' && n.props['aria-controls'] === 'workspace-navigation')
  const sidebar = tree => find(tree, n => n.type === 'aside')
  let tree = render()
  toggle(tree).props.ref.current = { focus() { focused = true } }
  toggle(tree).props.onClick(); tree = render()
  assert.equal(toggle(tree).props['aria-expanded'], true)
  sidebar(tree).props.onKeyDown({ key: 'Escape' }); tree = render()
  assert.equal(toggle(tree).props['aria-expanded'], false)
  assert.equal(focused, true)
  toggle(tree).props.onClick(); tree = render()
  find(tree, n => n.type === 'NavLink' && n.props.to === '/ideas').props.onClick(); tree = render()
  assert.equal(toggle(tree).props['aria-expanded'], false)
  assert.equal(find(tree, n => n.type === 'NavLink' && n.props.to === '/admin'), undefined)
  assert.equal(find(tree, n => n.type === 'Outlet').key, 'author:personal')
  scope = 'ws:team'; tree = render()
  assert.equal(find(tree, n => n.type === 'Outlet').key, 'author:ws:team')
  identity = { uid: 'admin', role: 'admin' }; tree = render()
  assert.ok(find(tree, n => n.type === 'NavLink' && n.props.to === '/admin'))
  assert.equal(find(tree, n => n.type === 'Outlet').key, 'admin:ws:team')
})
