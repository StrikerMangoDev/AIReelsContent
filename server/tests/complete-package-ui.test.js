import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function load(file, modules = {}, globals = {}) {
  const source = await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8')
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, ...globals })
  return exports
}
const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'object' ? [value, ...flatten(value.props?.children)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : ''
const fixture = () => ({
  version: 'complete-package-v1', packageId: 'one', revision: 3, contextRevision: 2, contentHash: 'saved-hash', inputHash: 'input-hash', context: { brand: 'Saved brand', objective: 'Educate', platformAccounts: [{ platform: 'Instagram', accountId: 'ig-account' }] },
  platforms: ['Instagram', 'YouTube', 'X', 'Facebook', 'LinkedIn'].map(platform => ({ platform, selected: true, status: 'ready', reason: '', content: { headline: `${platform} exact copy` } })),
  accounts: [{ accountId: 'ig-account', platform: 'Instagram', name: 'Instagram destination' }, { accountId: 'yt-account', platform: 'YouTube', name: 'YouTube destination' }],
  sections: ['identity', 'setup', 'sources', 'market', 'decisions', 'plan', 'brief', 'platforms', 'website', 'prompts', 'production', 'quality', 'posting', 'performance', 'downloads', 'portal'].map(id => ({ id, title: id, status: 'partial', reason: '', value: { description: `${id} information` } })),
  decisions: [], prompts: ['Instagram', 'YouTube'].map(platform => ({ id: `${platform}:image`, platform, kind: 'image', title: `${platform} graphic`, tool: 'Approved graphic tool', prompt: `${platform} exact creative instructions`, exactText: `${platform} exact public text`, attachments: [], settings: { aspectRatio: '4:5' }, constraints: [], acceptance: [], sourceDecisionIds: ['decision-one'], sources: [{ id: 'E1', title: 'Original source', url: 'https://example.com/source' }], missing: [], status: 'ready', reason: '' })),
  analytics: { observations: [], comparisons: [] }, rules: [], tasks: [], assets: [], publications: [], analysis: { status: 'completed', stale: false },
})
async function harness(initial = fixture()) {
  const slots = []; const refs = []; const effectDeps = []; const effects = []; const effectCleanups = []
  let cursor = 0; let refCursor = 0; let effectCursor = 0; let reads = 0; let saves = 0; let analyses = 0; let copied = ''; let savedContext
  let current = initial
  const listeners = new Map()
  const events = { addEventListener(name, listener) { listeners.set(name, listener) }, removeEventListener(name) { listeners.delete(name) } }
  const react = {
    useState(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = initialValue; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initialValue) { const index = refCursor++; refs[index] ||= { current: initialValue }; return refs[index] },
    useEffect(effect, deps) { const index = effectCursor++; if (!effectDeps[index] || deps.some((entry, position) => !Object.is(entry, effectDeps[index][position]))) { effectDeps[index] = deps; effects.push(() => { effectCleanups[index]?.(); effectCleanups[index] = effect() }) } },
  }
  const element = (type, props) => ({ type, props })
  const api = {
    packagePlatforms: ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn'],
    readCompletePackage: async () => { reads++; return current },
    savePackageContext: async (_id, revision, context) => { saves++; savedContext = { revision, context }; current = { ...current, contextRevision: revision + 1, context }; return current },
    analyzeCompletePackage: async () => { analyses++; return current },
    recoverCompleteAnalysis: async () => { throw new Error('The provider has not confirmed the previous attempt.') },
    readPackageDownload: async () => ({ completePackage: current }),
    externalPromptMarkdown: () => 'Saved prompt document',
    readPackageMetricsConfig: async () => ({ configured: false, reason: 'Not connected', eligiblePublications: [] }),
    syncPackageMetrics: async () => { throw new Error('Unexpected provider sync') },
  }
  const { StudioCompletePackage } = await load('pages/app/StudioCompletePackage.tsx', {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    'lucide-react': { ClipboardList: 'svg', Copy: 'svg', Download: 'svg', RefreshCw: 'svg' },
    '@/services/complete-package': api, '@/styles/complete-package.css': {}, './StudioStrategyWorkflow': { StudioStrategyWorkflow: 'StudioStrategyWorkflow' }, './StudioSeoWorkflow': { StudioSeoWorkflow: 'StudioSeoWorkflow' },
  }, { Error, crypto: { randomUUID: () => 'controlled-request-id' }, navigator: { clipboard: { writeText: async value => { copied = value } } }, window: { ...events, setInterval: () => 1, clearInterval() {} }, document: events, FormData: class { constructor(form) { this.values = form.values } get(key) { return this.values[key] ?? null } } })
  const render = (props = {}) => { cursor = 0; refCursor = 0; effectCursor = 0; return StudioCompletePackage({ packageId: 'one', revision: 3, ...props }) }
  const flush = async () => { while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)) }
  const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && text(node) === label)
  render(); await flush()
  return { render, flush, button, api, slots, react, listeners, get reads() { return reads }, get saves() { return saves }, get analyses() { return analyses }, get copied() { return copied }, get savedContext() { return savedContext } }
}

