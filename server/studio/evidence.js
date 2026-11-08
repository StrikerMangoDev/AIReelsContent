import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { load } from 'cheerio'

export function publicAddress(address) {
  if (isIP(address) !== 4) return false // Only IPv4 is fetched; IPv6-only sources need a reviewed network policy.
  const [a, b] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0))
}

export async function safeSourceUrl(value, resolve = lookup) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Source must be a public HTTPS URL')
  const addresses = await resolve(url.hostname, { all: true, family: 4 })
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Source must resolve to a public address')
  return { url, address: addresses[0].address }
}

async function sourcePage(value, redirects = 0, body) {
  if (redirects > 3) throw new Error('Source redirected too many times')
  const { url, address } = await safeSourceUrl(value)
  const result = await new Promise((resolve, reject) => {
    const request = https.request(url, { method: body ? 'POST' : 'GET', headers: { 'User-Agent': 'EvidenceStudio/1.0', Accept: 'text/html,text/plain,application/json', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, lookup: (_host, options, callback) => callback(null, options.all ? [{ address, family: 4 }] : address, 4) }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) { response.resume(); resolve({ redirect: response.headers.location }); return }
      if (response.statusCode !== 200 || !/^(text\/html|text\/plain|application\/json)/i.test(response.headers['content-type'] || '')) { response.resume(); reject(new Error('Source did not return readable text: ' + url.hostname + ' HTTP ' + response.statusCode + ' ' + response.headers['content-type'])); return }
      const chunks = []; let size = 0
      response.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(new Error('Source exceeds 1 MB limit')); else chunks.push(chunk) })
      response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', reject)
    })
    const deadline = setTimeout(() => request.destroy(new Error('Source fetch timed out')), 12000)
    request.on('close', () => clearTimeout(deadline)); request.on('error', reject)
    request.end(body)
  })
  if (result.redirect) return sourcePage(new URL(result.redirect, url).href, redirects + 1)
  return { url, body: result.body }
}

export async function fetchEvidence(value, redirects = 0) {
  let page = await sourcePage(value, redirects)
  if (page.url.hostname === 'news.google.com') {
    const node = load(page.body)('[data-n-a-id][data-n-a-ts][data-n-a-sg]').first()
    const id = node.attr('data-n-a-id'); const timestamp = Number(node.attr('data-n-a-ts')); const signature = node.attr('data-n-a-sg')
    if (!id || !timestamp || !signature) throw new Error('Publisher link unavailable')
    // shortcut: Google exposes no stable redirect API; fail closed if its RPC format changes.
    const request = ['garturlreq', [['en-US', 'US', ['FINANCE_TOP_INDICES', 'WEB_TEST_1_0_0'], null, null, 1, 1, 'US:en', null, 360, null, null, null, null, null, 0, null, null, [1677434405, 738601000]], 'en-US', 'US', 1, [2, 3, 4, 8], 1, 0, '668194412', 0, 0, null, 0], id, timestamp, signature]
    const rpc = await sourcePage('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', 0, new URLSearchParams({ 'f.req': JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]) }).toString())
    let publisherUrl
    for (const line of rpc.body.split('\n')) {
      if (!line.startsWith('[[')) continue
      try { for (const frame of JSON.parse(line)) { if (frame[1] === 'Fbv4je' && frame[2]) { const result = JSON.parse(frame[2]); if (result[0] === 'garturlres') publisherUrl = result[1] } } } catch { /* Ignore non-data RPC frames. */ }
    }
    if (!publisherUrl || new URL(publisherUrl).hostname === 'news.google.com') throw new Error('Publisher link unavailable')
    page = await sourcePage(publisherUrl)
  }
  const { url } = page
  const $ = load(page.body)
  const title = $('head > title').first().text().trim().slice(0, 300) || url.hostname
  $('script,style,nav,footer,header,noscript').remove()
  const main = $('article,main').first()
  const excerpt = (main.length ? main.text() : $.text()).replace(/\s+/g, ' ').trim().slice(0, 16000)
  if (excerpt.length < 100) throw new Error('Source did not provide enough readable evidence')
  return { id: 'E1', url: url.href, title, publisher: url.hostname, excerpt, retrievedAt: new Date().toISOString(), publishedAt: null, type: 'submitted-source', limitations: ['User-submitted source; publisher credibility and claims require editorial review.', 'Retrieved text may omit parts of the original page.'], hash: createHash('sha256').update(excerpt).digest('hex') }
}

export function articleEvidence(article) {
  // Curated summaries are model output, not source passages. Only use the publisher excerpt.
  const excerpt = String(article.excerpt || article.description || '').trim()
  return { id: 'E1', url: article.url, title: article.title, publisher: article.sourceName || article.sourceId, excerpt, retrievedAt: new Date().toISOString(), publishedAt: article.publishedAt, type: 'publisher-excerpt', limitations: ['Publisher excerpt only; the full article and independent corroboration have not been reviewed.'], hash: createHash('sha256').update(excerpt).digest('hex') }
}
