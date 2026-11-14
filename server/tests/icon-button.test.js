import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('icon actions preserve accessible names, callbacks, disabled state and dismissible tooltips', async () => {
  const source = await readFile(new URL('../../src/components/ui/IconButton.tsx', import.meta.url), 'utf8')
  const exports = {}
  const element = (type, props) => ({ type, props })
  const modules = { './Button': { Button: 'button' }, '@/styles/icon-button.css': {}, 'react/jsx-runtime': { jsx: element, jsxs: element } }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => modules[name] })
  let copied = 0
  const action = exports.IconButton({ icon: 'svg', label: 'Copy Post body', tooltip: 'Copy', disabled: true, onClick: () => copied++ })
  assert.equal(action.props['aria-label'], 'Copy Post body')
  assert.equal(action.props.type, 'button')
  assert.equal(action.props.disabled, true)
  assert.equal(action.props.children[0].props['aria-hidden'], 'true')
  assert.equal(action.props.children[0].props.size, 20)
  assert.equal(action.props.children[1].props.children, 'Copy')
  action.props.onClick(); assert.equal(copied, 1, 'existing action callback is passed through')
  const event = { key: 'Escape', currentTarget: { dataset: {} } }
  action.props.onKeyDown(event); assert.equal(event.currentTarget.dataset.tooltipDismissed, 'true')
  action.props.onFocus(event); assert.equal(event.currentTarget.dataset.tooltipDismissed, undefined)
  action.props.onKeyDown(event); action.props.onBlur(event); assert.equal(event.currentTarget.dataset.tooltipDismissed, undefined)
  action.props.onKeyDown(event); action.props.onPointerEnter(event); assert.equal(event.currentTarget.dataset.tooltipDismissed, undefined)
})
