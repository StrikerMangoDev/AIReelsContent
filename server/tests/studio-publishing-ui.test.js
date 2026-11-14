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

async function packagePublishingHarness({ enabled = true, submit, storage = new Map(), reviewed = true, previewRevision = 4 } = {}) {
  const source = await readFile(new URL('../../src/pages/app/StudioPublishing.tsx', import.meta.url), 'utf8')
  const slots = []; const refs = []; const effects = []; const pending = []; let cursor = 0; let refCursor = 0; let effectCursor = 0; let tracking = false; let ids = 0
  const calls = []; const received = []
  const platforms = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']
  const accounts = platforms.map(platform => ({ id: `account-${platform}`, platform, name: `${platform} fixture` }))
  const pack = { id: 'manual-package', revision: 4, status: 'completed', settings: { platform: platforms.join(', ') }, content: { claims: [] }, independentReview: reviewed ? { status: 'passed' } : null, approval: reviewed ? { method: 'independent-human' } : null, mediaReview: reviewed ? { status: 'passed', method: 'independent-human' } : null, mediaApproval: reviewed ? { method: 'independent-human' } : null }
  const element = (type, props) => ({ type, props })
  const modules = {
    react: {
      useState(initial) { if (!tracking) return [typeof initial === 'function' ? initial() : initial, () => {}]; const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
      useRef(initial) { const index = refCursor++; refs[index] ||= { current: initial }; return refs[index] }, useCallback: value => value,
      useEffect(action, deps) { if (!tracking) return; const index = effectCursor++; const prior = effects[index]; if (!prior || JSON.stringify(prior.deps) !== JSON.stringify(deps)) { effects[index] = { deps, cleanup: prior?.cleanup }; pending.push(() => { effects[index].cleanup?.(); effects[index].cleanup = action() }) } },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    '@/services/studio-api': { async studioRequest(path, body, method = 'GET') {
      calls.push({ path, body, method })
      if (path.includes('/social-preview?')) {
        const platform = decodeURIComponent(path.split('platform=')[1])
        return { packageId: pack.id, revision: previewRevision, contentHash: 'saved-hash', platform, caption: `${platform} exact saved copy.\n\nSource: https://example.com/actual-source`, assets: [
          { id: 'image-a', kind: 'image', status: 'completed', current: true, mime: 'image/png', bytes: 1024 },
          { id: 'image-b', kind: 'image', status: 'completed', current: true, mime: 'image/png', bytes: 2048 },
          { id: 'video-a', kind: 'video', status: 'completed', current: true, mime: 'video/mp4', bytes: 4096 },
          { id: 'stale-image', kind: 'image', status: 'completed', current: false, mime: 'image/png', bytes: 1024 },
          { id: 'running-image', kind: 'image', status: 'running', current: true, mime: 'image/png', bytes: 1024 },
        ] }
      }
      if (method === 'POST') return submit ? submit(body) : { id: 'receipt', requestId: body.requestId, status: 'submitted', ...body }
      if (path.endsWith('/social-publications')) return { publications: received }
      throw new Error(`Unexpected read ${path}`)
    } },
  }
  const exports = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => { assert.ok(name in modules, name); return modules[name] }, Date, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  })
  const root = exports.StudioPublishing({ packageId: pack.id, pack })
  const child = flatten(root).find(node => typeof node.type === 'function' && node.type.name === 'PackagePublication')
  assert.ok(child, 'The current package exposes the actual manual-publication component')
  tracking = true
  let props = { pack, accounts, enabled, loading: false, disabled: false, publications: [], onReceipt: receipt => { received.unshift(receipt); props = { ...props, publications: [...received] } } }
  const render = () => { cursor = 0; refCursor = 0; effectCursor = 0; return child.type(props) }
  const settle = async () => { let tree; for (let index = 0; index < 4; index++) { tree = render(); pending.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)) } return tree }
  const field = (tree, name) => flatten(tree).find(node => node.props?.name === name)
  const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && text(node) === label)
  const writes = () => calls.filter(call => call.method === 'POST')
  return { settle, render, field, button, writes, calls, storage, received }
}

test('opening and selecting manual publishing reads only saved previews, supports five platforms and hides stale media', async () => {
  const h = await packagePublishingHarness()
  let tree = await h.settle()
  assert.equal(h.calls.length, 0)
  assert.equal(h.writes().length, 0)
  assert.equal(flatten(h.field(tree, 'package-publishing-account')).filter(node => node.type === 'option').length, 6)
  for (const platform of ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']) {
    h.field(tree, 'package-publishing-account').props.onChange({ target: { value: `account-${platform}` } }); tree = await h.settle()
    assert.ok(text(tree).includes(`${platform} exact saved copy.\n\nSource: https://example.com/actual-source`))
    assert.ok(h.field(tree, 'publish-asset-image-a'))
    assert.equal(h.field(tree, 'publish-asset-stale-image'), undefined)
    assert.equal(h.field(tree, 'publish-asset-running-image'), undefined)
    assert.equal(h.writes().length, 0)
  }
})