test('opening the complete package only reads saved data and exposes all five platform views and sixteen sections', async () => {
  const h = await harness(); const tree = h.render()
  assert.equal(h.reads, 1); assert.equal(h.analyses, 0); assert.equal(h.saves, 0)
  for (const platform of ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']) assert.ok(h.button(tree, platform))
  const coverage = flatten(tree).find(node => node.type === 'details' && node.props.className === 'complete-package-coverage')
  assert.equal(flatten(coverage).filter(node => node.type === 'li').length, 16)
  h.button(tree, 'Platform content').props.onClick(); let next = h.render()
  assert.ok(flatten(next).some(node => typeof node.type === 'function' && node.type.name === 'DataView' && node.props.value?.headline === 'Instagram exact copy'))
  h.button(next, 'YouTube').props.onClick(); next = h.render()
  assert.ok(flatten(next).some(node => typeof node.type === 'function' && node.type.name === 'DataView' && node.props.value?.headline === 'YouTube exact copy'))
})

test('unsaved context can be discarded and a save uses optimistic revision without inventing paid consent', async () => {
  const h = await harness(); let tree = h.render()
  const objective = flatten(tree).find(node => node.type === 'textarea' && node.props.maxLength === 1000)
  objective.props.onChange({ target: { value: 'Updated objective' } }); tree = h.render()
  assert.ok(h.button(tree, 'Save all context changes'))
  h.button(tree, 'Discard unsaved context').props.onClick(); tree = h.render()
  assert.equal(flatten(tree).find(node => node.type === 'textarea' && node.props.maxLength === 1000).props.value, 'Educate')
  objective.props.onChange({ target: { value: 'Updated objective' } }); tree = h.render()
  await h.button(tree, 'Save all context changes').props.onClick(); await h.flush()
  assert.equal(h.saves, 1); assert.equal(h.savedContext.revision, 2)
  assert.equal(h.savedContext.context.objective, 'Updated objective'); assert.equal(h.savedContext.context.autoAnalyze, true)
  assert.equal(h.savedContext.context.paidConsent, undefined)
})

test('strategy editing uses the existing account-scoped context save and unsaved exit guard without provider calls', async () => {
  const h = await harness(); let tree = h.render()
  h.button(tree, 'Strategy workflow').props.onClick(); tree = h.render()
  const workflow = flatten(tree).find(node => node.type === 'StudioStrategyWorkflow')
  assert.equal(workflow.props.platform, 'Instagram'); assert.equal(workflow.props.accountId, 'ig-account')
  workflow.props.onChange({ ...workflow.props.context, workflow: { version: 'strategy-workflow-v1', destinations: [{ platform: 'Instagram', accountId: 'ig-account', goal: { primary: 'reach', kpi: 'reach', targetAction: 'Read the explainer', reviewAfterHours: 48 } }] } })
  tree = h.render(); await h.flush()
  assert.ok(h.listeners.has('beforeunload'))
  h.button(tree, 'Save all context changes').props.onClick(); await h.flush()
  assert.equal(h.savedContext.context.workflow.destinations[0].accountId, 'ig-account')
  assert.equal(h.analyses, 0, 'opening or drafting strategy never directly calls the AI provider')
})

test('embedded workspace tools retain unsaved context across task changes without a second navigation or provider calls', async () => {
  const h = await harness()
  let tree = h.render({ requestedView: 'workflow' })
  assert.equal(flatten(tree).some(node => node.type === 'nav' && node.props['aria-label'] === 'Complete package sections'), false)
  for (const platform of ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']) assert.ok(h.button(tree, platform), 'Embedded strategy must keep every platform reachable')
  h.button(tree, 'YouTube').props.onClick(); tree = h.render({ requestedView: 'workflow' })
  const workflow = flatten(tree).find(node => node.type === 'StudioStrategyWorkflow')
  assert.equal(workflow.props.platform, 'YouTube')
  workflow.props.onChange({ ...workflow.props.context, objective: 'Keep this unsaved objective' })
  tree = h.render({ requestedView: 'seo' }); await h.flush()
  assert.equal(flatten(tree).find(node => node.type === 'StudioSeoWorkflow').props.context.objective, 'Keep this unsaved objective')
  assert.ok(h.button(tree, 'Save all context changes'))
  assert.ok(h.listeners.has('beforeunload'))
  tree = h.render({ requestedView: 'workflow' })
  assert.equal(flatten(tree).find(node => node.type === 'StudioStrategyWorkflow').props.context.objective, 'Keep this unsaved objective')
  assert.equal(h.reads, 1); assert.equal(h.saves, 0); assert.equal(h.analyses, 0)
})

test('all five destination changes require explicit removal of the old strategy and preserve other platform strategies', async () => {
  const platforms = ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']
  for (const platform of platforms) {
    const data = fixture()
    data.context.platformAccounts = platforms.map(value => ({ platform: value, accountId: `${value}-old` }))
    data.context.workflow = { version: 'strategy-workflow-v1', destinations: platforms.map(value => ({ platform: value, accountId: `${value}-old`, goal: { primary: 'reach', kpi: 'reach', targetAction: 'Read', reviewAfterHours: 48 } })) }
    data.accounts = platforms.flatMap(value => ['old', 'new'].map(suffix => ({ platform: value, accountId: `${value}-${suffix}`, name: `${value} ${suffix}` })))
    const h = await harness(data)
    const chooser = tree => flatten(flatten(tree).find(node => node.type === 'label' && text(node).startsWith(`${platform} destination`))).find(node => node.type === 'select')
    let tree = h.render()
    chooser(tree).props.onChange({ target: { value: `${platform}-new` } }); tree = h.render()
    assert.ok(text(tree).includes(`Remove the current ${platform} account strategy`))
    assert.equal(chooser(tree).props.value, `${platform}-old`)
    h.button(tree, platform).props.onClick(); h.button(tree, 'Strategy workflow').props.onClick(); tree = h.render()
    const workflow = flatten(tree).find(node => node.type === 'StudioStrategyWorkflow')
    workflow.props.onChange({ ...workflow.props.context, workflow: { ...workflow.props.context.workflow, destinations: workflow.props.context.workflow.destinations.filter(entry => entry.platform !== platform) } })
    tree = h.render(); h.button(tree, 'Brief & research').props.onClick(); tree = h.render()
    chooser(tree).props.onChange({ target: { value: `${platform}-new` } }); tree = h.render()
    h.button(tree, 'Save all context changes').props.onClick(); await h.flush()
    assert.equal(h.savedContext.context.platformAccounts.find(entry => entry.platform === platform).accountId, `${platform}-new`)
    assert.equal(h.savedContext.context.workflow.destinations.length, 4)
    assert.equal(h.savedContext.context.workflow.destinations.some(entry => entry.platform === platform), false)
  }
})

test('external prompts stay platform-specific and cannot be copied when context, analysis or the card is not ready', async () => {
  for (const stale of [false, true]) {
    const data = fixture(); data.analysis.stale = stale
    const h = await harness(data); let tree = h.render(); h.button(tree, 'External prompts').props.onClick(); tree = h.render()
    const promptNode = flatten(tree).find(node => typeof node.type === 'function' && node.type.name === 'PromptCard')
    assert.equal(promptNode.props.card.platform, 'Instagram')
    let promptTree = promptNode.type(promptNode.props)
    assert.equal(h.button(promptTree, 'Copy prompt').props.disabled, stale)
    await h.button(promptTree, 'Copy prompt').props.onClick(); await h.flush()
    assert.equal(h.copied, stale ? '' : 'Instagram exact creative instructions')
    promptTree = promptNode.type({ ...promptNode.props, card: { ...promptNode.props.card, status: 'partial' } })
    assert.equal(h.button(promptTree, 'Copy prompt').props.disabled, true)
    assert.equal(h.button(tree, 'Download ready Instagram prompts').props.disabled, stale)
  }
})

test('an uncertain AI outcome disables a new analysis request', async () => {
  const data = fixture(); data.analysis.status = 'dispatch_unknown'
  const h = await harness(data); let tree = h.render(); h.button(tree, 'AI decisions').props.onClick(); tree = h.render()
  const analyze = h.button(tree, 'Analyze saved package with AI')
  assert.equal(analyze.props.disabled, true)
  await analyze.props.onClick(); await h.flush(); assert.equal(h.analyses, 0)
})

test('analysis recovery checks first and requires an explicit retained-cost acknowledgment before preparing a separate free attempt', async () => {
  const data = fixture(); data.analysis = { status: 'dispatch_unknown', stale: false, requestId: 'de614d52-381a-4fef-b0d2-4257a0bb8c33' }
  const h = await harness(data); const recoveries = []
  h.api.recoverCompleteAnalysis = async (...args) => { recoveries.push(args); if (!args[4]) throw new Error('The provider has not confirmed the previous attempt.'); return { ...data, analysis: { ...data.analysis, status: 'failed', error: null } } }
  let tree = h.render({ requestedView: 'decisions' })
  assert.equal(h.button(tree, 'Prepare a new free-only attempt').props.disabled, true)
  await h.button(tree, 'Check previous analysis').props.onClick(); await h.flush()
  tree = h.render({ requestedView: 'decisions' })
  assert.equal(recoveries[0][4], false); assert.equal(h.analyses, 0)
  assert.equal(h.button(tree, 'Analyze saved package with AI').props.disabled, true)
  const acknowledgment = flatten(tree).find(node => node.type === 'input' && node.props.type === 'checkbox')
  acknowledgment.props.onChange({ target: { checked: true } }); tree = h.render({ requestedView: 'decisions' })
  assert.equal(h.button(tree, 'Prepare a new free-only attempt').props.disabled, false)
  await h.button(tree, 'Prepare a new free-only attempt').props.onClick(); await h.flush()
  tree = h.render({ requestedView: 'decisions' })
  assert.deepEqual(recoveries[1], ['one', data.analysis.requestId, data.contentHash, data.contextRevision, true])
  assert.equal(h.button(tree, 'Analyze saved package with AI').props.disabled, false)
  assert.equal(h.analyses, 0, 'Recovery never starts a replacement model call')
})

test('unsaved package context reports its exit guard and warns before browser unload', async () => {
  const h = await harness(); let reported
  const onDirtyChange = value => { reported = value }
  let tree = h.render({ onDirtyChange }); await h.flush()
  assert.equal(reported, false)
  flatten(tree).find(node => node.type === 'textarea' && node.props.maxLength === 1000).props.onChange({ target: { value: 'Unsaved new objective' } })
  tree = h.render({ onDirtyChange }); await h.flush()
  assert.equal(reported, true)
  assert.ok(h.listeners.has('click'), 'navigation links are guarded while the draft is unsaved')
  let prevented = false
  const event = { preventDefault() { prevented = true }, returnValue: undefined }
  h.listeners.get('beforeunload')(event)
  assert.equal(prevented, true); assert.equal(event.returnValue, '')
  h.button(tree, 'Discard unsaved context').props.onClick(); h.render({ onDirtyChange }); await h.flush()
  assert.equal(reported, false)
  assert.equal(h.listeners.has('beforeunload'), false)
  assert.equal(h.listeners.has('click'), false)
})

test('prompt copy and Markdown export require current owner source checks and unchanged analysis dependencies', async () => {
  for (const changed of ['source_rejected', 'input_hash', 'stale', 'card_partial', 'card_text']) {
    const h = await harness(); let checks = 0
    h.api.readPackageDownload = async () => {
      checks++
      if (changed === 'source_rejected') throw new Error('Source validation failed; export is blocked')
      const saved = fixture()
      if (changed === 'input_hash') saved.inputHash = 'new-dependency-hash'
      if (changed === 'stale') saved.analysis.stale = true
      if (changed === 'card_partial') saved.prompts[0].status = 'partial'
      if (changed === 'card_text') saved.prompts[0].prompt = 'Changed instructions'
      return { completePackage: saved }
    }
    let tree = h.render(); h.button(tree, 'External prompts').props.onClick(); tree = h.render()
    const node = flatten(tree).find(item => typeof item.type === 'function' && item.type.name === 'PromptCard')
    h.button(node.type(node.props), 'Copy prompt').props.onClick(); await h.flush()
    assert.equal(checks, 1, changed); assert.equal(h.copied, '', changed)
    assert.ok(flatten(h.render()).some(item => item.props?.role === 'alert'), changed)
    tree = h.render(); h.button(tree, 'Download ready Instagram prompts').props.onClick(); await h.flush()
    assert.equal(checks, 2, `${changed}: Markdown export uses the same server check`)
    assert.equal(h.copied, '')
  }
})

test('metric entry preserves explicit zero and omits missing and blank metrics', async () => {
  const h = await harness(); let tree = h.render(); h.button(tree, 'Results').props.onClick(); tree = h.render()
  const metricNode = flatten(tree).find(node => typeof node.type === 'function' && node.type.name === 'MetricForm')
  const metricTree = metricNode.type(metricNode.props)
  let added
  const editable = metricNode.type({ ...metricNode.props, onAdd: value => { added = value } })
  const form = flatten(editable).find(node => node.type === 'form')
  form.props.onSubmit({ preventDefault() {}, currentTarget: { values: { accountId: 'ig-account', postId: 'post-one', format: 'reel', distribution: 'organic', publishedAt: '2026-11-01T10:00', measuredAt: '2026-11-02T10:00', sourceLabel: 'Dashboard', reach: '100', likes: '0', comments: '', windowKind: 'lifetime' }, reset() {} } })
  assert.equal(added.metrics.reach, 100); assert.equal(added.metrics.likes, 0)
  assert.equal(added.metrics.comments, undefined); assert.equal(added.metrics.shares, undefined)
  assert.equal(added.source.kind, 'manual'); assert.equal(added.verified, undefined)
  assert.ok(flatten(metricTree).some(node => node.type === 'select' && node.props.name === 'accountId'))
})

test('website context is applicable only to website packages and supports optional metadata and link correction', async () => {
  const notApplicable = fixture(); notApplicable.sections.find(section => section.id === 'website').status = 'not_applicable'
  const inactive = await harness(notApplicable)
  assert.equal(flatten(inactive.render()).some(node => typeof node.type === 'function' && node.type.name === 'WebsiteContextForm'), false)
  const h = await harness(); let tree = h.render()
  const node = flatten(tree).find(item => typeof item.type === 'function' && item.type.name === 'WebsiteContextForm')
  assert.ok(node); assert.match(text(tree), /unverified planning inputs/)
  let changed
  const formTree = node.type({ ...node.props, value: { seoTitle: 'Old title', internalLinks: [{ label: 'Old page', url: 'https://example.com/old' }] }, onChange: value => { changed = value } })
  flatten(formTree).find(item => item.type === 'input' && item.props.name === 'seoTitle').props.onChange({ target: { value: '' } })
  assert.equal(changed.seoTitle, undefined, 'empty optional values are omitted for strict backend validation')
  const records = flatten(formTree).find(item => typeof item.type === 'function' && item.type.name === 'DraftRecords')
  records.props.remove(0); assert.equal(changed.internalLinks.length, 0)
  const linkForm = flatten(formTree).find(item => item.type === 'form')
  linkForm.props.onSubmit({ preventDefault() {}, currentTarget: { values: { label: 'Reference page', url: 'https://example.com/reference' }, reset() {} } })
  assert.equal(changed.internalLinks[1].url, 'https://example.com/reference')
  node.props.onChange({ slug: 'ai-update', seoTitle: 'AI update', heroAspectRatio: '16:9' }); tree = h.render()
  h.button(tree, 'Save all context changes').props.onClick(); await h.flush()
  assert.equal(h.savedContext.context.website.slug, 'ai-update')
  assert.equal(h.savedContext.context.website.heroAspectRatio, '16:9')
})

test('external prompt export retains exact speech, source provenance, decision references and missing requirements', async () => {
  const { externalPromptMarkdown } = await load('services/complete-package.ts', { './studio-api': {} })
  const prompt = fixture().prompts[0]; prompt.missing = ['Rights confirmation not supplied']
  const output = externalPromptMarkdown([prompt])
  assert.match(output, /Exact text \/ narration:\nInstagram exact public text/)
  assert.match(output, /decision-one/); assert.match(output, /https:\/\/example.com\/source/)
  assert.match(output, /Rights confirmation not supplied/)
})
