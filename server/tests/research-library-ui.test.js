import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('actual research UI opens ten saved cards without POST and refresh requires confirmation', async () => {
  const source = await readFile(new URL('../../src/pages/app/IntelligencePage.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const niche = { id: 'n1', revision: 1, name: 'AI', brief: 'Explain recent AI announcements for readers.', audience: '', region: 'Global', language: 'Auto', voice: 'Auto', tone: 'Auto', duration: 45, windowDays: 7, mode: 'latest', sourceLocale: 'en-US', referenceUrls: [], autoRefresh: false }
  const report = { id: 'r1', nicheId: 'n1', niche, researchedAt: '2026-10-25T10:00:00Z', summary: 'Ten sourced ideas', opportunities: Array.from({ length: 10 }, (_, i) => ({ title: `Idea ${i + 1}`, whatChanged: 'A reported development.', verification: 'reported', evidenceIds: [], positive: [], negative: [], audienceReaction: { status: 'insufficient-evidence', summary: 'Unknown', limitations: 'No sample', evidenceIds: [] } })), unknowns: [], evidence: [], searchQueries: [] }
  const collection = { niche, reportId: report.id, researchedAt: report.researchedAt, topicCount: 10, summary: report.summary }
  const slots = []; let cursor = 0; const effects = []; const requests = []; const navigations = []; let pathname = '/ideas/n1'
  const element = (type, props, key) => ({ type, props, key })
  const react = {
    useRef: value => ({ current: value }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i][index])) { effects.push(effect); slots[i] = deps } },
  }
  const modules = {
    './CategorySetupFields': { CategorySetupFields: 'CategorySetupFields' },
    '@/services/category-setup': { categoryDefaults: { topics: [], refreshIntervalDays: 7 } },
    react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-router-dom': { Link: 'a', useNavigate: () => path => navigations.push(path), useLocation: () => ({ pathname }), useParams: () => ({ categoryId: 'n1' }) },
    'lucide-react': { ArrowRight: 'svg', Radar: 'svg', Sparkles: 'svg' },
    '@/services/topic-research-details': {}, './IdeaLibrary': { IdeaLibrary: 'library', CategoryCover: 'cover' },
    '@/context/auth-state': { useAuth: () => ({ identity: { uid: 'bob' }, loading: false, configured: true }) },
    '@/services/workspace-session': { activeWorkspace: () => 'shared' },
    '@/services/analytics': { trackEvent() {} },
    '@/styles/studio.css': {}, '@/styles/discovery.css': {},
    '@/services/studio-api': { studioRequest: async (path, body, method) => {
      requests.push({ path, body, method })
      if (path === '/packages') return { packages: [] }
      if (path === '/intelligence/niches') return { ...body.niche, id: niche.id, revision: niche.revision }
      if (path === '/config') return { capabilities: { research: true } }
      if (path === '/intelligence') return { niches: [niche], reports: [], collections: [collection], workspace: { personal: false, role: 'editor' }, states: [], schedules: [], nextCursor: null }
      if (path === '/intelligence/research') return { jobId: 'queued-refresh', jobStatus: 'reserved', nicheId: niche.id }
      if (path === '/intelligence/reports/r1') return report
      throw new Error(`Unexpected request ${path}`)
    } },
  }
  const exports = {}
  modules['@/services/studio-api'].studioRead = (path, authenticated = true) => modules['@/services/studio-api'].studioRequest(path, undefined, 'GET', authenticated)
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, sessionStorage: { getItem: () => null, removeItem() {} }, crypto: { randomUUID: () => 'request-1' }, document: { getElementById: () => ({ focus() {}, scrollIntoView() {} }) }, window: {}, URLSearchParams })
  const originalKey = exports.IntelligencePage().key; pathname = '/ideas/missing'; assert.notEqual(exports.IntelligencePage().key, originalKey); pathname = '/ideas/n1'
  const component = exports.IntelligencePage().type
  const render = () => { cursor = 0; return component() }
  const flush = async () => { for (const effect of effects.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)) }
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
  const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && text(node) === label)
  let tree = render(); await flush(); tree = render(); await flush(); tree = render()
  assert.equal(flatten(tree).filter(node => node.type === 'button' && text(node) === 'View details').length, 10)
  assert.equal(requests.filter(value => value.method === 'POST').length, 0)
  assert.equal(flatten(tree).some(node => node.type === 'details'), false, 'the idea grid has no accordion wall before the cards')
  button(tree, 'Research & sources').props.onClick(); tree = render()
  assert.equal(flatten(tree).filter(node => node.type === 'button' && text(node) === 'View details').length, 0)
  assert.match(text(tree), /Ten sourced ideas/)
  assert.match(text(tree), /Research overview/)
  assert.equal(requests.filter(value => value.method === 'POST').length, 0)
  button(tree, 'Ideas (10)').props.onClick(); tree = render()
  const topicCard = flatten(tree).find(node => node.type === 'button' && text(node) === 'View details')
  topicCard.props.onClick(); tree = render()
  assert.equal(flatten(tree).filter(node => node.type === 'button' && text(node) === 'View details').length, 10)
  assert.ok(flatten(tree).some(node => node.type === 'h1' && text(node) === 'Idea 1'), 'selected idea replaces the duplicate category heading')
  assert.ok(flatten(tree).some(node => node.props?.className === 'idea-create-card'))
  assert.match(text(tree), /The idea at a glance/)
  assert.doesNotMatch(text(tree), /A different perspective/)
  button(tree, 'Evidence & checks').props.onClick(); tree = render()
  assert.match(text(tree), /A different perspective/)
  assert.match(text(tree), /No sample/)
  assert.equal(requests.filter(value => value.method === 'POST').length, 0, 'changing detail views cannot start generation')
  button(tree, 'Content idea').props.onClick(); tree = render()
  assert.doesNotMatch(text(tree), /A different perspective/)
  assert.ok(button(tree, 'Close details')); flatten(tree).find(node => node.type === 'dialog').props.onClose(); tree = render()
  collection.refreshAvailableAt = new Date(Date.now() + 86400000).toISOString(); tree = render()
  assert.equal(button(tree, 'Refresh now').props.disabled, false, 'manual refresh remains available before automatic refresh is due')
  collection.refreshAvailableAt = null; tree = render()
  button(tree, 'Refresh now').props.onClick(); tree = render()
  assert.ok(button(tree, 'Confirm refresh')); assert.equal(requests.filter(value => value.method === 'POST').length, 0)
  button(tree, 'Confirm refresh').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  const posts = requests.filter(value => value.method === 'POST')
  assert.equal(posts.length, 1); assert.equal(posts[0].path, '/intelligence/research'); assert.equal(posts[0].body.refresh, true); assert.equal(posts[0].body.confirmed, true); assert.equal(navigations.at(-1), '/ideas/n1')
  tree = render(); assert.equal(button(tree, 'Researching…').props.disabled, true)
  slots.length = 0; effects.length = 0; collection.reportId = ''; requests.length = 0
  tree = render(); await flush(); tree = render(); await flush(); tree = render()
  button(tree, 'Research & sources').props.onClick(); tree = render()
  assert.match(text(tree), /No saved research yet/)
  assert.equal(requests.filter(value => value.method === 'POST').length, 0)
})