test('manual publishing requires explicit confirmation and sends exact server copy, ordered assets and a single stable request on all five platforms', async () => {
  for (const platform of ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']) {
    const h = await packagePublishingHarness(); let tree = await h.settle()
    h.field(tree, 'package-publishing-account').props.onChange({ target: { value: `account-${platform}` } }); tree = await h.settle()
    const assets = platform === 'YouTube' ? ['video-a'] : ['image-b', 'image-a']
    for (const id of assets) { h.field(tree, `publish-asset-${id}`).props.onChange({ target: { checked: true } }); tree = await h.settle() }
    h.button(tree, 'Send draft to Postiz').props.onClick(); await h.settle(); assert.equal(h.writes().length, 0)
    h.field(tree, 'package-publishing-confirmed').props.onChange({ target: { checked: true } }); tree = await h.settle()
    const send = h.button(tree, 'Send draft to Postiz'); assert.equal(send.props.disabled, false)
    send.props.onClick(); send.props.onClick(); tree = await h.settle()
    const [request] = h.writes(); assert.equal(h.writes().length, 1, platform)
    assert.equal(request.path, '/packages/manual-package/social-publications')
    assert.deepEqual(JSON.parse(JSON.stringify(request.body)), { requestId: '00000000-0000-4000-8000-000000000001', revision: 4, accountId: `account-${platform}`, platform, mode: 'draft', caption: `${platform} exact saved copy.\n\nSource: https://example.com/actual-source`, assetIds: assets, confirmed: true, automatic: false })
    send.props.onClick(); await h.settle(); assert.equal(h.writes().length, 1, 'A stale click handler cannot resubmit a recorded attempt')
  }
})

test('an uncertain manual publication stays held across action changes and remount without a blind retry', async () => {
  const storage = new Map()
  const h = await packagePublishingHarness({ storage, submit: async () => { throw new TypeError('Connection closed after dispatch') } })
  let tree = await h.settle()
  h.field(tree, 'package-publishing-account').props.onChange({ target: { value: 'account-Facebook' } }); tree = await h.settle()
  h.field(tree, 'publish-asset-image-a').props.onChange({ target: { checked: true } }); tree = await h.settle()
  h.field(tree, 'package-publishing-confirmed').props.onChange({ target: { checked: true } }); tree = await h.settle()
  const send = h.button(tree, 'Send draft to Postiz'); send.props.onClick(); tree = await h.settle()
  assert.equal(h.writes().length, 1); assert.match(text(tree), /previous post for this account is pending or uncertain/)
  send.props.onClick(); await h.settle(); assert.equal(h.writes().length, 1)
  h.field(tree, 'package-publishing-mode').props.onChange({ target: { value: 'now' } }); tree = await h.settle()
  assert.equal(h.button(tree, 'Publish now').props.disabled, true)
  const resumed = await packagePublishingHarness({ storage }); tree = await resumed.settle()
  resumed.field(tree, 'package-publishing-account').props.onChange({ target: { value: 'account-Facebook' } }); tree = await resumed.settle()
  assert.match(text(tree), /previous post for this account is pending or uncertain/)
  assert.equal(resumed.button(tree, 'Send draft to Postiz').props.disabled, true)
  assert.equal(resumed.writes().length, 0)
})

test('manual publishing reports missing connection, review and changed version without inventing readiness', async () => {
  for (const options of [{ enabled: false }, { reviewed: false }, { previewRevision: 5 }]) {
    const h = await packagePublishingHarness(options); let tree = await h.settle()
    h.field(tree, 'package-publishing-account').props.onChange({ target: { value: 'account-Facebook' } }); tree = await h.settle()
    assert.equal(h.button(tree, 'Send draft to Postiz').props.disabled, true)
    assert.equal(h.field(tree, 'package-publishing-confirmed').props.disabled, true)
    assert.match(text(tree), options.enabled === false ? /Publishing is not connected/ : options.reviewed === false ? /independent content review and owner approval/ : /Reload the saved publication preview/)
    h.button(tree, 'Send draft to Postiz').props.onClick(); await h.settle()
    assert.equal(h.writes().length, 0)
  }
})

test('schedule selection invalidates confirmation and sends a future UTC time without changing saved copy', async () => {
  const h = await packagePublishingHarness(); let tree = await h.settle()
  h.field(tree, 'package-publishing-account').props.onChange({ target: { value: 'account-YouTube' } }); tree = await h.settle()
  h.field(tree, 'publish-asset-video-a').props.onChange({ target: { checked: true } }); tree = await h.settle()
  h.field(tree, 'package-publishing-confirmed').props.onChange({ target: { checked: true } }); tree = await h.settle()
  h.field(tree, 'package-publishing-mode').props.onChange({ target: { value: 'schedule' } }); tree = await h.settle()
  assert.equal(h.field(tree, 'package-publishing-confirmed').props.checked, false)
  assert.equal(h.button(tree, 'Schedule this post').props.disabled, true)
  const time = new Date(Date.now() + 86400000).toISOString().slice(0, 16)
  h.field(tree, 'package-publishing-time').props.onChange({ target: { value: time } }); tree = await h.settle()
  h.field(tree, 'package-publishing-confirmed').props.onChange({ target: { checked: true } }); tree = await h.settle()
  h.button(tree, 'Schedule this post').props.onClick(); await h.settle()
  assert.equal(h.writes().length, 1)
  assert.equal(h.writes()[0].body.publishAt, new Date(time).toISOString())
  assert.equal(h.writes()[0].body.mode, 'schedule')
  assert.equal(h.writes()[0].body.caption, 'YouTube exact saved copy.\n\nSource: https://example.com/actual-source')
})
