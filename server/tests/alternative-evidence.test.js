import test from 'node:test'
import assert from 'node:assert/strict'
import { findAlternativeEvidence, sameIdea } from '../studio/alternative-evidence.js'

const title = 'Discover Puerto Rico builds AI platform to connect travelers with local businesses'
const pack = { title, evidence: [{ id: 'E6', title: `${title} - PhocusWire`, url: 'https://news.google.com/original' }] }
const excerpt = 'Discover Puerto Rico is developing an AI platform to connect travelers with local businesses. '.repeat(5)

test('fallback requires same subject and topic, not generic AI or unrelated Puerto Rico coverage', () => {
  assert.equal(sameIdea(title, excerpt), true)
  assert.equal(sameIdea(title, 'Discover Puerto Rico released an AI song for travelers.'), false)
  assert.equal(sameIdea(title, 'Google builds AI platform to connect travelers with local businesses.'), false)
  assert.equal(sameIdea('Goldman Restricts Traders and Bankers From Using Some AI Tools', 'Goldman Sachs is restricting AI tools for traders and bankers who had been using them.'), true)
})

test('Goldman fallback rejects older events and commissioned coverage, preserving secondary-source limitations', async () => {
  const headline = 'Goldman Restricts Traders and Bankers From Using Some AI Tools'
  const source = { title: headline, evidence: [{ title: headline, url: 'https://bloomberg.com/original', publishedAt: '2026-11-02T12:00:00Z' }] }
  const fetched = []
  const result = await findAlternativeEvidence(source, {
    read: async () => ['old', 'sponsored', 'unreviewed', 'good'].map(id => ({ title: headline, url: `https://news.google.com/${id}`, publishedAt: id === 'old' ? '2026-04-29T12:00:00Z' : '2026-11-02T14:00:00Z' })),
    fetchSource: async url => {
      fetched.push(url)
      return { url: 'https://cryptobriefing.com/story', excerpt: headline.repeat(8) + (url.endsWith('sponsored') ? ' Press release commissioned' : '') + (url.endsWith('unreviewed') ? '' : ' Disclosure: This article was edited by Example Editor.'), hash: 'preserved', limitations: ['Retrieval may omit text.'] }
    },
  })
  assert.equal(fetched.length, 3)
  assert.equal(result[0].discoveryUrl, 'https://news.google.com/good')
  assert.equal(result[0].hash, 'preserved')
  assert.ok(result[0].limitations.includes('Retrieval may omit text.'))
  assert.match(result[0].limitations.join(' '), /AI-assisted reporting/)
})

test('fallback skips blocked, untrusted and unrelated results, retains alternative date and provenance', async () => {
  let calls = 0
  const read = async source => {
    assert.match(source.feedUrl, /q=discover\+puerto\+rico\+ai/)
    return ['original', 'blocked', 'untrusted', 'unrelated', 'good'].map(id => ({ title, url: `https://news.google.com/${id}`, publishedAt: '2026-10-13T00:00:00Z' }))
  }
  const fetchSource = async url => {
    calls++
    if (url.endsWith('/blocked')) throw new Error('403')
    return { title, url: url.endsWith('/untrusted') ? 'https://travelpress.com.evil.test/article' : 'https://www.travelpress.com/article', excerpt: url.endsWith('/unrelated') ? 'Unrelated news. '.repeat(40) : excerpt, hash: 'exact-alternative-hash', publishedAt: null }
  }
  const result = await findAlternativeEvidence(pack, { read, fetchSource })
  // Unrelated text must not pass just because its page title matches.
  assert.equal(result[0].discoveryUrl, 'https://news.google.com/good')
  assert.equal(result[0].publishedAt, '2026-10-13T00:00:00Z')
  assert.equal(result[0].hash, 'exact-alternative-hash'); assert.equal(calls, 4)
  assert.match(result[0].limitations.join(' '), /earlier announcement/)
})