test('library renders category links with local illustrations and an independent add-category action', async () => {
  const source = await readFile(new URL('../../src/pages/app/IdeaLibrary.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}; const element = (type, props) => ({ type, props })
  const modules = { react: { useEffect() {}, useState: () => [{}, () => {}] }, '@/services/studio-api': {}, 'react/jsx-runtime': { jsx: element, jsxs: element }, 'react-router-dom': { Link: 'a' }, 'lucide-react': { ArrowRight: 'svg', Plus: 'svg', Search: 'svg' } }
  runInNewContext(code, { exports, require: name => modules[name] })
  const categories = [{ id: 'n1', name: 'AI', brief: 'AI research' }, { id: 'n2', name: 'Fitness', brief: 'Wellness research' }]
  const tree = exports.IdeaLibrary({ categories, collections: [], search: '', setSearch() {}, personal: false, loading: false, jobs: {} })
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  assert.equal(flatten(tree).filter(node => node.type === 'a' && node.props.to.startsWith('/ideas/')).length, 2)
  assert.equal(exports.CategoryCover({ name: 'AI' }).props.src, '/category-covers/technology.svg')
  assert.equal(exports.CategoryCover({ name: 'Fitness' }).props.src, '/category-covers/wellness.svg')
  assert.equal(exports.CategoryCover({ name: 'Unknown niche' }).props.src, '/category-covers/discovery.svg')
  for (const [name, cover] of [['Astrology', 'astrology'], ['Weekly horoscopes', 'astrology'], ['Vastu', 'vastu'], ['Comedy', 'comedy'], ['News', 'news'], ['Artificial intelligence', 'technology']]) {
    const image = exports.CategoryCover({ name }).props
    assert.equal(image.src, `/category-covers/${cover}.svg`)
    assert.ok((await readFile(new URL(`../../public${image.src}`, import.meta.url), 'utf8')).startsWith('<svg'))
    assert.equal(image.width, '480')
    assert.equal(image.height, '270')
  }
  assert.ok(flatten(tree).some(node => node.type === 'a' && node.props.to === '/find-ideas'))
  const props = { categories: [...categories, { id: 'n3', name: 'Astrology', brief: 'Explain astrology' }], collections: [], search: 'AI', setSearch() {}, personal: true, loading: false, jobs: {} }
  const filtered = exports.IdeaLibrary(props)
  assert.equal(flatten(filtered).filter(node => node.type === 'a' && node.props.to.startsWith('/ideas/')).length, 1, 'category search should not match AI inside Explain')
  const empty = exports.IdeaLibrary({ ...props, categories: [], search: '' })
  assert.ok(flatten(empty).some(node => node.type === 'h2' && node.props.children === 'Start your Topic Library'))
  assert.ok(flatten(empty).some(node => node.type === 'a' && node.props.to === '/find-ideas'))
  const loading = exports.IdeaLibrary({ ...props, categories: [], loading: true })
  assert.equal(flatten(loading).some(node => node.type === 'h2'), false, 'loading must not flash the empty-library welcome')
  assert.ok(flatten(loading).some(node => node.props['aria-busy'] === true))
  assert.equal(flatten(loading).filter(node => node.props.className === 'category-tile category-skeleton').length, 6)
  assert.ok(flatten(loading).some(node => node.props['aria-hidden'] === 'true' && node.props.className === 'category-grid'))
  assert.equal(flatten(loading).some(node => node.type === 'a' && node.props.to.startsWith('/ideas/')), false, 'skeleton cards must not be fake category links')
})
