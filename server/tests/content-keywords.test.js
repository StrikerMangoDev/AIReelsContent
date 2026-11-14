import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { renderSocialCaption } from '../publishing/constraints.js'
import { renderSocialCaption as sharedCaption } from '../../shared/social-caption.js'

async function usageFunction(name = 'keywordUsage') {
  const source = await readFile(new URL('../../src/services/content-keywords.ts', import.meta.url), 'utf8')
  const exports = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports })
  return exports[name]
}

test('keyword section reports scoped matches, missing phrases and exact hashtag copy without changing content', async () => {
  const source = await readFile(new URL('../../src/pages/app/StudioKeywordUsage.tsx', import.meta.url), 'utf8')
  const exports = {}; let scope; let copied = ''
  const element = (type, props) => ({ type, props })
  const modules = {
    react: { useState: initial => [scope ?? initial, value => { scope = value }] },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'lucide-react': { Copy: 'svg', CheckCircle2: 'svg', CircleDashed: 'svg' },
    '@/components/ui/IconButton': { IconButton: 'button' },
    '@/services/content-keywords': { keywordUsage: await usageFunction(), hashtagText: await usageFunction('hashtagText') },
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => modules[name] })
  const content = { claims: [], strategy: { keywords: ['AI', 'science', 'missing'], platforms: [{ platform: 'Facebook', body: 'AI explains science', hashtags: ['AI', '#Science'] }, { platform: 'X', body: 'AI update', hashtags: ['Updates'] }] } }
  const before = structuredClone(content)
  const render = value => exports.StudioKeywordUsage({ content: value || content, platform: 'Facebook', onCopy: value => { copied = value } })
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : ''
  let tree = render()
  assert.match(text(tree), /2 of 3 found in draft/)
  assert.match(text(tree), /Facebook post text/)
  assert.match(text(tree), /Not foundAdd naturally/)
  assert.equal(flatten(tree).find(node => node.type === 'details').props.open, undefined, 'detailed guidance starts collapsed')
  flatten(tree).find(node => node.type === 'button' && node.props.label === 'Copy Facebook hashtags').props.onClick()
  assert.equal(copied, '#AI #Science')
  flatten(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'X' } }); tree = render()
  assert.match(text(tree), /1 of 3 found in draft/)
  assert.doesNotMatch(text(tree), /Facebook post text/)
  assert.ok(flatten(tree).some(node => node.props?.label === 'Copy X hashtags'))
  assert.deepEqual(content, before)
  tree = render({ claims: [] })
  assert.equal(flatten(tree).find(node => node.type === 'select').props.value, 'all', 'a removed platform cannot leave the filter blank')
  assert.match(text(tree), /No keywords saved/)
  assert.match(text(tree), /No hashtags were generated/)
})

test('keyword locations inspect actual wording, exclude the list and notes, and respect phrase boundaries', async () => {
  const keywordUsage = await usageFunction()
  const content = { claims: [], script: 'AI improves scientific\nmodels [C1]', website: { title: 'Scientific models', body: 'A chair is useful.' }, strategy: { keywords: ['AI', 'scientific models', 'unmentioned', 'C++'], platforms: [{ platform: 'Instagram', body: 'A guide to C++', headline: 'Design headline', hook: 'Opening', cta: 'Read source', thumbnail: 'unmentioned' }] } }
  const before = structuredClone(content)
  const usage = keywordUsage(content)
  assert.deepEqual(Array.from(usage[0].locations), ['Narration'])
  assert.deepEqual(Array.from(usage[1].locations), ['Narration', 'Article title'])
  assert.equal(usage[2].locations.length, 0, 'keyword metadata or design notes are not published wording')
  assert.deepEqual(Array.from(usage[3].locations), ['Instagram post text'])
  assert.deepEqual(content, before)
  content.strategy.platforms[0].body = 'AI and scientific models'
  assert.ok(keywordUsage(content)[0].locations.includes('Instagram post text'), 'unsaved edits update the usage report')
  assert.equal(keywordUsage({ claims: [] }).length, 0)
  assert.equal(keywordUsage(content, 'X')[0].locations.some(location => location.startsWith('Instagram')), false)
})

test('shared preview caption equals server publishing text on all five platforms without appending optional copy', () => {
  for (const platform of ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']) {
    const pack = { content: { claims: [{ id: 'C1', evidenceId: 'E1' }], captions: { reel: 'Alternative', linkedin: 'Other alternative' }, strategy: { platforms: [{ platform, headline: 'Design headline', hook: 'Optional opening', body: 'Attributed saved body [C1]', cta: 'Optional CTA', hashtags: ['#optional'] }] } }, evidence: [{ id: 'E1', url: 'https://example.com/research' }] }
    assert.equal(sharedCaption(pack, platform), renderSocialCaption(pack, platform))
    assert.equal(sharedCaption(pack, platform), 'Attributed saved body\n\nSource: https://example.com/research')
    assert.doesNotMatch(sharedCaption(pack, platform), /Optional|#optional|headline|Alternative|\[C1\]/)
  }
})

test('suggested hashtag copy includes hash prefixes without changing saved values', async () => {
  const hashtagText = await usageFunction('hashtagText')
  const tags = ['AI', '#Research', ' Science ', '']
  assert.equal(hashtagText(tags), '#AI #Research #Science')
  assert.deepEqual(tags, ['AI', '#Research', ' Science ', ''])
})
