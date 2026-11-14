import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'object' ? [value, ...flatten(value.props?.children)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : ''
const empty = () => ({ version: 'website-seo-v1', enabled: true, pages: [], competitors: [], keywords: [], research: [], outline: [], calendar: [], metrics: [], decisions: [] })
async function harness() {
  const source = await readFile(new URL('../../src/pages/app/StudioSeoWorkflow.tsx', import.meta.url), 'utf8')
  const exports = {}; const element = (type, props) => ({ type, props })
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  runInNewContext(code, { exports, require: name => { assert.equal(name, 'react/jsx-runtime'); return { jsx: element, jsxs: element } }, crypto: { randomUUID: () => 'new-id' }, Date, Map })
  const expand = value => !value ? value : Array.isArray(value) ? value.map(expand) : typeof value === 'object' && typeof value.type === 'function' ? expand(value.type(value.props)) : typeof value === 'object' ? { ...value, props: { ...value.props, children: expand(value.props?.children) } } : value
  return { render: props => expand(exports.StudioSeoWorkflow({ contentHash: 'a'.repeat(64), disabled: false, dirty: false, onAudit() {}, ...props })), button: (tree, name) => flatten(tree).find(node => node.type === 'button' && text(node) === name), input: (tree, name) => flatten(tree).find(node => ['input', 'textarea', 'select'].includes(node.type) && node.props.name === name) }
}

test('website workflow is opt-in and preserves social context without writing human approvals', async () => {
  const h = await harness(); let changed
  const social = { version: 'strategy-workflow-v1', destinations: [{ platform: 'X', accountId: 'x' }] }
  const context = { workflow: social, brand: 'Saved brand' }
  h.button(h.render({ context, onChange: value => { changed = value } }), 'Start website SEO workflow').props.onClick()
  assert.equal(changed.workflow, social); assert.equal(changed.brand, 'Saved brand')
  assert.equal(changed.seoWorkflow.enabled, true); assert.equal(changed.seoWorkflow.checks, undefined)
  assert.equal(context.seoWorkflow, undefined)
})

test('measured zero stays zero and clearing a metric restores unknown rather than inventing zero', async () => {
  const h = await harness(); let changed
  const workflow = { ...empty(), keywords: [{ id: 'k', phrase: 'AI guide', intent: 'informational', role: 'primary', provider: 'Reported source', sourceUrl: 'https://example.com/report', observedAt: '2026-11-12T00:00:00Z', region: 'India', period: 'October 2026' }] }
  const props = { context: { seoWorkflow: workflow }, onChange: value => { changed = value } }
  const tree = h.render(props)
  h.input(tree, 'volume').props.onChange({ target: { value: '0' } })
  assert.equal(changed.seoWorkflow.keywords[0].volume, 0)
  h.input(h.render({ ...props, context: changed }), 'volume').props.onChange({ target: { value: '' } })
  assert.equal('volume' in changed.seoWorkflow.keywords[0], false)
  assert.equal(changed.seoWorkflow.keywords[0].difficulty, undefined)
})

test('new content cannot silently inherit old originality or search intent confirmations', async () => {
  const h = await harness(); let changed
  const workflow = { ...empty(), checks: { contentHash: 'b'.repeat(64), originality: 'reported_checked', intentSatisfied: true, addedValue: true, note: 'Old review' } }
  const tree = h.render({ context: { seoWorkflow: workflow }, onChange: value => { changed = value } })
  h.input(tree, 'intentSatisfied').props.onChange({ target: { checked: true } })
  assert.equal(changed.seoWorkflow.checks.contentHash, 'a'.repeat(64))
  assert.equal(changed.seoWorkflow.checks.intentSatisfied, true)
  assert.equal(changed.seoWorkflow.checks.originality, 'not_checked')
  assert.equal(changed.seoWorkflow.checks.addedValue, false)
  assert.equal(changed.seoWorkflow.checks.note, '')
})

test('performance recording requires an explicit segment and preserves unknown conversions', async () => {
  const h = await harness(); let changed
  const props = { context: { seoWorkflow: empty() }, onChange: value => { changed = value } }
  h.button(h.render(props), 'Add SEO performance record').props.onClick()
  assert.equal(changed.seoWorkflow.metrics[0].segment, '', 'filters are not assumed')
  const tree = h.render({ ...props, context: changed })
  assert.equal(h.input(tree, 'segment').props.required, true)
  assert.equal(h.input(tree, 'position').props.min, 1)
  h.input(tree, 'clicks').props.onChange({ target: { value: '0' } })
  assert.equal(changed.seoWorkflow.metrics[0].clicks, 0)
  assert.equal(changed.seoWorkflow.metrics[0].conversions, undefined)
})

test('inspection requires saved inputs and disabled viewers cannot create or edit workflow records', async () => {
  const h = await harness(); let calls = 0
  h.button(h.render({ context: {}, disabled: true, onChange: () => calls++ }), 'Start website SEO workflow').props.onClick()
  assert.equal(calls, 0)
  const workflow = { ...empty(), pages: [{ id: 'p', url: 'https://example.com/article', purpose: 'Educate', supportingKeywordIds: [], action: 'create', rationale: 'A useful gap' }] }
  for (const state of [{ dirty: true, disabled: false }, { dirty: false, disabled: true }]) {
    const tree = h.render({ context: { seoWorkflow: workflow }, ...state, onChange: () => calls++, onAudit: () => calls++ })
    const button = h.button(tree, 'Inspect page https://example.com/article')
    assert.equal(button.props.disabled, true); button.props.onClick()
    assert.equal(calls, 0)
  }
})

test('SEO stage and connection limitations remain visible, with null priorities shown as unavailable', async () => {
  const h = await harness()
  const workflow = { ...empty(), keywords: [{ id: 'k', phrase: 'AI guide', intent: 'informational', role: 'primary', provider: 'Reported source', sourceUrl: 'https://example.com/report', observedAt: '2026-11-12T00:00:00Z', region: 'India', period: 'October 2026' }] }
  const report = { applicable: false, status: 'not_applicable', steps: [], conflicts: [], keywordPriority: [{ keywordId: 'k', score: null, maxScore: 10, rationale: 'Difficulty unavailable.' }], audits: [], performance: [], refreshRecommendations: [], connections: [{ id: 'search_console', status: 'not_connected', reason: 'No server integration.' }], limitations: ['Reported measurements are not independently verified.'] }
  const result = text(h.render({ context: { seoWorkflow: workflow }, report, onChange() {} }))
  for (const label of ['Website and business research', 'Competitors and content gaps', 'Keywords and search intent', 'Page mapping, topic clusters and calendar', 'Content research and article outline', 'Editing and on-page SEO checks', 'Website publishing, sitemap and indexing', 'Search performance and content updates', 'Search console: Not connected', 'Last saved editorial priority: Unavailable', 'SEO readiness does not hold social-only content']) assert.ok(result.includes(label), label)
  assert.doesNotMatch(result, /Last saved editorial priority: (?:null|0)\/10/)
})
