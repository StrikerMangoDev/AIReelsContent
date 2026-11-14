import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)
const platforms = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']
async function harness({ revision = 5, failAccounts = false, failMedia = false, blobType = 'auto', blobSize = 100, defer = false } = {}) {
  const source = await readFile(new URL('../../src/pages/app/ConnectedPostPreview.tsx', import.meta.url), 'utf8')
  const slots = []; const effects = []; const pending = []; const calls = []; const revoked = []; const deferred = []
  let cursor = 0; let effectCursor = 0; let urls = 0; let owner = 'owner'; let workspace = 'personal'
  const assets = [
    { id: 'old-image', kind: 'image', mime: 'image/png', current: false, status: 'completed' },
    { id: 'pending-image', kind: 'image', mime: 'image/png', current: true, status: 'running' },
    { id: 'audio', kind: 'audio', mime: 'audio/mpeg', current: true, status: 'completed' },
    { id: 'unsupported-video', kind: 'video', mime: 'video/webm', current: true, status: 'completed' },
    { id: 'image', kind: 'image', mime: 'image/png', current: true, status: 'completed' },
    { id: 'video', kind: 'video', mime: 'video/mp4', current: true, status: 'completed' },
  ]
  const element = (type, props) => ({ type, props })
  const modules = {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
      useEffect(action, deps) { const index = effectCursor++; const prior = effects[index]; if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) { effects[index] = { deps, cleanup: prior?.cleanup }; pending.push(() => { effects[index].cleanup?.(); effects[index].cleanup = action() }) } },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'lucide-react': { RefreshCw: 'svg' },
    '@/components/ui/IconButton': { IconButton: 'IconButton' },
    '@/context/auth-state': { useAuth: () => ({ identity: owner ? { uid: owner } : null }) },
    '@/services/workspace-session': { activeWorkspace: () => workspace },
    './InstagramPreview': { InstagramPreview: 'Preview' },
    '@/services/studio-api': {
      async studioRead(path) {
        calls.push(path)
        const requestOwner = owner
        if (defer) await new Promise(resolve => deferred.push(resolve))
        if (path === '/publishing/config') { if (failAccounts) throw Error('unavailable'); return { enabled: false, accounts: platforms.flatMap(platform => [{ id: `${requestOwner}-${platform}`, name: `${requestOwner} ${platform}`, platform }, { id: `${requestOwner}-${platform}-two`, name: 'Second account', platform }]) } }
        if (failMedia) throw Error('unavailable')
        return { packageId: 'package', revision, platform: decodeURIComponent(path.split('platform=')[1]), assets }
      },
      async studioAssetBlob(id, signal) { calls.push(`file:${id}`); signal.throwIfAborted(); return { size: blobSize, type: blobType === 'auto' ? id === 'video' ? 'video/mp4' : 'image/png' : blobType } },
    },
  }
  const exports = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => { assert.ok(name in modules, name); return modules[name] }, AbortController, window: { setTimeout, clearTimeout }, URL: { createObjectURL: () => `blob:preview-${++urls}`, revokeObjectURL: url => revoked.push(url) } })
  let props = { packageId: 'package', revision: 5, content: { strategy: { platforms: platforms.map(platform => ({ platform })) } }, contentFormat: 'post', selectedSection: 'posts', selectedPlatform: 'Facebook' }
  const render = patch => { props = { ...props, ...patch }; cursor = 0; effectCursor = 0; return exports.ConnectedPostPreview(props) }
  const settle = async patch => { let tree; for (let i = 0; i < 5; i++) { tree = render(patch); pending.splice(0).forEach(run => run()); await new Promise(resolve => setImmediate(resolve)) } return tree }
  return { render, settle, calls, revoked, deferred, setOwner(value) { owner = value }, setWorkspace(value) { workspace = value }, field: (tree, name) => flatten(tree).find(node => node.props?.name === name), preview: tree => flatten(tree).find(node => node.type === 'Preview'), close() { effects.forEach(effect => effect.cleanup?.()) } }
}

