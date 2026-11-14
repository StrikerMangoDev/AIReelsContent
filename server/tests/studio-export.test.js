import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { unzipSync, strFromU8 } from 'fflate'
import ts from 'typescript'
import { loadExportModules } from './helpers/studio-export.js'

const pack = { id: 'example', title: 'नया विचार <script>alert(1)</script>', revision: 4, status: 'completed', settings: { platform: 'Instagram', audience: 'Readers', language: 'Hindi', duration: 45, tone: 'Clear' }, evidence: [{ id: 'E1', title: 'Original source', url: 'https://example.com/source', limitations: ['Not independently verified'] }], review: { issues: [] }, content: {
  script: 'Unique narration नमस्ते 🌳 [C1]', hooks: ['Unique alternative [C1]'], claims: [{ id: 'C1', text: 'Supported claim', quote: 'Exact source quotation', evidenceId: 'E1', status: 'attributed' }],
  scenes: [{ timing: '0–10s', narration: 'Scene narration', onScreen: 'Scene text', visualPrompt: 'Visual prompt', voiceDirection: 'Calm voice' }],
  strategy: { angle: 'Unique angle', audience: 'Readers', whyNow: 'Today', factCheck: 'Read the original source', language: 'Hindi', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Clear', keywords: ['UniqueKeyword'], production: { videoPrompt: 'Unique production direction' }, experiments: [], platforms: [{ platform: 'Instagram', format: 'post', headline: 'Headline [C1]', hook: 'Opening [C1]', body: 'Saved post body [C1]', cta: 'Read more', hashtags: ['#UniqueHashtag'], alternativeHook: 'Other opening', retentionPlan: 'Retain', testPlan: 'Compare', thumbnail: 'Thumbnail direction' }] },
} }
const exported = { package: pack, manifest: { revision: 4, contentHash: 'server-validated-hash', releasePolicy: 'owner-download-v1' } }

test('all six formats preserve Unicode, sources and manifest; DOCX and ZIP contain valid archives', async () => {
  const helpers = (await loadExportModules())['@/services/studio-export']
  const blobs = {}
  for (const choice of helpers.exportFormats) {
    const blob = await helpers.buildExportFile(exported, 'reel', choice.id)
    assert.equal(blob.type, choice.mime)
    blobs[choice.id] = blob
    if (!['zip', 'docx'].includes(choice.id)) {
      const value = await blob.text()
      for (const text of ['नमस्ते 🌳', 'Exact source quotation', 'https://example.com/source', 'server-validated-hash']) assert.ok(value.includes(text), `${choice.id}: ${text}`)
    }
  }
  const html = await blobs.html.text()
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /default-src 'none'/)
  const docx = unzipSync(new Uint8Array(await blobs.docx.arrayBuffer()))
  assert.deepEqual(Object.keys(docx).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].sort())
  const xml = strFromU8(docx['word/document.xml'])
  for (const value of ['नमस्ते 🌳', 'Exact source quotation', 'server-validated-hash', '&lt;script&gt;']) assert.ok(xml.includes(value))
  assert.match(strFromU8(docx['_rels/.rels']), /Target="word\/document.xml"/)
  const zip = unzipSync(new Uint8Array(await blobs.zip.arrayBuffer()))
  assert.deepEqual(Object.keys(zip).sort(), ['content.md', 'content.json', 'content.txt', 'content.html', 'content.docx'].sort())
  for (const format of ['md', 'json', 'txt', 'html']) assert.equal(strFromU8(zip[`content.${format}`]), await blobs[format].text())
  assert.equal(strFromU8(unzipSync(zip['content.docx'])['word/document.xml']), xml)
})

