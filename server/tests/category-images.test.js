import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { createRepository } from '../storage/repository.js'
import { categoryImageQuery, commonsImageUrl, imageCandidates, searchCategoryImage, ensureCategoryImage, categoryImageAssets } from '../studio/category-images.js'
import { intelligenceRouter } from '../studio/intelligence.js'

const bytes = Buffer.from([255, 216, 255, 224, 0, 1])
const selected = { bytes, mime: 'image/jpeg', title: 'Artificial intelligence robot.jpg', author: 'Example Artist', attribution: '', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Artificial_intelligence_robot.jpg', originalUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Robot.jpg' }
const page = (patch = {}) => ({ title: 'File:Artificial intelligence robot.jpg', imageinfo: [{ width: 1000, height: 600, mime: 'image/jpeg', thumburl: selected.originalUrl, descriptionurl: selected.sourceUrl, extmetadata: { Artist: { value: '<a href="https://example.com">Example Artist</a>' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: selected.licenseUrl }, Restrictions: { value: '' } }, ...patch }] })
const result = value => ({ query: { pages: { 1: value } } })

test('image selection requires matching topic, exact reusable license, creator and Wikimedia source', () => {
  assert.equal(categoryImageQuery('AI'), 'artificial intelligence')
  assert.equal(categoryImageQuery('Astrology'), 'astrology vintage')
  assert.equal(categoryImageQuery('News'), 'journalism newsroom')
  const unrelatedNews = page(); unrelatedNews.title = 'File:Zeekr007.jpg'; unrelatedNews.imageinfo[0].extmetadata.ImageDescription = { value: 'Car photograph published in the news.' }
  assert.equal(imageCandidates(result(unrelatedNews), categoryImageQuery('News')).length, 0, 'a news mention cannot make an unrelated car a category cover')
  assert.equal(categoryImageQuery('Vastu OR dogs /?'), 'vastu or dogs')
  const candidates = imageCandidates(result(page()), 'artificial intelligence')
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].author, 'Example Artist')
  for (const url of ['http://upload.wikimedia.org/wikipedia/commons/a.jpg', 'https://upload.wikimedia.org.evil.test/wikipedia/commons/a.jpg', 'https://127.0.0.1/a.jpg', 'https://upload.wikimedia.org:444/wikipedia/commons/a.jpg', 'https://user@upload.wikimedia.org/wikipedia/commons/a.jpg']) assert.equal(commonsImageUrl(url), null)
  for (const license of ['CC BY-NC 4.0', 'CC BY-ND 4.0', 'All rights reserved', 'GPL']) {
    const value = page(); value.imageinfo[0].extmetadata.LicenseShortName.value = license
    assert.equal(imageCandidates(result(value), 'artificial intelligence').length, 0)
  }
  const restricted = page(); restricted.imageinfo[0].extmetadata.Restrictions.value = 'personality rights'
  assert.equal(imageCandidates(result(restricted), 'artificial intelligence').length, 0)
  const missing = page(); delete missing.imageinfo[0].extmetadata.Artist
  assert.equal(imageCandidates(result(missing), 'artificial intelligence').length, 0)
  assert.equal(imageCandidates(result(page()), 'astrology').length, 0)
  const storefront = page(); storefront.title = 'File:Artificial intelligence shop.jpg'
  assert.equal(imageCandidates(result(storefront), 'artificial intelligence').length, 0)
  assert.equal(imageCandidates(result(page({ mime: 'image/svg+xml' })), 'artificial intelligence').length, 0)
  const spoof = page(); spoof.imageinfo[0].extmetadata.LicenseUrl.value = 'https://creativecommons.org.evil.test/licenses/by/4.0/'
  assert.equal(imageCandidates(result(spoof), 'artificial intelligence').length, 0)
  const cc0 = page(); cc0.imageinfo[0].extmetadata.LicenseShortName.value = 'CC0'; cc0.imageinfo[0].extmetadata.LicenseUrl.value = 'http://creativecommons.org/publicdomain/zero/1.0/deed.en'
  assert.equal(imageCandidates(result(cc0), 'artificial intelligence')[0].license, 'CC0')
})

test('retrieval uses fixed hosts, bounded requests, raster signatures and no redirect following', async () => {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options })
    return String(url).includes('/w/api.php') ? new Response(JSON.stringify(result(page())), { headers: { 'content-type': 'application/json' } }) : new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })
  }
  const image = await searchCategoryImage('artificial intelligence', fetcher)
  assert.deepEqual(image.bytes, bytes)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.options.redirect === 'error' && call.options.signal))
  assert.equal(await searchCategoryImage('artificial intelligence', async url => String(url).includes('/w/api.php') ? new Response(JSON.stringify(result(page()))) : new Response('<script>bad</script>', { headers: { 'content-type': 'image/jpeg' } })), null)
  assert.equal(await searchCategoryImage('artificial intelligence', async url => String(url).includes('/w/api.php') ? new Response(JSON.stringify(result(page()))) : new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'content-length': '9999999' } })), null)
})

