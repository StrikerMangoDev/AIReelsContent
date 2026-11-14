import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function load(path, modules = {}, globals = {}) {
  const source = await readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8')
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, ...globals })
  return exports
}
const fixture = () => ({
  id: 'saved-handoff', revision: 4, title: 'A source-supported video',
  settings: { audience: 'Beginners', language: 'Hindi', tone: 'Clear', platform: 'Instagram', duration: 60, voice: 'Female' },
  evidence: [{ id: 'E1', url: 'https://example.com/article' }],
  content: { script: 'First supported sentence [C1]. Second supported sentence [C2].', claims: [{ id: 'C1', evidenceId: 'E1', quote: 'Exact publisher quote' }],
    scenes: [{ timing: '0–30s', narration: 'First supported sentence [C1].', onScreen: 'First slide [C1]', visualPrompt: 'A simple wheel diagram', voiceDirection: 'Calm explanation' }, { timing: '30–60s', narration: 'Second supported sentence [C2].', onScreen: 'Second slide [C2]', visualPrompt: 'A side-by-side comparison', voiceDirection: 'Pause at the end' }],
    strategy: { delivery: 'Warm and clear', language: 'Hindi', voice: 'Female', platforms: [{ platform: 'Instagram', headline: 'Saved headline [C1]', thumbnail: 'Minimal chart with space for a headline', cta: 'Read the source' }], production: { videoPrompt: 'Use clean editorial graphics', audioPrompt: 'Read the exact saved narration', musicDirection: 'Quiet cleared instrumental', subtitleStyle: 'Large readable words', editingNotes: 'Keep scene order' } },
  },
})
const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : ''

test('team prompts use saved copy, preserve canonical citations and separate voice directions from speech', async () => {
  const { buildProductionPrompt, productionHandoffs, productionHandoffMarkdown } = await load('services/production-handoff.ts')
  const pack = fixture(); const original = JSON.stringify(pack)
  const video = buildProductionPrompt(pack, { team: 'video' })
  assert.equal(video.missing, '')
  assert.match(video.prompt, /60-second narrated video in 9:16/)
  assert.match(video.prompt, /First supported sentence/)
  assert.match(video.prompt, /Second supported sentence/)
  assert.match(video.prompt, /Scene 2/)
  assert.match(video.prompt, /Large readable words/)
  const audio = buildProductionPrompt(pack, { team: 'audio' })
  assert.match(audio.prompt, /Warm and clear/)
  assert.match(audio.prompt, /Quiet cleared instrumental/)
  assert.equal(audio.narration, 'First supported sentence. Second supported sentence.')
  assert.doesNotMatch(audio.narration, /Voice preference|Warm and clear|\[C\d+\]/)
  assert.match(buildProductionPrompt(pack, { team: 'editor' }).prompt, /Keep scene order/)
  const graphics = buildProductionPrompt(pack, { team: 'graphics', graphic: 'slide', sceneIndex: 1, ratio: '4:5' })
  assert.match(graphics.prompt, /4:5/)
  assert.match(graphics.prompt, /Second slide/)
  assert.match(graphics.prompt, /side-by-side/)
  assert.doesNotMatch(graphics.prompt, /First slide|\[C\d+\]/)
  const handoffs = productionHandoffs(pack)
  assert.equal(handoffs.revision, 4)
  assert.equal(handoffs.graphics.scenes.length, 2)
  assert.match(productionHandoffMarkdown(pack), /Slide \/ scene 2/)
  assert.equal(JSON.stringify(pack), original, 'building/copying never changes the cited package')
})

