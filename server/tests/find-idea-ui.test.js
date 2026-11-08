import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && text(node).trim() === label)
const topic = tree => flatten(tree).find(node => node.type === 'input' && node.props.id === 'simple-topic')
const description = tree => flatten(tree).find(node => node.type === 'textarea' && node.props.maxLength === 4000)
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

async function harness({ enabled = false, respond = async () => { throw new Error('Unexpected request') } } = {}) {
  const source = await readFile(new URL('../../src/pages/app/FindIdeaPage.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const slots = []; const effects = []; const cleanups = []; const requests = []; const navigations = []; let cursor = 0; let id = 0
  const element = (type, props, key) => ({ type, props, key })
  const modules = {
    react: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
      useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
      useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i][index])) { effects.push(effect); slots[i] = deps } },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-router-dom': { Link: 'a', useNavigate: () => path => navigations.push(path) },
    'lucide-react': { ArrowRight: 'svg', Sparkles: 'svg' },
    '@/context/auth-state': { useAuth: () => ({ identity: { uid: 'alice' }, loading: false }) },
    '@/services/studio-api': { studioRequest: async (path, body, method) => {
      if (path === '/config') return { capabilities: { generation: enabled, research: enabled } }
      requests.push({ path, body, method }); return respond(path, body)
    } },
    './CategorySetupFields': { CategorySetupFields: 'category-settings' },
    '@/services/category-setup': { categoryDefaults: { coverage: 'international', country: '', topics: [], intent: '', exclusions: '', refreshIntervalDays: 7, autoRefresh: false, language: 'Auto', windowDays: 7 } },
    './IdeaLibrary': { CategoryCover: 'cover' }, '@/styles/studio.css': {}, '@/styles/discovery.css': {},
  }
  const exports = {}
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, crypto: { randomUUID: () => `request-${++id}` } })
  const render = () => { cursor = 0; return exports.FindIdeaPage() }
  let tree = render(); for (const effect of effects.splice(0)) { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup) } await tick(); tree = render()
  const submit = value => flatten(value).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  return { render, tree, requests, navigations, submit, unmount: () => cleanups.forEach(cleanup => cleanup()) }
}

test('Find ideas checks saved matches with providers off; examples only edit text and reuse navigates without research', async () => {
  const h = await harness({ respond: async path => { assert.equal(path, '/intelligence/ideas/check'); return { action: 'reuse', matchedId: 'ai-category', requestedTrending: true } } })
  let tree = h.tree
  assert.equal(button(tree, 'Help me describe it').props.disabled, true)
  button(tree, 'AI').props.onClick(); tree = h.render()
  assert.equal(topic(tree).props.value, 'AI'); assert.equal(h.requests.length, 0)
  topic(tree).props.onChange({ target: { value: 'trending AI content' } }); tree = h.render()
  assert.equal(button(tree, 'Find ideas').props.disabled, false)
  h.submit(tree); h.submit(tree); await tick()
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body.input.topic, 'trending AI content')
  assert.deepEqual(h.navigations, ['/ideas/ai-category?reused=1&trending=1'])
})

test('preferences stay optional and missing national country opens the fields without dispatch', async () => {
  const h = await harness()
  let tree = h.tree
  const settings = value => flatten(value).find(node => node.type === 'category-settings')
  assert.equal(settings(tree).props.disabled, true, 'collapsed native required controls cannot block the main form')
  assert.equal(flatten(tree).some(node => node.type === 'aside'), false)
  button(tree, 'News').props.onClick(); tree = h.render()
  button(tree, 'Change preferences').props.onClick(); tree = h.render()
  assert.equal(settings(tree).props.disabled, false)
  settings(tree).props.onChange({ coverage: 'national', country: '' }); tree = h.render()
  button(tree, 'Close preferences').props.onClick(); tree = h.render()
  h.submit(tree); await tick(); tree = h.render()
  assert.equal(settings(tree).props.disabled, false)
  assert.ok(flatten(tree).some(node => node.props?.role === 'alert' && text(node).includes('Choose a country')))
  assert.equal(h.requests.length, 0)
})