test('saved covers are reused; concurrent members share one search without altering niche revision', async () => {
  const repository = createRepository(':memory:')
  try {
    const id = randomUUID(); const niche = repository.studioPut('team', 'niche', id, { name: 'AI' }, 0)
    let calls = 0; let finish
    const search = () => { calls++; return new Promise(resolve => { finish = resolve }) }
    const first = ensureCategoryImage(repository, 'team', niche, { search })
    while (!finish) await new Promise(resolve => setImmediate(resolve))
    assert.equal((await ensureCategoryImage(repository, 'team', niche, { search })).status, 'pending')
    finish(selected)
    const ready = await first
    assert.equal(ready.status, 'ready')
    assert.equal((await ensureCategoryImage(repository, 'team', niche, { search })).image.url, ready.image.url)
    const duplicate = repository.studioPut('team', 'niche', randomUUID(), { name: 'Artificial Intelligence' }, 0)
    assert.equal((await ensureCategoryImage(repository, 'team', duplicate, { search })).image.url, ready.image.url)
    assert.equal(calls, 1)
    assert.equal(repository.studioGet('team', 'niche', id).revision, niche.revision)
    assert.equal(repository.studioList('__workspace_control__', 'category_image_asset').length, 1)
    assert.equal(repository.studioList('other-team', 'category_image').length, 0)
  } finally { repository.close() }
})

test('missing or failed licensed images cache fallback; daily free cap and renamed categories cannot save stale covers', async () => {
  const repository = createRepository(':memory:'); const now = Date.now(); let calls = 0
  try {
    const niche = repository.studioPut('owner', 'niche', randomUUID(), { name: 'Astrology' }, 0)
    const search = async () => { calls++; throw new Error('Network unavailable') }
    assert.equal((await ensureCategoryImage(repository, 'owner', niche, { search, now })).status, 'unavailable')
    assert.equal((await ensureCategoryImage(repository, 'owner', niche, { search, now: now + 1000 })).status, 'unavailable')
    assert.equal(calls, 1)
    await ensureCategoryImage(repository, 'owner', niche, { search, now: now + 2 * 86400000 })
    assert.equal(calls, 2)
    const renamed = repository.studioPut('owner', 'niche', niche.id, { name: 'AI' }, niche.revision)
    const outcome = await ensureCategoryImage(repository, 'owner', renamed, { search: async () => { repository.studioPut('owner', 'niche', niche.id, { name: 'Vastu' }, renamed.revision); return selected } })
    assert.equal(outcome.status, 'pending')
    for (let index = 0; index < 20; index++) repository.studioReserve('category-images:limited', `item-${index}`, 20)
    const limited = repository.studioPut('limited', 'niche', randomUUID(), { name: 'Comedy' }, 0)
    assert.equal((await ensureCategoryImage(repository, 'limited', limited, { search: async () => { throw new Error('Must not run') } })).status, 'unavailable')
  } finally { repository.close() }
})

test('image lookup checks workspace access; viewers reuse shared cache; only public image bytes are exposed', async () => {
  const repository = createRepository(':memory:'); const app = express(); let calls = 0
  const auth = (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization }; next() }
  app.use('/assets', categoryImageAssets(repository))
  app.use('/intelligence', intelligenceRouter({ repository, auth, imageSearch: async () => { calls++; return selected } }))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const workspace = `ws:${randomUUID()}`; const id = randomUUID()
  repository.studioPut('__workspace_control__', 'workspace', workspace, { members: [{ uid: 'alice', role: 'owner' }, { uid: 'bob', role: 'viewer' }] }, 0)
  repository.studioPut(workspace, 'niche', id, { name: 'AI' }, 0)
  const call = (uid, category = id) => fetch(`${base}/intelligence/niches/${category}/image`, { headers: { authorization: uid, 'x-workspace-id': workspace } })
  try {
    assert.equal((await call('outsider')).status, 403)
    assert.equal((await call('alice', randomUUID())).status, 404)
    assert.equal(calls, 0)
    const first = await (await call('alice')).json()
    const second = await (await call('bob')).json()
    assert.equal(first.image.url, second.image.url); assert.equal(calls, 1)
    assert.equal((await call('outsider')).status, 403)
    const response = await fetch(base + first.image.url.replace('/api/studio/category-images', '/assets'))
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    assert.equal((await fetch(`${base}/assets/assets/${id}`)).status, 404)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
