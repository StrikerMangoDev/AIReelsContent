import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createMemoryRouter } from 'react-router-dom'

test('one click opens the loading editor, dispatches once and preserves revision and navigation guards', async t => {
  const router = createMemoryRouter([{ path: '*', element: null }], { initialEntries: ['/ideas', '/studio/p1', '/planning'], initialIndex: 1 })
  t.after(() => router.dispose())
  const source = await readFile(new URL('../../src/pages/app/StudioPage.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const settings = { industry: 'AI', audience: 'Readers', language: 'English', tone: 'Clear', platform: 'X', duration: 45, voice: 'Auto', outputs: ['script'] }
  const pack = { id: 'p1', revision: 1, settings, status: 'draft', editorialStatus: 'needs_review', content: null, evidence: [{ id: 'E1', excerpt: 'Supported source text. '.repeat(10), limitations: [], retrievedAt: new Date().toISOString() }], title: 'Preview' }
  let stored = pack
  const slots = []; const effects = []; const requests = []; let routePackageId = 'p1'; let cursor = 0; let finish; let holdProfile = false; let releaseProfile
  class Element { focus() {} }
  const trigger = new Element()
  const element = (type, props, key) => ({ type, props, key })
  const react = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] }, useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] }, useEffect(effect) { cursor++; effects.push(effect) } }
  const modules = {
    'lucide-react': { ChevronDown: 'svg', Compass: 'svg', Link2: 'svg', X: 'svg' },
    '@/components/ui/IconButton': { IconButton: 'button' },
    react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-router-dom': { Link: 'a', useBlocker: dirty => router.getBlocker('studio', () => dirty), useLocation: () => ({ pathname: '/studio/p1', search: '' }), useNavigate: () => () => {}, useParams: () => ({ packageId: routePackageId }), useSearchParams: () => [new URLSearchParams()] },
    '@/context/auth-state': { useAuth: () => ({ identity: { uid: 'alice' }, configured: true, loading: false }) },
    '@/services/workspace-session': { activeWorkspace: () => 'personal', workspaceIdentity: () => 'alice' },
    '@/services/analytics': { trackEvent() {} },
    '@/services/studio-api': { studioRequest: async (path, body, method) => { requests.push({ path, body, method }); if (path === '/config') return { capabilities: { generation: true } }; if (path === '/profile') return holdProfile ? new Promise(resolve => { releaseProfile = () => resolve(settings) }) : settings; if (path === '/packages') return { packages: [pack] }; if (path.endsWith('/generate') || body?.editorialStatus === 'approved') return new Promise(resolve => { finish = value => { stored = value; resolve(value) } }); if (method === 'PATCH' && body?.settings) return { ...stored, settings: body.settings, revision: body.revision + 1 }; if (method === 'PATCH' && body?.content) return { ...pack, ...body, revision: body.revision + 1 }; return pack } },
    './StudioMedia': {}, './StudioPublishing': {}, './StudioLibrary': {}, './StudioHistory': {}, './ContentPreview': { cleanCopy: value => value.replace(/\s*\[C\d+\]/g, '').trim() }, './ConnectedPostPreview': { ConnectedPostPreview: 'InstagramPreview' }, '@/services/storyboard': {}, '@/styles/studio.css': {}, '@/styles/content-workflow.css': {},
  }
  modules['@/services/studio-api'].qualityDimensions = { relevance: 'Relevance', originality: 'Originality', clarity: 'Clarity', hookStrength: 'Hook', brandFit: 'Brand', factualAccuracy: 'Facts', cta: 'CTA' }
  modules['@/services/studio-api'].studioRead = (path, authenticated = true) => modules['@/services/studio-api'].studioRequest(path, undefined, 'GET', authenticated)
  const packageExports = {}
  const packageSource = await readFile(new URL('../../src/services/studio-package.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(packageSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: packageExports })
  modules['@/services/studio-package'] = packageExports
  modules['./StudioPackageSetup'] = { StudioPackageSetup: 'StudioPackageSetup' }
  modules['./StudioSetupPreview'] = { StudioSetupPreview: 'StudioSetupPreview' }
  const handoffExports = {}
  const handoffSource = await readFile(new URL('../../src/services/production-handoff.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(handoffSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: handoffExports })
  modules['@/services/production-handoff'] = handoffExports
  modules['@/services/studio-export'] = {}
  modules['./StudioExport'] = { StudioExport: 'StudioExport' }
  modules['./StudioProductionPrompts'] = { StudioProductionPrompts: 'StudioProductionPrompts' }
  modules['./StudioCompletePackage'] = { StudioCompletePackage: 'StudioCompletePackage' }
  modules['@/styles/studio-desk.css'] = {}
  modules['@/styles/studio-flow.css'] = {}
  modules['@/styles/studio-home.css'] = {}
  modules['@/styles/studio-setup.css'] = {}
  modules['./StudioDraftList'] = { StudioDraftList: 'StudioDraftList' }
  modules['./StudioKeywordUsage'] = { StudioKeywordUsage: 'StudioKeywordUsage' }
  modules['@/styles/studio-editor.css'] = {}
  modules['./StudioFlowCards'] = { StudioStartCards: 'StudioStartCards', StudioWorkspaceGuide: 'StudioWorkspaceGuide' }
  const exports = {}
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, Error, structuredClone, crypto: { randomUUID: () => 'request-1' }, document: { activeElement: trigger }, HTMLElement: Element, window: { setInterval() { return 1 }, clearInterval() {} }, URLSearchParams })
  const workspace = exports.StudioPage().type
  const render = () => { cursor = 0; effects.length = 0; return workspace() }
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const labelText = node => node && typeof node === 'object' && node.props?.['aria-hidden'] ? '' : typeof node === 'number' ? String(node) : typeof node === 'string' ? node : Array.isArray(node) ? node.map(labelText).join('') : node && typeof node === 'object' ? labelText(node.props?.children) : ''
  const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && (labelText(node.props.children) || node.props['aria-label'] || node.props.label) === label)
  const assertBlocked = async () => {
    const calls = requests.length
    for (const destination of [-1, 1, '/ideas']) {
      await router.navigate(destination); await new Promise(resolve => setImmediate(resolve))
      const guarded = render()
      assert.equal(router.state.location.pathname, '/studio/p1')
      assert.equal(router.state.blockers.get('studio').state, 'blocked')
      assert.ok(button(guarded, 'Discard changes and leave'))
      button(guarded, 'Keep editing').props.onClick()
      assert.equal(router.state.blockers.get('studio').state, 'unblocked')
    }
    assert.equal(requests.length, calls, 'navigation attempts neither save nor dispatch generation')
  }
  let tree = render(); for (const effect of [...effects]) effect(); await new Promise(resolve => setImmediate(resolve)); tree = render(); assert.equal(requests.some(request => request.path === '/packages' || request.path === '/profile'), false, 'opening one draft does not load the library or preferences'); requests.length = 0
  assert.equal(button(tree, 'Plan content strategy'), undefined, 'no duplicate strategy action on Setup')
  assert.equal(button(tree, 'Set the content brief'), undefined, 'no competing brief action on Setup')
  const moreOptions = flatten(tree).find(node => node.type === 'details' && node.props.className === 'studio-workspace-tools')
  assert.match(labelText(moreOptions.props.children[0]), /More options/)
  assert.ok(flatten(tree).find(node => node.props?.className === 'studio-options setup-source-summary'), 'source records remain accessible before generation')
  assert.ok(button(tree, 'Workspace guide'), 'guide remains inside secondary tools')
  assert.equal(button(tree, 'Setup').props['aria-pressed'], true)
  assert.equal(button(tree, 'Edit & preview').props['aria-pressed'], false)
  button(tree, 'Strategy workflow').props.onClick({ currentTarget: { closest: () => null } }); tree = render()
  const planned = flatten(tree).find(node => node.type === 'StudioCompletePackage')
  assert.ok(planned, 'strategy is available before first content generation')
  assert.equal(planned.props.initialView, 'workflow')
  assert.equal(flatten(tree).find(node => node.props?.className?.includes('studio-setup')).props.hidden, true)
  assert.equal(requests.length, 0, 'opening pre-generation strategy starts no save, AI or publishing request')
  button(tree, 'Setup').props.onClick(); tree = render()
  const originalEvidence = pack.evidence
  pack.evidence = [{ id: 'E1', excerpt: 'Short headline' }]; tree = render()
  assert.equal(button(tree, 'Generate content').props.disabled, true)
  button(tree, 'Generate content').props.onClick(); assert.equal(requests.length, 0, 'the handler also refuses missing evidence')
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
  const generate = button(tree, 'Generate content').props.onClick
  generate(); generate(); tree = render()
  assert.equal(button(tree, 'Confirm & generate'), undefined, 'no second confirmation step')
  assert.equal(button(tree, 'Edit & preview').props['aria-pressed'], true)
  assert.equal(button(tree, 'Edit & preview').props.disabled, false)
  assert.ok(flatten(tree).find(node => node.props?.['aria-label'] === 'Generating content'), 'the next workspace shows a loader before content arrives')
  assert.equal(flatten(tree).find(node => node.props?.className?.includes('studio-setup')).props.hidden, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 1); assert.equal(requests[0].body.confirmed, true); assert.equal(requests[0].body.revision, 1)
  const reviewed = { ...pack, status: 'completed', revision: 2, content: { script: 'Original [C1]', hooks: ['Hook [C1]'], claims: [{ id: 'C1', text: 'Claim', evidenceId: 'E1', quote: 'Exact source passage', status: 'attributed' }], strategy: { angle: 'Original angle', audience: 'Readers', whyNow: 'Today', factCheck: 'Check sources', delivery: 'Clear', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', platforms: [{ platform: 'X', headline: 'Headline [C1]', hook: 'Hook [C1]', body: 'Overclaim [C1]', cta: 'Read source', thumbnail: 'Illustration', format: 'Post', retentionPlan: 'Context', alternativeHook: 'Alternative [C1]', testPlan: 'Observe' }], experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Observed', decisionRule: 'Equal exposure' }] } }, review: { issues: [] }, independentReview: { status: 'passed', expiresAt: new Date(Date.now() + 60000).toISOString() } }
  finish(reviewed); await new Promise(resolve => setImmediate(resolve)); tree = render(); requests.length = 0
  let editorFocus = 0; let editorScroll = 0
  const readyHeading = flatten(tree).find(node => node.type === 'h2' && labelText(node) === 'Your generated content')
  readyHeading.props.ref.current = { focus() { editorFocus++ }, scrollIntoView() { editorScroll++ } }
  const focusReady = effects.find(effect => effect.toString().includes('focusGeneratedContent.current'))
  focusReady(); focusReady()
  assert.equal(editorFocus, 1, 'successful generation focuses the actual editor once')
  assert.equal(editorScroll, 1, 'generation completion moves to the generated content, not the workspace shell')
  const supportNode = flatten(tree).find(node => typeof node.type === 'function' && node.type.name === 'EditorSupport')
  const support = supportNode.type(supportNode.props)
  assert.match(labelText(support), /Media requirements: check before publishing/)
  assert.doesNotMatch(labelText(support), /Account connected|Media ready/)
  button(support, 'Make it simplerClearer wording for your audience').props.onClick(); tree = render()
  const revisionInput = flatten(tree).find(node => node.type === 'textarea' && node.props.maxLength === 2000)
  assert.match(revisionInput.props.value, /Simplify the wording/)
  assert.equal(requests.length, 0, 'assistant actions prepare a request without calling AI')
  revisionInput.props.onChange({ target: { value: '' } }); tree = render()
  button(tree, 'Edit & preview').props.onClick(); tree = render()
  const blockedSupport = supportNode.type({ ...supportNode.props, disabled: true, dirty: true })
  assert.ok(flatten(blockedSupport).filter(node => node.type === 'button' && node.props.children?.[0]?.type === 'strong').every(node => node.props.disabled))
  assert.match(labelText(blockedSupport), /Save your edits before asking AI/)
  const packageSetup = flatten(tree).find(node => node.type === 'StudioPackageSetup')
  packageSetup.props.onChange({ ...packageSetup.props.profile, audience: 'Updated audience', duration: 120 })
  tree = render()
  await assertBlocked(); tree = render()
  assert.equal(button(tree, 'Generate selected content').props.disabled, false, 'audience or duration changes need regeneration even when output choices stay the same')
  const regenerate = button(tree, 'Generate selected content').props.onClick
  regenerate(); regenerate(); await new Promise(resolve => setImmediate(resolve)); tree = render()
  assert.equal(requests.length, 2, 'one settings save followed by one generation, even on repeated clicks')
  assert.equal(requests[0].body.settings.audience, 'Updated audience')
  assert.equal(requests[0].body.settings.duration, 120)
  assert.equal(requests[1].body.revision, requests[0].body.revision + 1, 'generation uses the updated settings revision')
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.content, reviewed.content, 'saved content stays available while regenerating')
  finish(reviewed); await new Promise(resolve => setImmediate(resolve)); tree = render(); requests.length = 0
  assert.ok(flatten(tree).filter(node => node.type === 'details').every(node => node.props.className.includes('studio-options') || node.props.className === 'studio-workspace-tools' || node.props.className === 'setup-format-help' || !node.props.className), 'only secondary actions use disclosure; content stays readable')
  assert.ok(flatten(tree).some(node => node.type === 'button' && /Source.*checks/.test(labelText(node.props.children))), 'source validation remains available')
  assert.ok(button(tree, 'Add to Planner'), 'planning remains available in More options')
  button(tree, 'Content brief').props.onClick({ currentTarget: { closest: () => null } }); tree = render()
  const completePackage = flatten(tree).find(node => node.type === 'StudioCompletePackage')
  assert.ok(completePackage)
  completePackage.props.onDirtyChange(true); tree = render()
  await assertBlocked(); tree = render()
  button(tree, 'Production kit').props.onClick({ currentTarget: { closest: () => null } }); tree = render()
  assert.ok(flatten(tree).some(node => node.type === 'StudioCompletePackage'), 'unsaved package context prevents panel exit')
  assert.match(labelText(tree), /Save or discard your unsaved workspace details/)
  completePackage.props.onDirtyChange(false); tree = render()
  assert.doesNotMatch(labelText(tree), /Save or discard your unsaved workspace details before leaving this tool\./, 'saving or discarding context clears only its panel-exit warning')
  button(tree, 'Production kit').props.onClick({ currentTarget: { closest: () => null } }); tree = render()
  const handoffNode = flatten(tree).find(node => node.type === 'StudioProductionPrompts')
  const mediaNode = flatten(tree).find(node => node.props?.packageId === reviewed.id && node.props?.initialPrompt !== undefined)
  assert.ok(handoffNode); assert.ok(mediaNode)
  assert.equal(handoffNode.props.pack, reviewed, 'team prompts bind to the saved package rather than transient editor values')
  assert.notEqual(handoffNode.key, mediaNode.key, 'handoff and media siblings need distinct keys to avoid duplicate panels after navigation')
  button(tree, 'Edit & preview').props.onClick(); tree = render()
  assert.equal(button(tree, 'Assign reviewer'), undefined, 'owner tool has no reviewer assignment')
  assert.equal(button(tree, 'Approve reviewed version'), undefined, 'owner tool has no separate approval step')
  const exportPanel = value => flatten(value).find(node => node.type === 'StudioExport')
  assert.equal(exportPanel(tree).props.disabled, false, 'saved valid content needs no second person')
  reviewed.independentReview.expiresAt = new Date(Date.now() - 1000).toISOString()
  reviewed.independentReview.status = 'needs_revision'
  tree = render(); assert.equal(exportPanel(tree).props.disabled, false, 'legacy review state does not gate owner download')
  reviewed.review.issues = ['Quotation does not match source']
  tree = render(); assert.equal(exportPanel(tree).props.disabled, true, 'citation problems still block')
  reviewed.review.issues = []
  tree = render()
  const preview = flatten(tree).find(node => node.type === 'InstagramPreview')
  assert.equal(preview.props.content, reviewed.content)
  const workingFormat = flatten(tree).find(node => node.type === 'select' && node.props.name === 'workingFormat')
  const beforeViewChange = requests.length
  workingFormat.props.onChange({ target: { value: 'post' } }); tree = render()
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.contentFormat, 'post')
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.content, reviewed.content)
  assert.equal(requests.length, beforeViewChange, 'changing the working format never saves or regenerates')
  flatten(tree).find(node => node.type === 'select' && node.props.name === 'workingFormat').props.onChange({ target: { value: 'reel' } }); tree = render()
  const editorNode = flatten(tree).find(node => typeof node.type === 'function' && node.type.name === 'DraftTextEditor')
  editorNode.props.onSlideSelect(3)
  tree = render()
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.contentFormat, 'reel')
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.activeSlide, 3)
  const editorStart = cursor
  const editor = editorNode.type(editorNode.props)
  const sectionButton = (value, label) => flatten(value).find(node => node.type === 'button' && node.props.children?.[0]?.props?.children === label)
  assert.equal(sectionButton(editor, 'Narration').props['aria-pressed'], true)
  assert.equal(flatten(editor).some(node => node.type === 'textarea' && /\[C\d+\]/.test(node.props.value)), false, 'editable text never exposes internal citation codes')
  assert.equal(flatten(editor).some(node => node.type === 'select' && node.props['aria-label'] === 'Editing platform'), false, 'one platform needs no selector')
  assert.equal(flatten(editor).find(node => node.props?.id === 'editor-script').props.hidden, false)
  sectionButton(editor, 'Post text').props.onClick()
  sectionButton(editor, 'Narration').props.onClick()
  cursor = editorStart
  const scriptEditor = editorNode.type(editorNode.props)
  assert.equal(flatten(scriptEditor).find(node => node.props?.id === 'editor-script').props.hidden, false)
  assert.equal(flatten(scriptEditor).find(node => node.type === 'section' && node.props.className === 'editor-block editor-block--caption').props.hidden, true)
  assert.equal(requests.length, 0, 'changing editor sections never starts generation or saves edits')
  button(scriptEditor, 'Design & posting brief').props.onClick()
  cursor = editorStart
  const planningEditor = editorNode.type(editorNode.props)
  const fieldGroup = value => flatten(planningEditor).find(node => node.type === 'section' && typeof node.props.hidden === 'boolean' && flatten(node.props.children).some(child => child.type === 'textarea' && child.props.value === value))
  assert.equal(fieldGroup('Overclaim ').props.hidden, true, 'opening guidance does not change the selected Script section')
  assert.equal(fieldGroup('Illustration').props.hidden, false, 'creative instructions remain available separately from post text')

  const bodyField = flatten(editor).find(node => node.type === 'textarea' && node.props.value === 'Overclaim ')
  assert.ok(bodyField)
  bodyField.props.onChange({ target: { value: 'Carefully attributed finding ' } })
  tree = render(); assert.equal(requests.length, 0)
  await assertBlocked(); tree = render()
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.content.strategy.platforms[0].body, 'Carefully attributed finding [C1]', 'Back and Forward cancellation preserve edited text')
  flatten(tree).find(node => node.type === 'select' && node.props.name === 'workingFormat').props.onChange({ target: { value: 'post' } }); tree = render()
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.content.strategy.platforms[0].body, 'Carefully attributed finding [C1]', 'format changes keep unsaved edits and citation tokens')
  assert.equal(exportPanel(tree).props.disabled, true, 'format switching cannot unlock unsaved content')
  flatten(tree).find(node => node.type === 'select' && node.props.name === 'workingFormat').props.onChange({ target: { value: 'reel' } }); tree = render()
  assert.equal(requests.length, 0)
  button(tree, 'Save draft').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  tree = render()
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.contentFormat, 'reel', 'a saved revision keeps the working format shared with the remounted editor')
  assert.equal(flatten(tree).find(node => node.type === 'InstagramPreview').props.activeSlide, 0)
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'PATCH'); assert.equal(requests[0].body.revision, 2)
  assert.equal(requests[0].body.content.strategy.platforms[0].body, 'Carefully attributed finding [C1]')
  assert.deepEqual(requests[0].body.content.claims, reviewed.content.claims)
  assert.equal(requests[0].body.content.strategy.language, 'English'); assert.equal(requests[0].body.content.strategy.voice, 'Female')
  assert.equal(requests[0].body.content.strategy.platforms[0].platform, 'X')
  assert.equal(reviewed.content.strategy.platforms[0].body, 'Overclaim [C1]')
  await router.navigate(-1); await new Promise(resolve => setImmediate(resolve))
  assert.equal(router.state.location.pathname, '/ideas', 'saved writing permits Back')
  await router.navigate(1); await new Promise(resolve => setImmediate(resolve))
  tree = render(); button(tree, 'Content brief').props.onClick({ currentTarget: { closest: () => null } }); tree = render()
  flatten(tree).find(node => node.type === 'StudioCompletePackage').props.onDirtyChange(true); render()
  await router.navigate(-1); await new Promise(resolve => setImmediate(resolve)); tree = render()
  const beforeLeave = requests.length
  button(tree, 'Discard changes and leave').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(router.state.location.pathname, '/ideas', 'explicit discard proceeds to the blocked destination')
  assert.equal(requests.length, beforeLeave, 'discard-and-leave does not write or generate')
  routePackageId = undefined; slots.length = 0; holdProfile = true
  tree = render(); for (const effect of [...effects]) effect()
  await new Promise(resolve => setImmediate(resolve)); tree = render(); requests.length = 0
  assert.ok(flatten(tree).some(node => node.type === 'StudioDraftList' && node.props.packages.some(pack => pack.id === 'p1')), 'drafts display while preferences are still pending')
  releaseProfile(); await new Promise(resolve => setImmediate(resolve)); tree = render()
  assert.equal(flatten(tree).find(node => node.props?.id === 'studio-source-entry').props.hidden, true)
  assert.equal(flatten(tree).some(node => node.type === 'ol' && node.props['aria-label'] === 'Content creation progress'), false)
  assert.equal(flatten(tree).find(node => node.type === 'StudioStartCards').props.articleOpen, false)
  flatten(tree).find(node => node.type === 'StudioStartCards').props.onArticleToggle(); tree = render()
  assert.equal(flatten(tree).find(node => node.props?.id === 'studio-source-entry').props.hidden, false)
  assert.equal(requests.length, 0, 'opening source setup does not create a draft or start generation')
  button(tree, '← Back to Content Studio').props.onClick(); tree = render()
  assert.ok(flatten(tree).some(node => node.type === 'StudioDraftList' && node.props.packages.some(pack => pack.id === 'p1')), 'drafts display while preferences are still pending')
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
  const originalRequest = modules['@/services/studio-api'].studioRequest
  routePackageId = 'p1'; slots.length = 0; holdProfile = false
  modules['@/services/studio-api'].studioRequest = async (path, body, method) => {
    if (path.endsWith('/generate')) { requests.push({ path, body, method }); return { ...pack, status: 'generating', jobId: 'queued-1', jobStatus: 'reserved' } }
    return originalRequest(path, body, method)
  }
  tree = render(); for (const effect of [...effects]) effect(); await new Promise(resolve => setImmediate(resolve)); tree = render(); requests.length = 0
  await button(tree, 'Generate content').props.onClick(); tree = render()
  assert.ok(flatten(tree).some(node => node.props?.['aria-label'] === 'Generating content'), 'a queued response keeps the loading workspace open')
  assert.equal(requests.filter(request => request.path.endsWith('/generate')).length, 1)
  slots.length = 0
  modules['@/services/studio-api'].studioRequest = async (path, body, method) => {
    if (path.endsWith('/generate')) { requests.push({ path, body, method }); throw new Error('Daily content generation limit reached.') }
    return originalRequest(path, body, method)
  }
  tree = render(); for (const effect of [...effects]) effect(); await new Promise(resolve => setImmediate(resolve)); tree = render(); requests.length = 0
  await button(tree, 'Generate content').props.onClick(); tree = render()
  assert.equal(flatten(tree).some(node => node.props?.['aria-label'] === 'Generating content'), false, 'rejected admission stops the loader')
  assert.match(labelText(tree), /Daily content generation limit reached/)
  assert.equal(flatten(tree).find(node => node.props?.className?.includes('studio-setup')).props.hidden, false, 'failed admission returns to the preserved settings')
  assert.equal(requests.filter(request => request.path.endsWith('/generate')).length, 1)

})