test('connected preview reads scoped accounts and current compatible assets for all five platforms without writes', async () => {
  const h = await harness()
  for (const platform of platforms) {
    let tree = await h.settle({ selectedPlatform: platform })
    const preview = h.preview(tree)
    assert.equal(preview.props.account.id, `owner-${platform}`)
    assert.equal(preview.props.media.id, platform === 'YouTube' ? 'video' : 'image')
    assert.equal(flatten(h.field(tree, 'previewAccount')).filter(node => node.type === 'option').length, 3)
    assert.doesNotMatch(text(h.field(tree, 'previewMedia')), /old-image|pending-image|audio/)
    assert.equal(flatten(h.field(tree, 'previewMedia')).some(node => node.props?.value === 'unsupported-video'), false)
    if (platform === 'YouTube') assert.doesNotMatch(text(h.field(tree, 'previewMedia')), /Image/)
    h.field(tree, 'previewAccount').props.onChange({ target: { value: `owner-${platform}-two` } })
    tree = await h.settle(); assert.equal(h.preview(tree).props.account.id, `owner-${platform}-two`)
    h.field(tree, 'previewMedia').props.onChange({ target: { value: '' } })
    tree = await h.settle(); assert.equal(h.preview(tree).props.media, undefined)
  }
  assert.ok(h.calls.every(path => path === '/publishing/config' || path.includes('/social-preview?') || path.startsWith('file:')))
  assert.ok(h.revoked.length >= 5)
  h.close()
})

test('platform, owner, workspace and unsaved edits cannot display an earlier private preview', async () => {
  const h = await harness(); let tree = await h.settle()
  assert.ok(h.preview(tree).props.media)
  tree = h.render({ selectedPlatform: 'Instagram' }); assert.equal(h.preview(tree).props.account, undefined); assert.equal(h.preview(tree).props.media, undefined)
  tree = await h.settle(); assert.equal(h.preview(tree).props.account.platform, 'Instagram')
  tree = await h.settle({ dirty: true }); assert.equal(h.preview(tree).props.media, undefined); assert.equal(h.field(tree, 'previewMedia').props.disabled, true)
  tree = await h.settle({ dirty: false }); assert.ok(h.preview(tree).props.media)
  h.setWorkspace('another-workspace'); tree = h.render(); assert.equal(h.preview(tree).props.account, undefined); assert.equal(h.preview(tree).props.media, undefined)
  await h.settle(); h.setOwner('other-owner'); tree = h.render(); assert.equal(h.preview(tree).props.account, undefined)
  tree = await h.settle(); assert.equal(h.preview(tree).props.account.id, 'other-owner-Instagram')
  h.setOwner(null); tree = await h.settle(); assert.equal(h.preview(tree).props.account, undefined); assert.equal(h.preview(tree).props.media, undefined)
  assert.ok(h.revoked.length); h.close()
})

test('late requests cannot reveal the previous owner and inactive/article previews do not fetch connections', async () => {
  const h = await harness({ defer: true }); await h.settle(); h.setOwner('new-owner'); await h.settle()
  h.deferred.splice(0, 2).forEach(resolve => resolve()); let tree = await h.settle(); assert.equal(h.preview(tree).props.account, undefined)
  h.deferred.splice(0).forEach(resolve => resolve()); tree = await h.settle(); assert.equal(h.preview(tree).props.account.id, 'new-owner-Facebook')
  h.close()
  for (const patch of [{ active: false }, { selectedSection: 'website', contentFormat: 'article' }]) {
    const idle = await harness(); await idle.settle(patch); assert.equal(idle.calls.length, 0); idle.close()
  }
})

test('version mismatch, failed endpoints, invalid media and decoding errors stay explicit', async () => {
  for (const options of [{ revision: 4 }, { failAccounts: true }, { failMedia: true }, { blobType: 'text/html' }, { blobSize: 0 }]) {
    const h = await harness(options); const tree = await h.settle()
    assert.match(text(tree), /could not|version changed/)
    if (!options.failAccounts) assert.equal(h.preview(tree).props.media, undefined)
    else { assert.equal(h.preview(tree).props.account, undefined); assert.ok(h.preview(tree).props.media) }
    h.close()
  }
  const h = await harness(); let tree = await h.settle()
  h.preview(tree).props.onMediaError(); tree = await h.settle()
  assert.equal(h.preview(tree).props.media, undefined); assert.match(text(tree), /could not be displayed/)
  h.close()
})
