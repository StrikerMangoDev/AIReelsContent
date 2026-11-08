import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
const button = (tree, label) => flatten(tree).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))
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
  }
  const exports = {}
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name] } })
  return (content, props = {}) => { cursor = 0; return exports.InstagramPreview({ content, title: 'Test topic', ...props }) }
}
test('preview does not invent assets or reuse another platform caption', async () => {
  const render = await harness()
  const tree = render({ claims: [], strategy: { platforms: [{ platform: 'LinkedIn', body: 'Not Instagram copy' }] } })
  assert.match(text(tree), /No image added yet/)
  assert.match(text(tree), /No Instagram caption/)
  assert.doesNotMatch(text(tree), /Not Instagram copy/)
  assert.equal(button(tree, 'Carousel').props.disabled, true)
  assert.equal(flatten(tree).some(node => node.type === 'img'), false)
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
