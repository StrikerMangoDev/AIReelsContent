import { load } from 'cheerio'
import robotsParser from 'robots-parser'
import { canonicalUrl, plainText } from '../domain/article.js'

const agent = 'SignalAI'
const policies = new Map()
async function readSmall(url, maxBytes) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'SignalAI/1.0 (news metadata reader)' } })
  if (!response.ok) return null
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) return null
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { await reader.cancel() }
}

export function safeImageUrl(value, base) {
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || /^(localhost|.*\.local|.*\.internal|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(url.hostname)) return null
    return url.href
  } catch { return null }
}

export function feedImage(item, base) {
  const values = []
  for (const field of [item.media, item.thumbnail, item['media:content'], item['media:thumbnail']]) {
    for (const entry of Array.isArray(field) ? field : [field]) if (entry?.$?.url) values.push(entry.$.url)
  }
  if (item.enclosure?.type?.startsWith('image/')) values.push(item.enclosure.url)
  const $ = load(item['content:encoded'] || item.content || item.summary || '')
  $('img').each((_index, image) => { const raw = $(image).attr('src') || $(image).attr('data-src'); if (raw) values.push(raw) })
  return values.map(value => safeImageUrl(value, base)).find(Boolean) || null
}

export async function enrichImages(articles, sources, repository, limit = 40) {
  // Filter BEFORE limiting, so image-less research papers cannot consume the repair budget.
  const eligible = articles.filter(article => !article.imageUrl && sources.some(source => source.id === article.sourceId && source.tier !== 'research')).slice(0, limit)
  let cursor = 0
  let updated = 0
  await Promise.all(Array.from({ length: Math.min(4, eligible.length) }, async () => {
    while (cursor < eligible.length) {
      const article = eligible[cursor++]
      const image = await articleImage(article, sources)
      if (image) { await repository.updateImage(article.id, image); updated++ }
    }
  }))
  return { attempted: eligible.length, updated }
}

export async function articleMetadata(article, sources) {
  const source = sources.find(item => item.id === article.sourceId)
  if (!source || !canonicalUrl(article.url, source.domains) || source.tier === 'research') return null
  try {
    const origin = new URL(article.url).origin
    if (!policies.has(origin)) {
      const robots = await readSmall(`${origin}/robots.txt`, 100000)
      policies.set(origin, robots === null ? null : robotsParser(`${origin}/robots.txt`, robots))
    }
    const policy = policies.get(origin)
    if (!policy || policy.isAllowed(article.url, agent) === false) return null
    const html = await readSmall(article.url, 1500000)
    if (!html) return null
    const $ = load(html)
    const raw = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content')
    return { imageUrl: raw ? safeImageUrl(raw, article.url) : null, description: plainText($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '').slice(0, 1500) }
  } catch { return null }
}
export async function articleImage(article, sources) { return (await articleMetadata(article, sources))?.imageUrl ?? null }
