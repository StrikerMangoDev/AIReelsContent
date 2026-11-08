import { Router } from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { load } from 'cheerio'

const assetScope = '__workspace_control__'
const hash = value => createHash('sha256').update(value).digest('hex')
const agent = 'AIReelsContent/1.0 (category cover lookup; Wikimedia Commons)'
const plain = value => { const $ = load(String(value || '')); $('script,style').remove(); return $.root().text().replace(/\s+/g, ' ').trim().slice(0, 2000) }
const day = 86400000

export function categoryImageQuery(name) {
  const subject = name.trim().toLowerCase()
  const query = /^(ai|artificial intelligence)$/i.test(subject) ? 'artificial intelligence' : /^(astrology|horoscopes?)$/.test(subject) ? 'astrology vintage' : /^(news|headlines|journalism|समाचार|खबर)$/.test(subject) ? 'journalism newsroom' : subject
  return query.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

export function commonsImageUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) || !url.pathname.startsWith('/wikipedia/commons/')) return null
    url.search = ''; url.hash = ''
    return url.href
  } catch { return null }
}

function licenseFor(metadata) {
  const name = plain(metadata.LicenseShortName?.value)
  const raw = String(metadata.LicenseUrl?.value || '')
  let url
  try { url = new URL(raw) } catch { return null }
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'creativecommons.org' || url.username || url.password || url.port || plain(metadata.Restrictions?.value)) return null
  const path = url.pathname.replace(/\/$/, '')
  const cc = path.match(/^\/licenses\/(by|by-sa)\/(2\.0|2\.5|3\.0|4\.0)(?:\/deed(?:\.[a-z-]+)?)?$/)
  if (cc && name === `CC ${cc[1].toUpperCase()} ${cc[2]}`) return { license: name, licenseUrl: `https://creativecommons.org/licenses/${cc[1]}/${cc[2]}/` }
  if (/^\/publicdomain\/zero\/1\.0(?:\/deed(?:\.[a-z-]+)?)?$/.test(path) && name === 'CC0') return { license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }
  return null
}

export function imageCandidates(data, query) {
  const words = query.split(' ').filter(word => word.length >= 2)
  return Object.values(data?.query?.pages || {}).flatMap(page => {
    const info = page.imageinfo?.[0]; const meta = info?.extmetadata || {}
    const rights = licenseFor(meta); const author = plain(meta.Artist?.value)
    const attribution = plain(meta.Attribution?.value)
    const title = plain(page.title).replace(/^File:/, '')
    const description = plain(meta.ImageDescription?.value)
    const sourceUrl = info?.descriptionurl
    const url = commonsImageUrl(info?.thumburl)
    const text = `${title} ${description}`.toLowerCase()
    const matches = words.filter(word => text.includes(word)).length
    const ratio = info?.width / info?.height
    if (!rights || !author || author.length > 400 || attribution.length > 1000 || !url || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s]+$/.test(sourceUrl || '') || !['image/jpeg', 'image/png', 'image/webp'].includes(info?.mime) || info.width < 400 || ratio < 1 || ratio > 3 || !words.length || matches < Math.min(2, words.length)) return []
    // Reject text-heavy documents and unrelated event/portrait images as category covers.
    if (/\b(diagram|chart|graph|poster|certificate|word cloud|newspaper|logo|ambigram|timeline|conference|portrait|study|scores|research topics)\b/i.test(title)) return []
    if (/\b(shop|storefront|signage)\b/i.test(title) && !/\b(shop|storefront|signage)\b/i.test(query)) return []
    const score = matches * 5 + (info.mime === 'image/jpeg' ? 3 : 0) + (ratio >= 1.3 && ratio <= 2.4 ? 2 : 0) + (/vintage|zodiac|robot|landscape|wheel/i.test(title) ? 2 : 0)
    return [{ url, mime: info.mime, title, author, attribution, sourceUrl, ...rights, score }]
  }).sort((a, b) => b.score - a.score)
}

