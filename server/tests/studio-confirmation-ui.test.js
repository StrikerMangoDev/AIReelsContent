import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('actual studio confirmation opens and cancels without requests, invalidates changes and dispatches once', async () => {
  const source = await readFile(new URL('../../src/pages/app/StudioPage.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const settings = { industry: 'AI', audience: 'Readers', language: 'English', tone: 'Clear', platform: 'X', duration: 45, voice: 'Auto', outputs: ['script'] }
  const pack = { id: 'p1', revision: 1, settings, status: 'draft', editorialStatus: 'needs_review', content: null, evidence: [{ id: 'E1', excerpt: 'Supported source text. '.repeat(10), limitations: [], retrievedAt: new Date().toISOString() }], title: 'Preview' }
  const slots = []; const effects = []; const requests = []; let routePackageId = 'p1'; let cursor = 0; let finish; let restored = 0; let holdProfile = false; let releaseProfile
  class Element { focus() { restored++ } }
  const trigger = new Element()
  const element = (type, props) => ({ type, props })
  const react = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] }, useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] }, useEffect(effect) { cursor++; effects.push(effect) } }
  const modules = {
    'lucide-react': { ChevronDown: 'svg', Compass: 'svg', Link2: 'svg', X: 'svg' },
    react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-router-dom': { Link: 'a', useLocation: () => ({ pathname: '/studio/p1', search: '' }), useNavigate: () => () => {}, useParams: () => ({ packageId: routePackageId }), useSearchParams: () => [new URLSearchParams()] },
    '@/context/auth-state': { useAuth: () => ({ identity: { uid: 'alice' }, configured: true, loading: false }) },
    '@/services/workspace-session': { activeWorkspace: () => 'personal' },
    '@/services/analytics': { trackEvent() {} },
    '@/services/studio-api': { studioRequest: async (path, body, method) => { requests.push({ path, body, method }); if (path === '/config') return { capabilities: { generation: true } }; if (path === '/profile') return holdProfile ? new Promise(resolve => { releaseProfile = () => resolve(settings) }) : settings; if (path === '/packages') return { packages: [pack] }; if (path.endsWith('/generate') || body?.editorialStatus === 'approved') return new Promise(resolve => { finish = resolve }); if (method === 'PATCH' && body?.content) return { ...pack, ...body, revision: body.revision + 1 }; return pack } },
    './StudioMedia': {}, './StudioLibrary': {}, './StudioHistory': {}, './ContentPreview': { cleanCopy: value => value.replace(/\s*\[C\d+\]/g, '').trim() }, './InstagramPreview': { InstagramPreview: 'InstagramPreview' }, '@/services/storyboard': {}, '@/styles/studio.css': {}, '@/styles/content-workflow.css': {},
  }
  modules['@/services/studio-api'].studioRead = (path, authenticated = true) => modules['@/services/studio-api'].studioRequest(path, undefined, 'GET', authenticated)
  const exports = {}
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, structuredClone, crypto: { randomUUID: () => 'request-1' }, document: { activeElement: trigger }, HTMLElement: Element, window: {}, URLSearchParams })
  const workspace = exports.StudioPage().type
  const render = () => { cursor = 0; effects.length = 0; return workspace() }
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const labelText = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(labelText).join('') : node && typeof node === 'object' ? labelText(node.props?.children) : ''
  const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && labelText(node.props.children) === label)
  let tree = render(); for (const effect of [...effects]) effect(); await new Promise(resolve => setImmediate(resolve)); tree = render(); assert.equal(requests.some(request => request.path === '/packages' || request.path === '/profile'), false, 'opening one draft does not load the library or preferences'); requests.length = 0
  const originalEvidence = pack.evidence
  pack.evidence = [{ id: 'E1', excerpt: 'Short headline' }]; tree = render()
  assert.equal(button(tree, 'Generate content').props.disabled, true)
  assert.ok(button(tree, 'Add source to this draft'))
  assert.equal(button(tree, 'Generate content').props['aria-describedby'], 'generation-feedback')
  assert.match(flatten(tree).find(node => node.props?.id === 'generation-feedback').props.children[0], /Add and save a readable original article/)
  pack.status = 'cancelled'; pack.jobId = 'previous'; tree = render()
  assert.equal(button(tree, 'Add source to this draft'), undefined)
  assert.equal(button(tree, 'Generate content').props.disabled, true)
  pack.status = 'draft'; delete pack.jobId; pack.sourceIds = ['library-1']; tree = render()
  assert.equal(button(tree, 'Add source to this draft'), undefined)
  pack.sourceIds = []
  pack.evidence = originalEvidence; tree = render()
  assert.equal(button(tree, 'Generate content').props.disabled, false)
  assert.match(flatten(tree).find(node => node.props?.id === 'generation-feedback').props.children[0], /Sources are ready/)
  button(tree, 'Generate content').props.onClick(); tree = render()
  assert.ok(button(tree, 'Confirm & generate')); assert.equal(requests.length, 0)
  button(tree, 'Cancel').props.onClick(); tree = render(); assert.equal(requests.length, 0); assert.equal(restored, 1); assert.equal(button(tree, 'Confirm & generate'), undefined)
  button(tree, 'Generate content').props.onClick(); tree = render(); tree.props.onChange(); tree = render(); assert.equal(button(tree, 'Confirm & generate'), undefined); assert.equal(requests.length, 0)
  button(tree, 'Generate content').props.onClick(); tree = render()
  const confirm = button(tree, 'Confirm & generate').props.onClick
  confirm(); confirm(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 1); assert.equal(requests[0].body.confirmed, true); assert.equal(requests[0].body.revision, 1)
  const reviewed = { ...pack, status: 'completed', revision: 2, content: { script: 'Original [C1]', hooks: ['Hook [C1]'], claims: [{ id: 'C1', text: 'Claim', evidenceId: 'E1', quote: 'Exact source passage', status: 'attributed' }], strategy: { angle: 'Original angle', audience: 'Readers', whyNow: 'Today', factCheck: 'Check sources', delivery: 'Clear', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', platforms: [{ platform: 'X', headline: 'Headline [C1]', hook: 'Hook [C1]', body: 'Overclaim [C1]', cta: 'Read source', thumbnail: 'Illustration', format: 'Post', retentionPlan: 'Context', alternativeHook: 'Alternative [C1]', testPlan: 'Observe' }], experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Observed', decisionRule: 'Equal exposure' }] } }, review: { issues: [] }, independentReview: { status: 'passed', expiresAt: new Date(Date.now() + 60000).toISOString() } }
  finish(reviewed); await new Promise(resolve => setImmediate(resolve)); tree = render(); requests.length = 0
  assert.ok(flatten(tree).filter(node => node.type === 'details').every(node => node.props.className.includes('studio-options')), 'only secondary actions use disclosure; content stays readable')
  assert.ok(flatten(tree).some(node => node.type === 'button' && /Sources.*checks/.test(labelText(node.props.children))), 'source validation remains available')
  assert.ok(button(tree, 'Add to Planner'), 'planning remains available in More options')
  assert.equal(button(tree, 'Assign reviewer'), undefined)
  assert.equal(button(tree, 'Download content').props.disabled, false, 'author downloads without an independent reviewer')
  const preview = flatten(tree).find(node => node.type === 'InstagramPreview')
  assert.equal(preview.props.content, reviewed.content)
  const editorNode = flatten(tree).find(node => typeof node.type === 'function' && node.type.name === 'DraftTextEditor')
  editorNode.props.onSlideSelect(3)
  tree = render()
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.previewMode, 'carousel')
  const editorStart = cursor
  const editor = editorNode.type(editorNode.props)
  const sectionButton = (value, label) => flatten(value).find(node => node.type === 'button' && node.props.children?.[0]?.props?.children === label)
  assert.equal(sectionButton(editor, 'Post').props['aria-pressed'], true)
  assert.equal(flatten(editor).some(node => node.type === 'textarea' && /\[C\d+\]/.test(node.props.value)), false, 'editable text never exposes internal citation codes')
  assert.equal(flatten(editor).some(node => node.type === 'select' && node.props['aria-label'] === 'Editing platform'), false, 'one platform needs no selector')
  assert.equal(flatten(editor).find(node => node.props?.id === 'editor-script').props.hidden, true)
  sectionButton(editor, 'Script').props.onClick()
  cursor = editorStart
  const scriptEditor = editorNode.type(editorNode.props)
  assert.equal(flatten(scriptEditor).find(node => node.props?.id === 'editor-script').props.hidden, false)
  assert.equal(flatten(scriptEditor).find(node => node.type === 'section' && node.props.className === 'editor-block editor-block--caption').props.hidden, true)
  assert.equal(requests.length, 0, 'changing editor sections never starts generation or saves edits')
  flatten(scriptEditor).find(node => node.type === 'select' && node.props['aria-label'] === 'Creative brief guidance').props.onChange({ target: { value: 'post-plan' } })
  cursor = editorStart
  const planningEditor = editorNode.type(editorNode.props)
  const fieldGroup = value => flatten(planningEditor).find(node => node.type === 'section' && typeof node.props.hidden === 'boolean' && flatten(node.props.children).some(child => child.type === 'textarea' && child.props.value === value))
  assert.equal(fieldGroup('Overclaim ').props.hidden, true, 'opening guidance does not change the selected Script section')
  assert.equal(fieldGroup('Illustration').props.hidden, false, 'creative instructions remain available separately from post text')

  const bodyField = flatten(editor).find(node => node.type === 'textarea' && node.props.value === 'Overclaim ')
  assert.ok(bodyField)
  bodyField.props.onChange({ target: { value: 'Carefully attributed finding ' } })
  tree = render(); assert.equal(requests.length, 0)
  button(tree, 'Save draft').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  tree = render()
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.previewMode, 'post', 'a new saved revision resets the preview with the remounted editor')
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.activeSlide, 0)
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'PATCH'); assert.equal(requests[0].body.revision, 2)
  assert.equal(requests[0].body.content.strategy.platforms[0].body, 'Carefully attributed finding [C1]')
  assert.deepEqual(requests[0].body.content.claims, reviewed.content.claims)
  assert.equal(requests[0].body.content.strategy.language, 'English'); assert.equal(requests[0].body.content.strategy.voice, 'Female')
  assert.equal(requests[0].body.content.strategy.platforms[0].platform, 'X')
  assert.equal(reviewed.content.strategy.platforms[0].body, 'Overclaim [C1]')
  routePackageId = undefined; slots.length = 0; holdProfile = true
  tree = render(); for (const effect of [...effects]) effect()
  await new Promise(resolve => setImmediate(resolve)); tree = render(); requests.length = 0
  assert.ok(flatten(tree).some(node => node.type === 'a' && node.props.to === '/studio/p1'), 'drafts display while preferences are still pending')
  releaseProfile(); await new Promise(resolve => setImmediate(resolve)); tree = render()
  assert.equal(flatten(tree).find(node => node.props?.id === 'studio-source-entry').props.hidden, true)
  assert.equal(flatten(tree).some(node => node.type === 'ol' && node.props['aria-label'] === 'Content creation progress'), false)
  assert.ok(flatten(tree).find(node => node.type === 'a' && node.props.to === '/ideas'))
  button(tree, 'Paste article link').props.onClick(); tree = render()
  assert.equal(flatten(tree).find(node => node.props?.id === 'studio-source-entry').props.hidden, false)
  assert.equal(requests.length, 0, 'opening source setup does not create a draft or start generation')
  button(tree, 'Close article form').props.onClick(); tree = render()
  assert.ok(flatten(tree).some(node => node.type === 'a' && node.props.to === '/studio/p1'), 'drafts display while preferences are still pending')
  releaseProfile(); await new Promise(resolve => setImmediate(resolve)); tree = render()
  assert.equal(flatten(tree).find(node => node.props?.id === 'studio-source-entry').props.hidden, true)
  const outputPicker = flatten(tree).find(node => typeof node.type === 'function' && node.type.name === 'OutputPicker')
  let selectedOutputs
  let picker = outputPicker.type({ ...outputPicker.props, outputs: [], onChange: value => { selectedOutputs = value } })
  flatten(picker).find(node => node.type === 'input' && node.props.checked === false && flatten(picker).filter(child => child.type === 'input').indexOf(node) === 4).props.onChange({ target: { checked: true } })
  assert.deepEqual(Array.from(selectedOutputs), ['script', 'production'])
  picker = outputPicker.type({ ...outputPicker.props, outputs: selectedOutputs, onChange: value => { selectedOutputs = value } })
  flatten(picker).find(node => node.type === 'input').props.onChange({ target: { checked: false } })
  assert.deepEqual(Array.from(selectedOutputs), [], 'turning off script removes its dependent slides automatically')
})
