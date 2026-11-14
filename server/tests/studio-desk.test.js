import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function load(file, modules = {}) {
  const source = await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8')
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] } })
  return exports
}
const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : ''

test('setup preview distinguishes saved, absent and changed selections across five platforms', async () => {
  const desk = await load('services/studio-package.ts')
  const caption = await import('../../shared/social-caption.js')
  let values = []; let cursor = 0
  const element = (type, props) => ({ type, props })
  const { StudioSetupPreview } = await load('pages/app/StudioSetupPreview.tsx', {
    react: { useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], value => { values[index] = value }] } },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    '@/services/studio-package': desk,
    '../../../shared/social-caption.js': caption,
    './ConnectedPostPreview': { ConnectedPostPreview: 'InstagramPreview' },
  })
  const names = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']
  const content = { claims: [], strategy: { platforms: names.map(platform => ({ platform, headline: `${platform} headline`, body: `${platform} saved body`, hook: '', cta: '', hashtags: [] })) } }
  const base = { content, title: 'Topic', evidence: [], settingsChanged: false, profile: { platform: names.join(', '), outputs: ['captions', 'platforms'] } }
  const render = props => { cursor = 0; return StudioSetupPreview({ ...base, ...props }) }
  for (const platform of names) {
    values = ['text', platform]
    const tree = render({})
    assert.ok(text(tree).includes(`${platform} saved body`))
    assert.equal(text(tree).includes('No content or media has been generated'), false)
  }
  values = []
  assert.ok(text(render({ content: null })).includes('No content or media has been generated yet.'))
  assert.ok(text(render({ settingsChanged: true })).includes('New settings apply after generation.'))
  const absent = render({ profile: { platform: 'Instagram', outputs: ['script', 'captions', 'platforms', 'production'] } })
  assert.ok(text(absent).includes('This format or platform has no saved content yet.'))
  assert.equal(flatten(absent).some(node => node.type === 'InstagramPreview'), false)
  const custom = render({ content: { claims: [], script: 'Saved narration' }, profile: { platform: 'Instagram', outputs: ['script'] } })
  assert.equal(flatten(custom).find(node => node.type === 'InstagramPreview').props.contentFormat, 'audio', 'custom script selection previews the recording rather than unrelated post text')
  const noFacebook = { ...content, captions: { reel: 'Instagram caption' }, strategy: { platforms: [content.strategy.platforms[1]] } }
  assert.equal(flatten(render({ content: noFacebook, profile: { ...base.profile, platform: 'Facebook' } })).some(node => node.type === 'InstagramPreview'), false, 'never use Instagram copy as a missing Facebook post')
})

test('starting packs preserve production dependencies and metadata; suggestions are multiple editorial options', async () => {
  const desk = await load('services/studio-package.ts')
  for (const pack of desk.contentPacks) {
    assert.equal(new Set(pack.outputs).size, pack.outputs.length)
    assert.ok(!pack.outputs.includes('production') || pack.outputs.includes('script'))
    assert.ok(pack.outputs.includes('platforms') || pack.outputs.includes('production'), 'each pack requests strategy/keywords as well as core copy')
  }
  assert.deepEqual(Array.from(desk.suggestContentPacks('How to use AI in five steps').ids), ['carousel', 'reel'])
  assert.deepEqual(Array.from(desk.suggestContentPacks('Research reports on astrology').ids), ['article', 'carousel'])
  assert.equal(desk.sameOutputs(['script', 'captions'], ['captions', 'script']), true)
  assert.equal(desk.sameOutputs(['script'], ['script', 'production']), false)
  assert.equal(desk.scriptReadingEstimate('One two [C1] three').words, 3)
  assert.equal(desk.scriptReadingEstimate('').seconds, 0)
  assert.equal(desk.initialContentSection({ claims: [], script: 'Spoken words' }), 'script', 'script-only packages start with their recording preview')
  assert.equal(desk.initialContentSection({ claims: [], website: { title: 'Title', body: 'Article' } }), 'website')
  assert.equal(desk.packageDeliverables({ claims: [], script: 'Saved narration' }).find(item => item.id === 'slides').ready, false, 'never label absent scene content ready')
})