async function boundedRead(url, maxBytes, accept, fetcher) {
  const response = await fetcher(url, { redirect: 'error', headers: { 'User-Agent': agent, Accept: accept }, signal: AbortSignal.timeout(8000) })
  if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Image source unavailable')
  const chunks = []; let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) throw new Error('Image source exceeds size limit')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  return { bytes: Buffer.concat(chunks), mime: (response.headers.get('content-type') || '').split(';')[0].toLowerCase() }
}

export async function searchCategoryImage(query, fetcher = fetch) {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size', iiurlwidth: '480' })
  const result = await boundedRead(url, 1024 * 1024, 'application/json', fetcher)
  const candidates = imageCandidates(JSON.parse(result.bytes.toString('utf8')), query)
  for (const candidate of candidates.slice(0, 2)) {
    try {
      const { bytes, mime } = await boundedRead(candidate.url, 300 * 1024, 'image/jpeg,image/png,image/webp', fetcher)
      const signature = mime === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
      if (!signature || mime !== candidate.mime) continue
      const { url: originalUrl, ...metadata } = candidate
      delete metadata.score
      return { ...metadata, originalUrl, bytes }
    } catch { /* Try at most one alternative, then retain the local cover. */ }
  }
  return null
}

export async function ensureCategoryImage(repository, uid, niche, { search = searchCategoryImage, now = Date.now() } = {}) {
  const query = categoryImageQuery(niche.name)
  const key = hash(query)
  const existing = await repository.studioGet(uid, 'category_image', key)
  if (existing?.queryKey === key && (existing.status === 'ready' || Date.parse(existing.retryAfter) > now)) return existing
  const lock = `category-image:${uid}:${key}`; const owner = randomUUID()
  if (!await repository.acquireLease(lock, owner, 45000)) return { status: 'pending' }
  try {
    const current = await repository.studioGet(uid, 'category_image', key)
    if (current?.queryKey === key && (current.status === 'ready' || Date.parse(current.retryAfter) > now)) return current
    const value = { queryKey: key, status: 'unavailable', retryAfter: new Date(now + day).toISOString() }
    try {
      // Separate from model quotas: at most 20 free image searches per workspace per rolling day.
      const reservation = await repository.studioReserve(`category-images:${uid}`, `${key}:${Math.floor(now / day)}`, 20)
      if (query && reservation.reserved) {
        const selected = await search(query)
        if (selected) {
          const { bytes, ...metadata } = selected
          const assetId = hash(bytes)
          if (!await repository.studioGet(assetScope, 'category_image_asset', assetId)) {
            try { await repository.studioPut(assetScope, 'category_image_asset', assetId, { mime: metadata.mime, data: bytes.toString('base64') }, 0) }
            catch (error) { if (error.code !== 'STUDIO_CONFLICT') throw error }
          }
          Object.assign(value, { status: 'ready', image: { ...metadata, url: `/api/studio/category-images/assets/${assetId}`, retrievedAt: new Date(now).toISOString(), changes: 'Displayed as a cropped category cover; image license applies to the image.' } })
          delete value.retryAfter
        }
      }
    } catch { /* Provider failure or free-query limit must never block the library. */ }
    const latest = await repository.studioGet(uid, 'niche', niche.id)
    if (!latest || categoryImageQuery(latest.name) !== query) return { status: 'pending' }
    return await repository.studioPut(uid, 'category_image', key, value, current?.revision || 0)
  } finally { await repository.releaseLease(lock, owner) }
}

export function categoryImageAssets(repository) {
  const router = Router()
  // These content-addressed bytes are licensed public images, never workspace names or records.
  router.get('/assets/:id', async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) return res.sendStatus(404)
    const asset = await repository.studioGet(assetScope, 'category_image_asset', req.params.id)
    if (!asset || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime)) return res.sendStatus(404)
    res.set({ 'Content-Type': asset.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(asset.data, 'base64'))
  })
  return router
}
