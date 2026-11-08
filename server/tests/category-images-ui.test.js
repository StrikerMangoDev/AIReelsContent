import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('library binds saved images and visible credits, keeps failures usable and ignores responses after unmount', async () => {
  const source = await readFile(new URL('../../src/pages/app/IdeaLibrary.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  let state = {}; let effect; let cleanup; let deferred
  const calls = []; const element = (type, props) => ({ type, props })
  const image = { url: `/api/studio/category-images/assets/${'a'.repeat(64)}`, title: 'Zodiac artwork', author: 'Artist', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Zodiac.jpg', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }
  const modules = {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    react: { useState: () => [state, update => { state = update(state) }], useEffect(fn) { effect = fn } },
    'react-router-dom': { Link: 'Link' }, 'lucide-react': {},
    '@/services/studio-api': { studioRead: async path => { calls.push(path); if (path.includes('slow')) return new Promise(resolve => { deferred = resolve }); if (path.includes('missing')) throw new Error('Image unavailable'); if (path.includes('pending') && calls.filter(value => value === path).length === 1) return { status: 'pending', image: null }; return { status: 'ready', image } } },
  }
  const exports = {}
  runInNewContext(code, { exports, require: name => modules[name], setTimeout: callback => setImmediate(callback) })
  const props = { categories: [{ id: 'astrology', name: 'Astrology' }, { id: 'missing', name: 'Comedy' }, { id: 'pending', name: 'Vastu' }], collections: [], search: '', setSearch() {}, personal: true, loading: false, jobs: {} }
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  exports.IdeaLibrary({ ...props, loading: true }); assert.equal(effect(), undefined); assert.equal(calls.length, 0)
  exports.IdeaLibrary(props); cleanup = effect()
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
  const tree = exports.IdeaLibrary(props)
  const cover = flatten(tree).find(node => node.type === exports.CategoryCover && node.props.name === 'Astrology')
  assert.equal(exports.CategoryCover(cover.props).props.src, image.url)
  assert.ok(flatten(tree).some(node => node.type === 'a' && node.props.href === image.licenseUrl))
  assert.ok(flatten(tree).some(node => node.type === 'a' && node.props.href === image.sourceUrl))
  assert.equal(flatten(tree).filter(node => node.type === 'Link' && node.props.to.startsWith('/ideas/')).length, 3)
  assert.equal(calls.filter(path => path.includes('/pending/')).length, 2, 'a concurrent lookup is read again rather than leaving the fallback until reload')
  assert.equal(state.pending.url, image.url)
  let cleared = null
  const empty = exports.IdeaLibrary({ ...props, search: 'no-match', setSearch: value => { cleared = value } })
  const clear = flatten(empty).find(node => node.type === 'button' && node.props.children === 'Clear search')
  assert.ok(clear, 'an unmatched category search has a direct recovery action')
  clear.props.onClick(); assert.equal(cleared, '')
  assert.equal(flatten(empty).filter(node => node.type === 'Link' && node.props.to.startsWith('/ideas/')).length, 0)
  const fallback = exports.CategoryCover({ name: 'Astrology', image }).props
  let src = image.url
  fallback.onError({ currentTarget: { getAttribute: () => src, set src(value) { src = value } } })
  assert.equal(src, '/category-covers/astrology.svg')
  cleanup(); state = {}
  exports.IdeaLibrary({ ...props, categories: [{ id: 'slow', name: 'AI' }] }); cleanup = effect()
  await new Promise(resolve => setImmediate(resolve)); cleanup(); deferred({ status: 'ready', image })
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(state, {})
})
