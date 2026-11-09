import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
test('account plans keep distinct briefs, require explicit automation consent and never send stored server metadata', async () => {
  const source = await readFile(new URL('../../src/pages/app/StudioPublishing.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const profile = { accountId: 'account-a', revision: 2, weeklyBrief: 'Explain practical AI for small business owners.', audience: 'Small business owners', tone: 'Plain and useful', contentPillars: ['Practical AI', 'Daily developments'], weeklyCadence: 3, dailyNews: true, maxDailyPosts: 1, enabled: true, automationConsent: true, id: 'server-record', automaticPolicy: { consentedBy: 'owner' } }
  const calls = []; const slots = []; let cursor = 0; let effectCursor = 0; const effects = []; const timers = []
  const element = (type, props) => ({ type, props })
  const modules = {
    react: { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] }, useEffect(action, deps) { const index = effectCursor++; const prior = effects[index]; if (!prior || JSON.stringify(prior.deps) !== JSON.stringify(deps)) { prior?.cleanup?.(); effects[index] = { deps, cleanup: action() } } } },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    '@/services/studio-api': { async studioRequest(path, body, method) {
      calls.push({ path, body, method })
      if (path === '/publishing/config') return { enabled: true, accounts: [{ id: 'account-a', name: 'Vikash Kumar', platform: 'LinkedIn' }, { id: 'account-b', name: 'Vikash Kumar', platform: 'Facebook' }] }
      if (path === '/publishing/profiles') return method === 'PUT' ? { ...body, revision: body.revision + 1 } : { profiles: [profile] }
      if (path === '/automation') return { plans: [], runs: [], requests: [], requestResults: [] }
      if (path.endsWith('/social-publications') || path === '/publishing/receipts') return { publications: [{ id: 'receipt-1', status: 'dispatch_unknown', mode: 'now', accountId: 'account-a', platform: 'LinkedIn', caption: 'Actual sent caption', createdAt: new Date().toISOString() }] }
      return { id: 'receipt-1', status: 'submitted', mode: 'now', accountId: 'account-a', platform: 'LinkedIn', caption: 'Actual sent caption', createdAt: new Date().toISOString() }
    } },
  }
  const exports = {}
  runInNewContext(code, { exports, window: { setInterval(action) { timers.push(action); return timers.length }, clearInterval() {} }, require: name => { assert.ok(name in modules, name); return modules[name] } })
  const render = (props = { packageId: 'package-1' }) => { cursor = 0; effectCursor = 0; return exports.StudioPublishing(props) }
  const named = (tree, name) => flatten(tree).find(node => node.props?.name === name)
  render(); await new Promise(resolve => setImmediate(resolve)); let tree = render()
  assert.match(text(tree), /dispatch unknown/)
  assert.equal(text(flatten(tree).find(node => node.type === 'strong')), 'Vikash Kumar · LinkedIn')
  assert.match(text(flatten(tree).find(node => node.type === 'h4')), /Vikash Kumar · LinkedIn/)
  assert.doesNotMatch(text(tree), /Open published post/)
  named(tree, 'publishing-account').props.onChange({ target: { value: 'account-a' } }); tree = render()
  assert.equal(named(tree, 'weekly-brief').props.value, profile.weeklyBrief)
  named(tree, 'automation-consent').props.onChange({ target: { checked: false } }); tree = render()
  assert.equal(named(tree, 'automation-enabled').props.checked, false)
  assert.equal(named(tree, 'automation-enabled').props.disabled, true)
  flatten(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve)); tree = render()
  const saved = calls.find(call => call.method === 'PUT')
  assert.equal(saved.body.automationConsent, false); assert.equal(saved.body.enabled, false)
  assert.equal(saved.body.id, undefined); assert.equal(saved.body.automaticPolicy, undefined)
  named(tree, 'publishing-account').props.onChange({ target: { value: 'account-b' } }); tree = render()
  assert.equal(named(tree, 'weekly-brief').props.value, '')
  assert.equal(named(tree, 'automation-consent').props.checked, false)
  flatten(tree).find(node => node.type === 'button' && text(node) === 'Check post status').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
  assert.equal(calls.find(call => call.method === 'POST').path, '/social-publications/receipt-1/refresh')
  render({}); await new Promise(resolve => setImmediate(resolve)); tree = render({})
  assert.ok(calls.some(call => call.path === '/publishing/receipts'))
  assert.equal(calls.some(call => call.path.includes('/packages/undefined/')), false)
  assert.match(text(tree), /Create from saved plans/)
  await timers.at(-1)()
  assert.equal(calls.some(call => call.path === '/automation/run'), false, 'status polling cannot start new content or publication')
  assert.ok(calls.filter(call => call.method === 'POST').every(call => call.path.endsWith('/refresh')))
})

test('local media describes actual silent captioned output while preserving configured legacy clip labels', async () => {
  const source = await readFile(new URL('../../src/pages/app/StudioMedia.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  for (const local of [true, false]) {
    const slots = []; const effects = []; let cursor = 0; let effectCursor = 0
    const element = (type, props) => ({ type, props })
    const modules = {
      react: { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] }, useCallback: value => value, useRef: () => ({ current: null }), useEffect(action) { const index = effectCursor++; if (!effects[index]) { effects[index] = true; action() } } },
      'react/jsx-runtime': { jsx: element, jsxs: element },
      '@/services/studio-api': { studioAuthHeaders: async () => ({}), studioRequest: async path => path === '/media/config' ? { image: { enabled: true, estimatedUsd: local ? 0 : 0.04, ...(local ? { method: 'editorial-local-v1' } : {}) }, video: { enabled: true, estimatedUsd: local ? 0 : 1, ...(local ? { method: 'editorial-local-v1' } : {}) }, audio: { enabled: false, estimatedUsd: null } } : { assets: [] } },
      '@/services/reel': { renderReel: () => { throw new Error('This copy check must not render media') } },
      '@/context/auth-state': { useAuth: () => ({ identity: { uid: 'owner' } }) },
    }
    const exports = {}
    runInNewContext(code, { exports, sessionStorage: { getItem: () => null }, require: name => { assert.ok(name in modules, name); return modules[name] } })
    const render = () => { cursor = 0; effectCursor = 0; return exports.StudioMedia({ packageId: 'package-a', initialPrompt: 'A source-backed production direction', script: 'A source-backed narration sentence.', scenes: [] }) }
    render(); await new Promise(resolve => setImmediate(resolve)); const tree = render()
    const video = flatten(tree).find(node => node.type === 'option' && node.props.value === 'video')
    const audio = flatten(tree).find(node => node.type === 'option' && node.props.value === 'audio')
    assert.equal(audio.props.disabled, true)
    if (local) {
      assert.equal(text(video), 'Captioned video (silent MP4)')
      assert.match(text(tree), /No voiceover, music or stock footage is added/)
      assert.match(text(tree), /Production note \(saved with the asset\)/)
      assert.doesNotMatch(text(tree), /8-second illustrative clip/)
    } else assert.equal(text(video), '8-second illustrative clip')
  }
})
