import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
function component(file) {
  const module = { exports: {} }
  const source = readFileSync(new URL(`../../src/pages/app/${file}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', compiled)(id => id.endsWith('.css') ? {} : id === './ContentPreview' ? component('ContentPreview') : require(id), module, module.exports)
  return module.exports
}

test('reader previews use the selected caption or article and hide citation markers', () => {
  const { InstagramPreview } = component('InstagramPreview')
  const content = { claims: [], website: { title: 'Article [C1]', body: 'Article body [C1]' }, captions: { reel: 'Selected reel caption [C1]', linkedin: 'Selected LinkedIn caption [C1]' }, strategy: { platforms: [{ platform: 'Instagram', headline: 'Post headline [C1]', hook: 'Post hook [C1]', body: 'Separate post body [C1]', cta: 'Read more', hashtags: [] }] } }
  const render = selectedSection => renderToStaticMarkup(React.createElement(InstagramPreview, { content, selectedSection }))
  assert.match(render('posts'), /Separate post body/)
  assert.match(render('captions'), /Selected reel caption/)
  assert.doesNotMatch(render('captions'), /Separate post body|\[C1\]/)
  assert.match(render('captions-linkedin'), /LinkedIn caption preview.*Selected LinkedIn caption/)
  assert.doesNotMatch(render('captions-linkedin'), /Instagram preview|\[C1\]/)
  assert.match(render('website'), /Article preview.*Article body/)
  assert.doesNotMatch(render('website'), /Instagram preview|\[C1\]/)
  const articleOnly = renderToStaticMarkup(React.createElement(InstagramPreview, { content: { claims: [], website: content.website } }))
  assert.match(articleOnly, /Article preview.*Article body/)
})
