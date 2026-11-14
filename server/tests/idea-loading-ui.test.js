import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function harness(categoryId, failures, research = {}) {
  const source = await readFile(new URL('../../src/pages/app/IntelligencePage.tsx', import.meta.url), 'utf8')
  const slots = []; const dependencies = []; const cleanup = []; let cursor = 0; let pending = []
  const element = (type, props) => ({ type, props })
  const niche = { id: 'astrology', name: 'Astrology', referenceUrls: [] }
  const report = { id: 'report', nicheId: niche.id, niche, opportunities: [{ title: 'Saved astrology idea', keywords: [] }], evidence: [], unknowns: [], searchQueries: [], researchedAt: new Date().toISOString() }
  const calls = []
  const timers = new Map(); let timerId = 0
  const modules = {
    './CategorySetupFields': { CategorySetupFields: 'CategorySetupFields' },
    '@/services/category-setup': { categoryDefaults: { topics: [], refreshIntervalDays: 7 } },
    react: {
      useRef: value => ({ current: value }),
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
      useEffect(fn, deps) { const i = cursor++; if (!dependencies[i] || deps.some((value, j) => value !== dependencies[i][j])) { dependencies[i] = deps; pending.push(() => { cleanup[i]?.(); cleanup[i] = fn() }) } },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-router-dom': { Link: 'a', useNavigate: () => () => {}, useLocation: () => ({ pathname: categoryId ? `/ideas/${categoryId}` : '/ideas', search: '' }), useParams: () => ({ categoryId }) },
    '@/context/auth-state': { useAuth: () => ({ identity: { uid: 'alice' }, loading: false, configured: true }) },
    '@/services/workspace-session': { activeWorkspace: () => 'personal' },
    '@/services/studio-api': { studioRead: async path => {
      calls.push(path)
      if (failures.has(path)) throw new Error('Temporary read failure')
      if (path === '/packages') return { packages: [] }
      if (path === '/config') return { capabilities: { research: true } }
      if (path === '/intelligence') return { niches: [niche], collections: research.status && research.status !== 'completed' ? [] : [{ niche, reportId: report.id, topicCount: 1 }], reports: [], states: research.status ? [{ id: niche.id, jobId: 'research-job', status: research.status }] : [], workspace: { personal: true, role: 'owner' } }
      return report
    }, studioRequest: () => { throw new Error('No mutations allowed') } },
    '@/services/topic-research-details': {}, '@/services/analytics': {}, 'lucide-react': {},
    './IdeaLibrary': { IdeaLibrary: 'IdeaLibrary', CategoryCover: 'CategoryCover' }, '@/styles/studio.css': {}, '@/styles/discovery.css': {},
  }
  const exports = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => { assert.ok(name in modules, name); return modules[name] }, URLSearchParams,
    sessionStorage: { getItem: () => null }, document: { getElementById: () => null }, window: { setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id) },
  })
  const component = exports.IntelligencePage().type
  const render = () => { cursor = 0; return component() }
  const settle = async () => { let tree; for (let i = 0; i < 4; i++) { tree = render(); const effects = pending; pending = []; effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)) } return tree }
  return { settle, calls, timers, tick: () => { const due = [...timers.values()]; timers.clear(); due.forEach(fn => fn()) }, unmount: () => cleanup.forEach(fn => fn?.()) }
}
const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = tree => JSON.stringify(tree)
test('library refreshes pending research into saved ideas without another AI request and stops after completion or unmount', async () => {
  const research = { status: 'running' }
  const app = await harness(undefined, new Set(), research)
  let tree = await app.settle()
  assert.equal(flatten(tree).find(node => node.type === 'IdeaLibrary').props.collections.length, 0)
  assert.equal(app.timers.size, 1)
  research.status = 'completed'; app.tick(); tree = await app.settle()
  assert.equal(flatten(tree).find(node => node.type === 'IdeaLibrary').props.collections[0].topicCount, 1)
  assert.equal(app.timers.size, 0)
  assert.ok(app.calls.every(path => ['/packages', '/config', '/intelligence'].includes(path)))
  const pending = await harness(undefined, new Set(), { status: 'running' })
  await pending.settle(); assert.equal(pending.timers.size, 1)
  pending.unmount(); assert.equal(pending.timers.size, 0)
})
for (const category of [undefined, 'astrology']) {
  test(`${category || 'library'} recovers from failed list loading without remount or reload`, async () => {
    const failures = new Set(['/intelligence']); const app = await harness(category, failures)
    let tree = await app.settle()
    assert.match(text(tree), /Could not load/)
    assert.doesNotMatch(text(tree), /Opening your category/)
    failures.clear()
    flatten(tree).find(node => node.type === 'button' && node.props.children === 'Try again').props.onClick()
    tree = await app.settle()
    assert.doesNotMatch(text(tree), /Temporary read failure/)
    assert.match(text(tree), category ? /Saved astrology idea/ : /IdeaLibrary/)
  })
}
test('config failure does not hide saved topics and report failure has an in-page retry', async () => {
  const failures = new Set(['/config', '/intelligence/reports/report']); const app = await harness('astrology', failures)
  let tree = await app.settle()
  assert.match(text(tree), /Try again/); assert.doesNotMatch(text(tree), /Loading briefing/)
  failures.delete('/intelligence/reports/report')
  flatten(tree).find(node => node.type === 'button' && node.props.children === 'Try again').props.onClick()
  tree = await app.settle(); assert.match(text(tree), /Saved astrology idea/)
  failures.clear()
  flatten(tree).find(node => node.type === 'button' && node.props.children === 'Try again').props.onClick()
  tree = await app.settle(); assert.doesNotMatch(text(tree), /Service availability could not be checked/)
})