test('AI help remains editable, starts no research and ignores replies for an edited topic', async () => {
  const pending = deferred(); let helpCalls = 0
  const h = await harness({ enabled: true, respond: async path => {
    assert.equal(path, '/intelligence/ideas/help'); helpCalls++
    return helpCalls === 1 ? pending.promise : { brief: 'Explore Vastu traditions with clearly attributed sources.' }
  } })
  let tree = h.tree; button(tree, 'AI').props.onClick(); tree = h.render()
  button(tree, 'Help me describe it').props.onClick(); tree = h.render()
  topic(tree).props.onChange({ target: { value: 'Vastu' } }); pending.resolve({ brief: 'Old AI request description.' }); await tick(); tree = h.render()
  assert.equal(description(tree), undefined); assert.equal(topic(tree).props.value, 'Vastu')
  button(tree, 'Help me describe it').props.onClick(); await tick(); tree = h.render()
  assert.match(description(tree).props.value, /Vastu traditions/)
  description(tree).props.onChange({ target: { value: 'My own narrower description.' } }); tree = h.render()
  assert.equal(description(tree).props.value, 'My own narrower description.')
  assert.equal(h.requests.length, 2); assert.equal(h.navigations.length, 0)
  assert.notEqual(h.requests[0].body.requestId, h.requests[1].body.requestId)
})

test('new-category audit requires explicit creation and editing invalidates the decision', async () => {
  const h = await harness({ respond: async path => {
    if (path === '/intelligence/ideas/check') return { id: 'audit-1', action: 'new', name: 'Astrology', brief: 'Explore astrology traditions and their cultural context.', requestedTrending: false }
    assert.equal(path, '/intelligence/ideas/create'); return { id: 'new-category', revision: 1 }
  } })
  let tree = h.tree; button(tree, 'Astrology').props.onClick(); tree = h.render(); h.submit(tree); await tick(); tree = h.render()
  assert.equal(h.requests.length, 1); assert.equal(h.navigations.length, 0); assert.ok(button(tree, 'Create category'))
  topic(tree).props.onChange({ target: { value: 'Comedy' } }); tree = h.render(); assert.equal(button(tree, 'Create category'), undefined)
  h.submit(tree); await tick(); tree = h.render(); const create = button(tree, 'Create category').props.onClick
  create(); create(); await tick()
  assert.equal(h.requests.filter(request => request.path === '/intelligence/ideas/create').length, 1)
  assert.equal(h.requests.at(-1).body.confirmed, true); assert.equal(h.requests.at(-1).body.auditId, 'audit-1')
  assert.deepEqual(h.navigations, ['/ideas/new-category'])
  assert.equal(h.requests.some(request => request.path === '/intelligence/research'), false)
})

test('stale duplicate check cannot redirect an edited request', async () => {
  const pending = deferred(); const h = await harness({ respond: async () => pending.promise })
  let tree = h.tree; button(tree, 'AI').props.onClick(); tree = h.render(); h.submit(tree)
  topic(tree).props.onChange({ target: { value: 'Comedy' } }); pending.resolve({ action: 'reuse', matchedId: 'ai-category' }); await tick()
  assert.equal(h.navigations.length, 0); assert.equal(topic(h.render()).props.value, 'Comedy')
})

test('unmount during a duplicate check cannot redirect the next account or workspace', async () => {
  const pending = deferred(); const h = await harness({ respond: async () => pending.promise })
  let tree = h.tree; button(tree, 'AI').props.onClick(); tree = h.render(); h.submit(tree)
  h.unmount(); pending.resolve({ action: 'reuse', matchedId: 'previous-workspace-category' }); await tick()
  assert.equal(h.navigations.length, 0)
})

