import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))

test('native layouts show only the matching connected account and selected generated media', async () => {
  const render = await harness()
  for (const platform of ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']) {
    const content = { claims: [], strategy: { platforms: [{ platform, body: 'Exact posting copy', headline: 'Saved title', hook: '', cta: '', hashtags: [] }] } }
    const props = { selectedSection: 'posts', selectedPlatform: platform, account: { id: 'connected-account', name: 'Real channel', platform }, media: { id: 'generated-asset', kind: platform === 'YouTube' ? 'video' : 'image', url: 'blob:authenticated-asset' }, onMediaError() {} }
    let tree = render(content, props)
    assert.match(text(tree), /Real channel/)
    assert.doesNotMatch(text(tree), /Account not selected|not selected for preview|your.account/)
    const visual = flatten(tree).find(node => node.type === (platform === 'YouTube' ? 'video' : 'img'))
    assert.equal(visual.props.src, props.media.url)
    assert.equal(visual.props.onError, props.onMediaError)
    if (platform === 'YouTube') assert.equal(visual.props.controls, true)
    tree = render(content, { ...props, account: { ...props.account, platform: 'Wrong platform' } })
    assert.doesNotMatch(text(tree), /Real channel/)
    assert.match(text(tree), /Account not selected/)
    if (platform === 'YouTube') {
      tree = render(content, { ...props, media: { ...props.media, kind: 'image' } })
      assert.equal(flatten(tree).some(node => node.type === 'img' || node.type === 'video'), false)
    }
  }
})
async function harness() {
  const source = await readFile(new URL('../../src/pages/app/InstagramPreview.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const slots = []; let cursor = 0
  const element = (type, props) => ({ type, props })
  const modules = {
    react: { useId: () => 'caption', useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value }] } },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'lucide-react': { ChevronLeft: 'svg', ChevronRight: 'svg', ImageIcon: 'svg', Camera: 'svg', Heart: 'svg', MessageCircle: 'svg', Send: 'svg', Bookmark: 'svg' },
    './ContentPreview': { cleanCopy: value => value.replace(/\s*\[C\d+\]/g, '').trim() },
    '../../styles/instagram-preview.css': {},
    '../../../shared/social-caption.js': await import('../../shared/social-caption.js'),
  }
  const exports = {}
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] } })
  return (content, props = {}) => { cursor = 0; return exports.InstagramPreview({ content, title: 'Test topic', ...props }) }
}

