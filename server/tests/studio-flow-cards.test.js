import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function components() {
  const source = await readFile(new URL('../../src/pages/app/StudioFlowCards.tsx', import.meta.url), 'utf8')
  const exports = {}; const element = (type, props) => ({ type, props })
  const icons = Object.fromEntries(['ArrowRight', 'Check', 'Clapperboard', 'ClipboardCheck', 'Compass', 'Download', 'FileText', 'History', 'Layers3', 'Link2', 'ListChecks', 'Send', 'Sparkles'].map(name => [name, 'svg']))
  const modules = { 'react/jsx-runtime': { jsx: element, jsxs: element }, 'lucide-react': icons, 'react-router-dom': { Link: 'a' } }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name] },
    fetch: () => { assert.fail('Workspace navigation must not call a provider or API') },
  })
  return exports
}
const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => node == null ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && text(node) === label)

test('Studio start choices link to saved ideas and toggle the article form without generating or navigating', async () => {
  const { StudioStartCards } = await components()
  let toggles = 0
  const render = articleOpen => StudioStartCards({ articleOpen, onArticleToggle: () => { toggles++ } })
  const closed = render(false)
  const topic = flatten(closed).find(node => node.type === 'a')
  assert.equal(topic.props.to, '/ideas')
  assert.equal(text(topic), 'Browse ideas')
  const openButton = flatten(closed).find(node => node.type === 'button')
  assert.equal(openButton.props.type, 'button')
  assert.equal(openButton.props['aria-controls'], 'studio-source-entry')
  assert.equal(openButton.props['aria-expanded'], false)
  assert.equal(toggles, 0)
  openButton.props.onClick()
  assert.equal(toggles, 1)
  const closeButton = flatten(render(true)).find(node => node.type === 'button')
  assert.equal(text(closeButton), 'Close article form')
  assert.equal(closeButton.props['aria-expanded'], true)
  closeButton.props.onClick()
  assert.equal(toggles, 2)
})

const destinations = [
  ['Content brief', 'package', 'brief'], ['Strategy workflow', 'package', 'workflow'], ['AI recommendations', 'package', 'decisions'],
  ['Production brief & media', 'production', undefined], ['External prompts', 'package', 'prompts'], ['Team tasks & assets', 'package', 'team'],
  ['Website SEO workflow', 'package', 'seo'], ['Sources & citation checks', 'sources', undefined], ['Rules & disclosures', 'package', 'rules'],
  ['Account plans & publishing', 'publishing', undefined], ['Performance & learning', 'package', 'results'], ['Publication receipts', 'package', 'posting'],
  ['Download writing & production file', 'download', undefined], ['Complete package export', 'package', 'downloads'], ['Version history', 'history', undefined],
]

test('every workspace guide action opens its existing destination once and never starts work', async () => {
  const { StudioWorkspaceGuide } = await components()
  const calls = []
  const tree = StudioWorkspaceGuide({ hasContent: true, hasWebsite: true, onOpen: (panel, view) => { calls.push([panel, view]) } })
  assert.equal(calls.length, 0, 'Rendering a guide is read-only')
  for (const [label, panel, view] of destinations) {
    const action = button(tree, label)
    assert.ok(action, `Missing destination: ${label}`)
    assert.equal(Boolean(action.props.disabled), false, label)
    action.props.onClick()
    assert.deepEqual(calls.at(-1), [panel, view], label)
  }
  const path = flatten(tree).find(node => node.type === 'ol' && node.props['aria-label'] === 'Content creation path')
  const steps = flatten(path).filter(node => node.type === 'button')
  assert.equal(steps.length, 3)
  for (const [index, panel] of ['setup', 'write', 'download'].entries()) {
    steps[index].props.onClick()
    assert.deepEqual(calls.at(-1), [panel, undefined])
  }
  assert.equal(calls.length, flatten(tree).filter(node => node.type === 'button').length, 'Every button has exactly one navigation action')
})

test('pre-generation guide keeps planning reachable, explains locked content actions and omits irrelevant website tooling', async () => {
  const { StudioWorkspaceGuide } = await components()
  const calls = []
  const tree = StudioWorkspaceGuide({ hasContent: false, hasWebsite: false, onOpen: (panel, view) => { calls.push([panel, view]) } })
  assert.equal(button(tree, 'Website SEO workflow'), undefined)
  assert.match(text(tree), /Generate your content in Setup to unlock/)
  for (const label of ['AI recommendations', 'Production brief & media', 'External prompts', 'Sources & citation checks', 'Account plans & publishing', 'Download writing & production file', 'Complete package export', 'Version history']) assert.equal(button(tree, label).props.disabled, true, label)
  for (const label of ['Content brief', 'Strategy workflow', 'Team tasks & assets', 'Rules & disclosures', 'Performance & learning', 'Publication receipts']) {
    const action = button(tree, label)
    assert.equal(Boolean(action.props.disabled), false, label)
    action.props.onClick()
  }
  const path = flatten(tree).find(node => node.type === 'ol' && node.props['aria-label'] === 'Content creation path')
  const steps = flatten(path).filter(node => node.type === 'button')
  assert.deepEqual(steps.map(node => Boolean(node.props.disabled)), [false, true, true])
  steps[0].props.onClick()
  assert.equal(calls.length, 7)
  const website = StudioWorkspaceGuide({ hasContent: false, hasWebsite: true, onOpen: (panel, view) => { calls.push([panel, view]) } })
  assert.equal(Boolean(button(website, 'Website SEO workflow').props.disabled), false)
  button(website, 'Website SEO workflow').props.onClick()
  assert.deepEqual(calls.at(-1), ['package', 'seo'])
})