test('explicit create and research action dispatches once after category creation', async () => {
  const h = await harness({ enabled: true, respond: async path => {
    if (path === '/intelligence/ideas/check') return { id: 'audit-2', action: 'new', name: 'Mycology', brief: 'Explore fungi identification with reliable sources.' }
    if (path === '/intelligence/ideas/create') return { id: 'mycology', revision: 2 }
    assert.equal(path, '/intelligence/research'); return { jobId: 'job-1' }
  } })
  let tree = h.tree; topic(tree).props.onChange({ target: { value: 'Mycology' } }); tree = h.render(); h.submit(tree); await tick(); tree = h.render()
  assert.equal(h.requests.length, 1)
  button(tree, 'Create & find ideas').props.onClick(); await tick()
  assert.deepEqual(h.requests.map(request => request.path), ['/intelligence/ideas/check', '/intelligence/ideas/create', '/intelligence/research'])
  assert.equal(h.requests[2].body.confirmed, true); assert.equal(h.requests[2].body.nicheRevision, 2)
  assert.deepEqual(h.navigations, ['/ideas/mycology'])
})

test('editing while research admission is pending prevents stale navigation', async () => {
  const pending = deferred()
  const h = await harness({ enabled: true, respond: async path => {
    if (path === '/intelligence/ideas/check') return { id: 'audit-3', action: 'new', name: 'Mycology', brief: 'Explore fungi identification with reliable sources.' }
    if (path === '/intelligence/ideas/create') return { id: 'mycology', revision: 1 }
    assert.equal(path, '/intelligence/research'); return pending.promise
  } })
  let tree = h.tree; topic(tree).props.onChange({ target: { value: 'Mycology' } }); tree = h.render(); h.submit(tree); await tick(); tree = h.render()
  button(tree, 'Create & find ideas').props.onClick(); await tick(); tree = h.render()
  topic(tree).props.onChange({ target: { value: 'Comedy' } }); pending.resolve({ jobId: 'job-2' }); await tick()
  assert.equal(h.navigations.length, 0)
})

test('expired creation audit clears the decision and checks again with a fresh request ID', async () => {
  let checks = 0
  const h = await harness({ respond: async path => {
    if (path === '/intelligence/ideas/check') {
      checks++
      return checks === 1 ? { id: 'expired-audit', action: 'new', name: 'Mycology', brief: 'Fungi research.' } : { action: 'reuse', matchedId: 'teammate-category' }
    }
    assert.equal(path, '/intelligence/ideas/create')
    throw Object.assign(new Error('Library changed. Check again.'), { status: 409 })
  } })
  let tree = h.tree; topic(tree).props.onChange({ target: { value: 'Mycology' } }); tree = h.render(); h.submit(tree); await tick(); tree = h.render()
  button(tree, 'Create category').props.onClick(); await tick(); tree = h.render()
  assert.equal(button(tree, 'Create category'), undefined); assert.ok(button(tree, 'Find ideas'))
  assert.equal(h.navigations.length, 0)
  h.submit(tree); await tick()
  const checkRequests = h.requests.filter(request => request.path === '/intelligence/ideas/check')
  assert.equal(checkRequests.length, 2); assert.notEqual(checkRequests[0].body.requestId, checkRequests[1].body.requestId)
  assert.deepEqual(h.navigations, ['/ideas/teammate-category?reused=1'])
})

test('failed response for an edited topic cannot display an obsolete error', async () => {
  const pending = deferred(); const h = await harness({ respond: async () => pending.promise })
  let tree = h.tree; button(tree, 'AI').props.onClick(); tree = h.render(); h.submit(tree)
  topic(tree).props.onChange({ target: { value: 'Comedy' } }); pending.reject(new Error('Old request failed')); await tick(); tree = h.render()
  assert.equal(flatten(tree).some(node => node.props?.role === 'alert'), false)
  assert.equal(topic(tree).props.value, 'Comedy'); assert.equal(button(tree, 'Find ideas').props.disabled, false)
})

 test('uncertain comparisons offer existing categories without starting research', async () => {
  const h = await harness({ respond: async () => ({ action: 'clarify', reason: 'Comparison unavailable', suggestions: [{ id: 'news-saved', name: 'News', brief: 'Saved scope' }] }) })
  button(h.tree, 'News').props.onClick(); h.submit(h.render()); await tick()
  const tree = h.render()
  assert.ok(flatten(tree).some(node => node.type === 'a' && node.props.to === '/ideas/news-saved'))
  assert.equal(h.requests.length, 1); assert.equal(h.navigations.length, 0)
})
