import Parser from 'rss-parser'
import { canonicalUrl, articleId, plainText } from '../domain/article.js'
import { retry } from '../infrastructure/retry.js'
import { safeImageUrl } from './images.js'

const parser = new Parser({ customFields: { item: [['media:content', 'media'], ['media:thumbnail', 'thumbnail']] } })
const MAX_FEED_BYTES = 3 * 1024 * 1024

async function fetchFeed(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SignalAI/1.0 (RSS reader)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } })
  if (!response.ok) {
    const error = new Error(`Feed HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_FEED_BYTES) throw new Error('Feed exceeds size limit')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readSource(source, { maxAgeHours, now = Date.now() }) {
  const xml = await retry(() => fetchFeed(source.feedUrl), { attempts: 2, shouldRetry: error => !error.status || error.status === 429 || error.status >= 500 })
  const feed = await parser.parseString(xml)
  return feed.items.flatMap(item => {
    const url = canonicalUrl(item.link, source.domains)
    const published = Date.parse(item.isoDate || item.pubDate || '')
    const title = plainText(item.title).slice(0, 300)
    if (!url || !title || !Number.isFinite(published) || published > now + 300000 || published < now - maxAgeHours * 3600000) return []
    const image = item.media?.$?.url || item.thumbnail?.$?.url || (item.enclosure?.type?.startsWith('image/') ? item.enclosure.url : null)
    return [{ id: articleId(url), url, title, excerpt: plainText(item.contentSnippet || item.summary || item.content || item['content:encoded']).slice(0, 3000), publishedAt: new Date(published).toISOString(), sourceId: source.id, sourceName: source.name, sourceTier: source.tier, imageUrl: image ? safeImageUrl(image, url) : null }]
  })
}
