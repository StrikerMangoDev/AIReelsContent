import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'object' ? [value, ...flatten(value.props?.children)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : ''
async function harness() {
  const source = await readFile(new URL('../../src/pages/app/StudioStrategyWorkflow.tsx', import.meta.url), 'utf8')
  const exports = {}; const element = (type, props) => ({ type, props })
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  runInNewContext(code, { exports, require: name => { assert.equal(name, 'react/jsx-runtime'); return { jsx: element, jsxs: element } }, crypto: { randomUUID: () => 'new-id' }, Date })
  const expand = value => !value ? value : Array.isArray(value) ? value.map(expand) : typeof value === 'object' && typeof value.type === 'function' ? expand(value.type(value.props)) : typeof value === 'object' ? { ...value, props: { ...value.props, children: expand(value.props?.children) } } : value
  return { render: props => expand(exports.StudioStrategyWorkflow(props)), button: (tree, name) => flatten(tree).find(node => node.type === 'button' && text(node) === name), input: (tree, name) => flatten(tree).find(node => ['input', 'textarea', 'select'].includes(node.type) && node.props.name === name) }
}

test('all five platforms edit only their selected destination and retain other account records', async () => {
  const h = await harness()
  for (const platform of ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']) {
    const untouched = { platform: 'Instagram', accountId: 'other-account', audienceQuestions: [] }
    let changed
    const props = { context: { workflow: { version: 'strategy-workflow-v1', destinations: [untouched] } }, platform, accountId: `${platform}-account`, contentHash: 'a'.repeat(64), disabled: false, onChange: value => { changed = value } }
    const tree = h.render(props)
    h.button(tree, 'Add anonymized audience question').props.onClick()
    assert.equal(changed.workflow.destinations.length, 2)
    assert.equal(changed.workflow.destinations[0], untouched)
    const record = changed.workflow.destinations[1]
    assert.equal(record.platform, platform); assert.equal(record.accountId, `${platform}-account`)
    assert.equal(record.audienceQuestions[0].anonymized, false, 'privacy confirmation requires an actual choice')
    const editTree = h.render({ ...props, context: changed })
    h.input(editTree, 'question').props.onChange({ target: { value: 'How can beginners check this claim?' } })
    assert.equal(changed.workflow.destinations[1].audienceQuestions[0].question, 'How can beginners check this claim?')
  }
})

test('missing destinations and disabled review roles cannot mutate workflow context', async () => {
  const h = await harness()
  for (const props of [{ accountId: '', disabled: false }, { accountId: 'ig', disabled: true }]) {
    let changed = false
    const tree = h.render({ context: {}, platform: 'Instagram', contentHash: 'a'.repeat(64), ...props, onChange: () => { changed = true } })
    h.button(tree, 'Define the primary goal').props.onClick()
    assert.equal(changed, false)
    assert.ok(flatten(tree).some(node => node.type === 'fieldset' && node.props.disabled))
  }
})

test('expert approval remains bound to reviewed content until explicitly confirmed for a new revision', async () => {
  const h = await harness(); let changed
  const oldHash = 'b'.repeat(64); const contentHash = 'c'.repeat(64)
  const destination = { platform: 'YouTube', accountId: 'yt', expertReview: { required: true, status: 'approved', reviewer: 'Actual subject expert', reviewedAt: '2026-11-12T00:00:00.000Z', contentHash: oldHash, note: 'Scope reviewed' } }
  const props = { context: { workflow: { version: 'strategy-workflow-v1', destinations: [destination] } }, platform: 'YouTube', accountId: 'yt', contentHash, disabled: false, onChange: value => { changed = value } }
  const tree = h.render(props)
  h.input(tree, 'note').props.onChange({ target: { value: 'Clarified review scope' } })
  assert.equal(changed.workflow.destinations[0].expertReview.contentHash, oldHash, 'editing a note cannot silently reapprove content')
  h.button(tree, 'Confirm actual expert approval for this saved content').props.onClick()
  assert.equal(changed.workflow.destinations[0].expertReview.contentHash, contentHash)
})

test('workflow exposes all guided records, dated checks and actual backend readiness without inventing completion', async () => {
  const h = await harness()
  const tree = h.render({ context: {}, platform: 'Facebook', accountId: 'fb', contentHash: 'a'.repeat(64), disabled: false, onChange() {}, report: { version: 'strategy-workflow-v1', status: 'needs_attention', destinations: [{ platform: 'Facebook', accountId: 'fb', status: 'needs_attention', issues: ['Add a matching success metric'], candidates: [], learnings: [], steps: [{ id: 'goal', title: 'Set the business goal', status: 'needs_attention', detail: 'No matching metric recorded' }] }], limitations: ['No independent review is claimed.'] } })
  const result = text(tree)
  for (const label of ['Audience question bank', 'Research, competitors', 'Topic selection', 'Search language', 'Expert review', 'Community replies', 'Results → next-cycle decisions', 'No matching metric recorded', 'No independent review is claimed.']) assert.ok(result.includes(label), label)
  assert.equal(result.includes('All checks passed'), false)
})

test('rechecking one stale execution item cannot silently renew other asset and publication confirmations', async () => {
  const h = await harness(); let changed
  const destination = { platform: 'Instagram', accountId: 'ig', checklist: { contentHash: 'b'.repeat(64), originalityChecked: true, hookFulfilled: true, phonePreviewChecked: true, soundOffChecked: true, linksChecked: true, livePostInspected: true, liveUrl: 'https://example.com/old-live-post' } }
  const tree = h.render({ context: { workflow: { version: 'strategy-workflow-v1', destinations: [destination] } }, platform: 'Instagram', accountId: 'ig', contentHash: 'a'.repeat(64), disabled: false, onChange: value => { changed = value } })
  h.input(tree, 'hookFulfilled').props.onChange({ target: { checked: true } })
  const checks = changed.workflow.destinations[0].checklist
  assert.equal(checks.contentHash, 'a'.repeat(64)); assert.equal(checks.hookFulfilled, true)
  for (const key of ['originalityChecked', 'phonePreviewChecked', 'soundOffChecked', 'linksChecked', 'livePostInspected']) assert.equal(checks[key], false)
  assert.equal(checks.liveUrl, undefined)
})

test('explicit strategy removal is scoped to the current account without mutating input or deleting other strategies', async () => {
  const h = await harness(); let changed
  const first = { platform: 'Facebook', accountId: 'fb', goal: { primary: 'reach', kpi: 'reach', targetAction: 'Read', reviewAfterHours: 48 } }
  const other = { platform: 'YouTube', accountId: 'yt', goal: { primary: 'trust', kpi: 'saves', targetAction: 'Save', reviewAfterHours: 48 } }
  const context = { workflow: { version: 'strategy-workflow-v1', destinations: [first, other] } }
  const tree = h.render({ context, platform: 'Facebook', accountId: 'fb', contentHash: 'a'.repeat(64), disabled: false, onChange: value => { changed = value } })
  assert.match(text(tree), /Discard unsaved context to restore them before saving/)
  h.button(tree, 'Remove this account strategy').props.onClick()
  assert.equal(changed.workflow.destinations.length, 1)
  assert.equal(changed.workflow.destinations[0], other)
  assert.equal(context.workflow.destinations.length, 2)
})

test('editorial question hypotheses keep zero observed occurrences and do not invent account demand', async () => {
  const h = await harness(); let changed
  const context = { workflow: { version: 'strategy-workflow-v1', destinations: [{ platform: 'LinkedIn', accountId: 'li', audienceQuestions: [{ id: 'question', question: 'Which limitation should beginners check?', source: 'faq', audience: 'Beginners', occurrences: 1, observedAt: '2026-11-12T00:00:00Z', anonymized: true }] }] } }
  const tree = h.render({ context, platform: 'LinkedIn', accountId: 'li', contentHash: 'a'.repeat(64), disabled: false, onChange: value => { changed = value } })
  h.input(tree, 'source').props.onChange({ target: { value: 'editorial-hypothesis' } })
  const question = changed.workflow.destinations[0].audienceQuestions[0]
  assert.equal(question.occurrences, 0); assert.equal(question.hypothesis, true)
  assert.match(text(tree), /does not establish account demand/)
})

test('machine evidence is shown separately from reported previews and never turns on human checkboxes', async () => {
  const h = await harness(); const context = {}
  const report = { version: 'strategy-workflow-v1', status: 'needs_attention', limitations: [], destinations: [{ platform: 'Instagram', accountId: 'ig', status: 'needs_attention', steps: [], candidates: [], learnings: [], issues: [], machineAssessment: { method: 'server-machine-assessment', checkedAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-13T00:00:00Z', contentHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64), checks: { boundedLayout: true, soundOffText: true }, limitations: ['Actual phone playback was not performed.'] } }] }
  const tree = h.render({ context, platform: 'Instagram', accountId: 'ig', contentHash: 'a'.repeat(64), disabled: false, onChange: () => assert.fail('Reading machine evidence cannot change workspace attestations'), report })
  assert.match(text(tree), /Machine checks for this saved media/)
  assert.match(text(tree), /Actual phone playback was not performed/)
  assert.match(text(tree), /Bounded Layout: Passed/)
  assert.deepEqual(context, {})
})

test('official trend readout keeps unavailable countries explicit and filters other destinations', async () => {
  const h = await harness()
  const base = { id: 'capture', platform: 'X', accountId: 'x', status: 'unavailable', reason: 'An explicit country is required.', country: null, topic: 'AI explanation', sourceUrl: null, capturedAt: '2026-11-12T00:00:00Z', freshness: 'within_capture_window', matches: [], limitations: ['No growth or virality is established.'] }
  const tree = h.render({ context: {}, platform: 'X', accountId: 'x', contentHash: 'a'.repeat(64), disabled: false, onChange: () => assert.fail('Reading trend records cannot mutate strategy'), trendIntakes: [base, { ...base, id: 'other', platform: 'Instagram', accountId: 'ig', reason: 'DO NOT SHOW ANOTHER ACCOUNT' }] })
  assert.match(text(tree), /Country not selected/); assert.match(text(tree), /explicit country is required/)
  assert.doesNotMatch(text(tree), /DO NOT SHOW ANOTHER ACCOUNT/)
})