test('automatic brief settings resolve from saved strategy for every team and export', async () => {
  const { buildProductionPrompt, productionHandoffMarkdown } = await load('services/production-handoff.ts')
  const pack = fixture()
  pack.settings.audience = 'Infer from the brief'
  pack.settings.tone = 'Auto'
  pack.content.strategy.audience = 'Finance professionals'
  for (const team of ['video', 'audio', 'graphics', 'editor']) {
    const { prompt } = buildProductionPrompt(pack, { team })
    assert.match(prompt, /Audience: Finance professionals/)
    assert.match(prompt, /Writing style: Warm and clear/)
    assert.doesNotMatch(prompt, /Infer from the brief|Writing style: Auto/)
  }
  assert.match(productionHandoffMarkdown(pack), /Audience: Finance professionals/)
  pack.settings.audience = 'First-time creators'
  pack.settings.tone = 'Conversational'
  assert.match(buildProductionPrompt(pack, { team: 'video' }).prompt, /Audience: First-time creators/)
  assert.match(buildProductionPrompt(pack, { team: 'video' }).prompt, /Writing style: Conversational/)
})

test('selected platform graphics use that platform copy instead of the first saved post', async () => {
  const { buildProductionPrompt } = await load('services/production-handoff.ts')
  const pack = fixture()
  pack.content.strategy.platforms.push({ platform: 'YouTube', headline: 'YouTube title', thumbnail: 'YouTube cover concept', cta: 'Subscribe' })
  const graphic = buildProductionPrompt(pack, { team: 'graphics', platform: 'YouTube' })
  assert.match(graphic.prompt, /YouTube title/)
  assert.match(graphic.prompt, /YouTube cover concept/)
  assert.match(graphic.prompt, /Platform: YouTube/)
  assert.doesNotMatch(graphic.prompt, /Saved headline|Minimal chart/)
  assert.doesNotMatch(buildProductionPrompt(pack, { team: 'graphics', platform: 'Facebook' }).prompt, /Saved headline|YouTube title/)
})

test('post and carousel exports contain graphics briefs rather than video or recording prompts', async () => {
  const { productionHandoffs, productionHandoffMarkdown } = await load('services/production-handoff.ts')
  const pack = fixture(); const original = JSON.stringify(pack)
  for (const format of ['post', 'carousel']) {
    const handoffs = productionHandoffs(pack, format)
    assert.equal(handoffs.format, format)
    assert.equal(handoffs.video, undefined)
    assert.equal(handoffs.audio, undefined)
    assert.match(handoffs.graphics.cover.prompt, /4:5/)
    assert.equal(handoffs.graphics.scenes.length, format === 'carousel' ? 2 : 0)
    assert.equal(handoffs.editor.narration, '')
    assert.doesNotMatch(handoffs.editor.prompt, /Exact narration:|Subtitles:|Music:|Target: 60 seconds/)
    assert.doesNotMatch(productionHandoffMarkdown(pack, format), /Complete video prompt|Voiceover & recording brief/)
  }
  assert.match(productionHandoffs(pack, 'carousel').editor.prompt, /carousel of still images/)
  const audio = productionHandoffs(pack, 'audio')
  assert.equal(audio.video, undefined)
  assert.equal(audio.graphics, undefined)
  assert.ok(audio.audio.prompt)
  assert.doesNotMatch(audio.editor.prompt, /Video direction:|Subtitles:|9:16|16:9/)
  assert.equal(JSON.stringify(pack), original, 'format views preserve every canonical field')
})

test('short-shot adapters do not pretend to generate the complete video and missing scripts never fall back to captions', async () => {
  const { buildProductionPrompt } = await load('services/production-handoff.ts')
  const pack = fixture()
  const runway = buildProductionPrompt(pack, { team: 'video', videoTool: 'runway', sceneIndex: 1 })
  assert.match(runway.prompt, /side-by-side/)
  assert.doesNotMatch(runway.prompt, /First supported|Second supported|Create a complete/)
  assert.match(runway.attachments[0], /Required.*input image/)
  assert.match(runway.steps.join(' '), /5 or 10 seconds/)
  const omni = buildProductionPrompt(pack, { team: 'video', videoTool: 'omni', sceneIndex: 500 })
  assert.match(omni.prompt, /side-by-side/)
  assert.match(omni.steps.join(' '), /3 and 15 seconds.*Split longer/)
  const noScript = { ...pack, content: { ...pack.content, script: undefined, scenes: undefined, captions: { reel: 'A caption is not narration' } } }
  for (const team of ['audio', 'video']) {
    const handoff = buildProductionPrompt(noScript, { team })
    assert.ok(handoff.missing)
    assert.equal(handoff.prompt, '')
    assert.equal(handoff.narration, '')
  }
  assert.ok(buildProductionPrompt(noScript, { team: 'graphics', graphic: 'slide' }).missing)
  assert.equal(buildProductionPrompt({ ...pack, content: null }, { team: 'graphics' }).prompt, '')
})