test('section selection omits unselected material without dropping claim provenance or changing saved data', async () => {
  const helpers = (await loadExportModules())['@/services/studio-export']
  const before = JSON.stringify(exported)
  const markdown = helpers.exportDocument(pack, 'reel', ['main'])
  assert.match(markdown, /Unique narration/)
  assert.doesNotMatch(markdown, /Unique angle|UniqueKeyword|UniqueHashtag|Unique alternative|Unique production direction|Visual prompt|Other opening|Thumbnail direction/)
  assert.match(markdown, /Exact source quotation/)
  const data = helpers.exportData(exported, 'reel', ['main'])
  assert.deepEqual(Array.from(data.exportSelection.sections), ['main', 'sources'])
  assert.equal(data.package.content.strategy.keywords, undefined)
  assert.equal(data.package.content.strategy.platforms[0].hashtags, undefined)
  assert.equal(data.package.content.strategy.platforms[0].alternativeHook, undefined)
  assert.equal(data.package.content.scenes[0].visualPrompt, undefined)
  assert.equal(data.productionHandoffs, undefined)
  assert.deepEqual(data.package.content.claims, pack.content.claims)
  assert.deepEqual(data.package.evidence, pack.evidence)
  assert.deepEqual(data.manifest, exported.manifest)
  assert.match(data.exportSelection.manifestScope, /before section selection/)
  const sourcesOnly = helpers.exportDocument(pack, 'post', [])
  assert.doesNotMatch(sourcesOnly, /Unique narration|Saved post body|Unique alternative|UniqueKeyword|Unique angle/)
  assert.match(sourcesOnly, /Exact source quotation/)
  assert.equal(JSON.stringify(exported), before)
  await assert.rejects(helpers.buildExportFile({ ...exported, package: { ...pack, content: null } }, 'post', 'md'), /Saved content/)
  await assert.rejects(helpers.buildExportFile(exported, 'post', 'exe'), /available export format/)
})

test('format picker, selection, preview, download, copy and handoff actions use the saved package', async () => {
  const modules = await loadExportModules()
  const slots = []; let cursor = 0; let props; let copied = ''; const actions = []
  const element = (type, props) => ({ type, props })
  modules.react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
  }
  modules['react/jsx-runtime'] = { jsx: element, jsxs: element }
  modules['lucide-react'] = {}
  modules['./ContentPreview'] = modules['../pages/app/ContentPreview']
  modules['@/styles/studio-export.css'] = {}
  modules['@/services/studio-package'] = { formatLabels: { post: 'Social post' } }
  modules['../../../shared/social-caption.js'] = await import('../../shared/social-caption.js')
  const source = await readFile(new URL('../../src/pages/app/StudioExport.tsx', import.meta.url), 'utf8')
  const exports = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, navigator: { clipboard: { writeText: async value => { copied = value } } } })
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
  const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))
  const render = patch => { props = { pack, contentFormat: 'post', disabled: false, dirty: false, busy: '', error: '', onDownload: async (...args) => actions.push(args), onEdit: () => actions.push('edit'), onSources: () => actions.push('sources'), onHandoff: view => actions.push(view), onPublishing: () => actions.push('publishing'), ...props, ...patch }; cursor = 0; return exports.StudioExport(props) }
  let tree = render()
  const radios = flatten(tree).filter(node => node.props?.type === 'radio')
  assert.equal(radios.length, 6)
  const sources = flatten(tree).find(node => node.props?.value === 'sources')
  assert.equal(sources.props.checked, true); assert.equal(sources.props.disabled, true)
  const alternatives = flatten(tree).find(node => node.props?.value === 'alternatives')
  alternatives.props.onChange({ target: { checked: true } }); tree = render()
  assert.match(text(tree), /5 of 6/)
  for (const radio of radios) {
    radio.props.onChange(); tree = render()
    button(tree, 'Download package').props.onClick()
    assert.equal(actions.at(-1)[0], radio.props.value)
    assert.ok(actions.at(-1)[1].includes('alternatives'))
    if (radio.props.value === 'txt') assert.doesNotMatch(text(flatten(tree).find(node => node.type === 'pre')), /^#{1,6} /m)
  }
  let open = false
  flatten(tree).find(node => node.type === 'dialog').props.ref.current = { showModal() { open = true }, close() { open = false } }
  button(tree, 'Preview file').props.onClick(); assert.equal(open, true)
  assert.match(text(flatten(tree).find(node => node.type === 'pre')), /Unique alternative/)
  button(tree, 'Close file preview').props.onClick(); assert.equal(open, false)
  button(tree, 'Copy post').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.match(copied, /Saved post body/); assert.doesNotMatch(copied, /\[C1\]/)
  assert.match(copied, /https:\/\/example.com\/source/)
  assert.doesNotMatch(copied, /Headline|Opening|UniqueHashtag/, 'copy matches publishing text rather than appending optional alternatives')
  for (const patch of [{ dirty: true }, { pack: { ...pack, status: 'dispatch_unknown' } }, { pack: { ...pack, review: { issues: ['bad citation'] } } }, { busy: 'Preparing your download' }]) {
    tree = render({ pack, dirty: false, busy: '', ...patch, disabled: true })
    assert.equal(button(tree, 'Preview file').props.disabled, true)
    assert.equal(button(tree, 'Download package').props.disabled, true)
    assert.equal(button(tree, 'Copy post').props.disabled, true)
    assert.match(text(tree), /Save your edits|previous generation attempt|source checks|Preparing your download/)
  }
})