test('platform post layouts keep exact publishing copy and never invent media, engagement or account details', async () => {
  const render = await harness()
  const { renderSocialCaption } = await import('../../shared/social-caption.js')
  const evidence = [{ id: 'E1', url: 'https://example.com/research' }]
  const content = { claims: [{ id: 'C1', evidenceId: 'E1' }], strategy: { platforms: ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube'].map(platform => ({ platform, headline: 'Saved video title [C1]', hook: 'Unpublished hook', body: 'Source-backed wording [C1]. '.repeat(12), cta: 'Unpublished CTA', hashtags: ['#notAutomaticallyAdded'] })) } }
  for (const platform of ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']) {
    const tree = render(content, { selectedSection: 'posts', selectedPlatform: platform, evidence })
    const nodes = flatten(tree)
    assert.equal(nodes.find(node => node.type === 'article').props['data-platform'], platform)
    assert.equal(text(nodes.find(node => node.props?.className === 'editor-exact-post')), renderSocialCaption({ content, evidence }, platform))
    assert.doesNotMatch(text(tree), /Unpublished hook|Unpublished CTA|#notAutomaticallyAdded|\[C1\]|followers|views|likes/i)
    assert.match(text(tree), /Account not selected/)
    assert.ok(nodes.some(node => node.props?.className === 'platform-post-actions' && node.props['aria-hidden'] === 'true'), 'decorative social actions do not masquerade as working controls')
    if (platform === 'Instagram' || platform === 'YouTube') assert.ok(nodes.some(node => node.props?.className === 'platform-post-media'))
    else assert.equal(nodes.some(node => node.props?.className === 'platform-post-media'), false, 'text-capable platforms do not invent an attached image')
    if (platform === 'YouTube') assert.match(text(tree), /Saved video title/)
    else assert.doesNotMatch(text(tree), /Saved video title/, 'optional headlines are not secretly added to the published post')
  }
  let tree = render(content, { selectedSection: 'posts', selectedPlatform: 'Instagram', evidence })
  button(tree, 'Read full post').props.onClick()
  tree = render(content, { selectedSection: 'posts', selectedPlatform: 'Instagram', evidence })
  assert.equal(flatten(tree).find(node => node.props?.className === 'editor-exact-post').props['data-expanded'], true)
  content.strategy.platforms[1].body = 'Unsaved updated wording [C1]'
  tree = render(content, { selectedSection: 'posts', selectedPlatform: 'Instagram', evidence })
  assert.match(text(tree), /Unsaved updated wording/)
})

test('one working format owns preview type; reel scenes never use a carousel switch', async () => {
  const render = await harness()
  const content = { claims: [], script: 'Read aloud [C1]', captions: { reel: 'Caption' }, scenes: [{ timing: '0–10s', onScreen: 'Scene words', narration: 'Read aloud [C1]', visualPrompt: 'Editorial illustration' }] }
  const reel = render(content, { contentFormat: 'reel', selectedSection: 'script' })
  assert.match(text(reel), /Video storyboard/)
  assert.match(text(reel), /Scene 1.*planned shot/)
  assert.match(text(reel), /0–10s/)
  assert.equal(button(reel, 'Post'), undefined)
  assert.equal(button(reel, 'Carousel'), undefined)
  const carousel = render(content, { contentFormat: 'carousel', selectedSection: 'slides' })
  assert.match(text(carousel), /Carousel preview/)
  assert.doesNotMatch(text(carousel), /Video storyboard|Read aloud/)
  const post = render(content, { contentFormat: 'post', previewMode: 'carousel' })
  assert.match(text(post), /Post layout/)
  assert.doesNotMatch(text(post), /Carousel storyboard|Scene words/)
  const scriptOnly = render({ claims: [], script: 'Saved spoken words' }, { contentFormat: 'reel', selectedSection: 'script' })
  assert.match(text(scriptOnly), /Video script.*Saved spoken words/)
  assert.doesNotMatch(text(scriptOnly), /Video storyboard/)
})
test('preview does not invent assets or reuse another platform caption', async () => {
  const render = await harness()
  const tree = render({ claims: [], strategy: { platforms: [{ platform: 'LinkedIn', body: 'Not Instagram copy' }] } })
  assert.match(text(tree), /No image added yet/)
  assert.match(text(tree), /No Instagram caption/)
  assert.doesNotMatch(text(tree), /Not Instagram copy/)
  assert.equal(button(tree, 'Carousel').props.disabled, true)
  assert.equal(flatten(tree).some(node => node.type === 'img'), false)
})

test('selected platform and recording section show their own content without citation markers', async () => {
  const render = await harness()
  const content = { claims: [], script: 'Read this aloud [C1]', strategy: { platforms: [
    { platform: 'Instagram', headline: 'Instagram title', hook: 'Instagram hook', body: 'Instagram body [C1]', cta: 'Read', hashtags: [] },
    { platform: 'LinkedIn', headline: 'LinkedIn title', hook: 'LinkedIn hook', body: 'LinkedIn body [C1]', cta: 'Discuss', hashtags: [] },
  ] } }
  const linkedIn = render(content, { selectedPlatform: 'LinkedIn', selectedSection: 'posts' })
  assert.match(text(linkedIn), /LinkedIn publishing preview.*LinkedIn body/)
  assert.doesNotMatch(text(linkedIn), /Instagram body|\[C1\]/)
  const script = render(content, { selectedPlatform: 'LinkedIn', selectedSection: 'script' })
  assert.match(text(script), /Recording preview/)
  assert.match(text(script), /Read this aloud/)
  assert.doesNotMatch(text(script), /LinkedIn body|\[C1\]/)
})
test('carousel navigation reflects scene text, bounds and shrunk scene plans', async () => {
  const render = await harness()
  const content = { claims: [], scenes: [{ onScreen: 'First', visualPrompt: 'First direction' }, { onScreen: 'Second', visualPrompt: 'Second direction' }] }
  let tree = render(content); button(tree, 'Carousel').props.onClick(); tree = render(content)
  assert.equal(button(tree, 'Previous slide').props.disabled, true)
  button(tree, 'Next slide').props.onClick(); tree = render(content)
  assert.match(text(tree), /Second direction/)
  assert.equal(button(tree, 'Next slide').props.disabled, true)
  tree = render({ ...content, scenes: content.scenes.slice(0, 1) })
  assert.match(text(tree), /First direction/)
  assert.equal(button(tree, 'Next slide'), undefined)
  button(tree, 'Post').props.onClick(); tree = render(content)
  assert.match(text(tree), /No image added yet/)
})
test('Instagram caption wins over reel fallback and full text can be expanded', async () => {
  const render = await harness()
  const content = { claims: [], captions: { reel: 'Fallback' }, strategy: { platforms: [{ platform: 'Instagram', headline: 'Title', hook: 'Hook', body: 'Caption '.repeat(40), cta: 'Read more', hashtags: ['#test'] }] } }
  let tree = render(content)
  assert.doesNotMatch(text(tree), /Fallback/)
  assert.match(text(tree), /Read more#test|Read more\s+#test/)
  assert.equal(button(tree, 'Read full caption').props['aria-expanded'], false)
  button(tree, 'Read full caption').props.onClick(); tree = render(content)
  assert.equal(button(tree, 'Show less').props['aria-expanded'], true)
})


test('controlled carousel stays synchronized with the editor selection', async () => {
  const render = await harness()
  const content = { claims: [], scenes: [{ onScreen: 'First', visualPrompt: 'First direction' }, { onScreen: 'Second', visualPrompt: 'Second direction' }] }
  let selected = 0
  const props = { previewMode: 'carousel', activeSlide: 0, onSlideSelect: index => { selected = index } }
  let tree = render(content, props)
  button(tree, 'Next slide').props.onClick()
  assert.equal(selected, 1)
  tree = render(content, { ...props, activeSlide: selected })
  assert.match(text(tree), /Second direction/)
  assert.equal(button(tree, 'Next slide').props.disabled, true)
  button(tree, 'Previous slide').props.onClick()
  assert.equal(selected, 0)
})

test('post preview does not duplicate an opening already included in the body', async () => {
  const render = await harness()
  const tree = render({ claims: [], strategy: { platforms: [{ platform: 'Instagram', headline: 'Title', hook: 'An attributed opening. [C1]', body: 'An attributed opening. [C1] More details. [C2]', cta: 'Learn more', hashtags: [] }] } })
  const caption = flatten(tree).find(node => node.props?.id === 'caption')
  assert.equal(text(caption).split('An attributed opening.').length - 1, 1)
  assert.match(text(caption), /More details/)
})