test('copy actions use the selected team, preserve saved content, report errors, and respect unsaved/validation locks', async () => {
  const helpers = await load('services/production-handoff.ts')
  const slots = []; let cursor = 0; let copied = ''; let failClipboard = false
  const element = (type, props) => ({ type, props })
  const { StudioProductionPrompts } = await load('pages/app/StudioProductionPrompts.tsx', {
    react: { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value }] } },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'lucide-react': { Clapperboard: 'svg', Mic: 'svg', Image: 'svg', Scissors: 'svg', Copy: 'svg', ExternalLink: 'svg' },
    '@/services/production-handoff': helpers,
  }, { navigator: { clipboard: { async writeText(value) { if (failClipboard) throw new Error('Denied'); copied = value } } } })
  const pack = fixture(); const original = JSON.stringify(pack)
  const render = (lockedReason = '', format = 'reel', options = {}) => { cursor = 0; return StudioProductionPrompts({ pack, lockedReason, format, ...options }) }
  const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && text(node) === label)
  let tree = render(); await button(tree, 'Copy prompt').props.onClick()
  await new Promise(resolve => setImmediate(resolve)); tree = render()
  assert.match(copied, /Create a complete/)
  assert.match(text(tree), /Prompt copied/)
  button(tree, 'Audio').props.onClick(); tree = render()
  assert.doesNotMatch(text(tree), /Prompt copied/, 'changing team clears an old success message')
  await button(tree, 'Copy narration').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(copied, 'First supported sentence. Second supported sentence.')
  tree = render('Save your edits first.')
  assert.equal(button(tree, 'Copy prompt').props.disabled, true)
  copied = ''; await button(tree, 'Copy prompt').props.onClick(); assert.equal(copied, '', 'disabled state is guarded in the handler too')
  failClipboard = true; tree = render(); await button(tree, 'Copy prompt').props.onClick(); await new Promise(resolve => setImmediate(resolve)); tree = render()
  assert.match(text(tree), /Could not copy automatically/)
  assert.equal(JSON.stringify(pack), original)
  for (const format of ['post', 'carousel', 'audio', 'article']) {
    slots.length = 0
    const scoped = render('', format)
    assert.equal(button(scoped, 'Video'), undefined)
    if (format !== 'audio') assert.equal(button(scoped, 'Audio'), undefined)
    const activeTeam = flatten(scoped).find(node => node.type === 'button' && node.props['aria-pressed'])
    assert.equal(text(activeTeam), format === 'audio' ? 'Audio' : format === 'article' ? 'Editor' : 'Graphics')
    if (format === 'audio') assert.equal(flatten(scoped).some(node => node.type === 'select' && node.props.name === 'aspectRatio'), false)
  }
  slots.length = 0
  let selectedScene
  tree = render('', 'carousel', { initialSceneIndex: 1, onSceneChange: value => { selectedScene = value } })
  const sceneSelect = flatten(tree).find(node => node.type === 'select' && node.props.name === 'sceneIndex')
  assert.equal(sceneSelect.props.value, 1, 'production starts on the editor-selected slide')
  assert.match(text(tree), /Second slide/)
  sceneSelect.props.onChange({ target: { value: '0' } })
  assert.equal(selectedScene, 0, 'production selection updates the shared editor/preview slide')
})