test('pack selection only changes local settings, keeps the brief, and respects disabled state', async () => {
  const desk = await load('services/studio-package.ts')
  const element = (type, props) => ({ type, props })
  const setup = await load('pages/app/StudioPackageSetup.tsx', {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'lucide-react': { Clapperboard: 'svg', FileText: 'svg', Images: 'svg', Mic: 'svg', MessageSquare: 'svg', MonitorPlay: 'svg', Check: 'svg' },
    '@/services/studio-package': desk,
  })
  const profile = { industry: 'Astrology', audience: 'Beginners', language: 'Hindi', tone: 'Conversational', duration: 90, platform: 'Instagram', voice: 'Male', outputs: ['captions', 'platforms'] }
  let changed
  const render = disabled => setup.StudioPackageSetup({ profile, subject: 'Astrology explained', disabled, onChange: value => { changed = value } })
  const tree = render(false)
  const reel = flatten(tree).find(node => node.type === 'input' && node.props.type === 'radio' && node.props.value === 'reel')
  reel.props.onChange()
  assert.deepEqual(Array.from(changed.outputs), ['script', 'captions', 'platforms', 'production'])
  for (const key of ['industry', 'audience', 'language', 'tone', 'duration', 'platform', 'voice']) assert.equal(changed[key], profile[key], key)
  assert.equal(profile.outputs.length, 2, 'original profile never mutated')
  const choices = flatten(tree).filter(node => node.type === 'input' && node.props.type === 'radio')
  assert.equal(choices.length, 5)
  assert.match(text(setup.StudioPackageSetup({ profile: { ...profile, outputs: ['script', 'website'] }, subject: 'Research', disabled: false, onChange() {} })), /Custom selection/)
  for (const choice of choices) {
    choice.props.onChange()
    assert.deepEqual(Array.from(changed.outputs), Array.from(desk.contentPacks.find(pack => pack.id === choice.props.value).outputs))
    assert.equal(changed.audience, profile.audience)
  }
  const destinations = flatten(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(destinations.length, 5)
  for (const [index, platform] of ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube'].entries()) {
    destinations[index].props.onChange({ target: { checked: true } })
    assert.ok(changed.platform.split(', ').includes(platform))
    assert.ok(changed.platform.includes('Instagram'))
  }
  assert.equal(flatten(tree).some(node => node.type === 'button'), false, 'formats and platforms are inputs, not competing actions')
  assert.equal(flatten(render(true)).filter(node => node.type === 'fieldset').every(node => node.props.disabled), true)
  assert.match(text(tree), /Long video is not available/)
  assert.match(text(tree), /not measured performance or expert approval/)
  assert.equal(flatten(tree).some(node => node.type === 'button' && text(node).includes('Long video')), false, 'unsupported long-form generation cannot be dispatched')
})

test('working format follows saved outputs and exposes only usable saved formats', async () => {
  const desk = await load('services/studio-package.ts')
  const content = { claims: [], script: 'Saved speech', scenes: [{ onScreen: 'One slide' }], captions: { reel: 'Caption' }, strategy: { platforms: [{}] } }
  assert.equal(desk.initialContentFormat(content, ['script', 'captions', 'production']), 'carousel')
  assert.equal(desk.initialContentFormat(content, ['script', 'captions', 'platforms', 'production']), 'reel')
  assert.equal(desk.formatContentSection(content, 'reel'), 'script')
  assert.equal(desk.formatContentSection(content, 'carousel'), 'slides')
  assert.equal(desk.formatContentSection(content, 'post'), 'posts')
  assert.deepEqual(Array.from(desk.savedContentFormats({ claims: [], captions: {} })), ['post'])
  assert.equal(desk.formatContentSection({ claims: [], website: { body: 'Article' }, strategy: { platforms: [{}] } }, 'article'), 'website')
})
