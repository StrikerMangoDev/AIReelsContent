import { readSource } from '../ingestion/feeds.js'
import { sources } from '../config/sources.js'
import { fetchEvidence } from './evidence.js'

// A search ranking alone is not a publisher trust decision. Expand this list after publisher review.
const publishers = [...sources.flatMap(source => source.domains), 'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'wtm.com', 'travelpress.com', 'breakingtravelnews.com', 'paxnews.com', 'ttgmedia.com', 'phocuswire.com', 'cryptobriefing.com']
const stopWords = new Set('a an the and or to for of in on with from by as at its new builds build announces announced announcement launch launches latest how why what is are was were will has have'.split(' '))
const terms = text => [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter(word => word.length > 1 && !stopWords.has(word))
const matchingTerms = text => terms(text).map(word => word.replace(/^(restrict)(?:s|ed|ing|ion|ions)$/, '$1'))

export function sameIdea(title, candidate) {
  const expected = matchingTerms(title); const actual = new Set(matchingTerms(candidate))
  if (expected.length < 3) return false
  // Require the subject as well as broad overlap; generic AI coverage is not a substitute.
  return expected.slice(0, 3).every(word => actual.has(word)) && expected.filter(word => actual.has(word)).length / expected.length >= 0.7
}

export async function findAlternativeEvidence(pack, { read = readSource, fetchSource = fetchEvidence } = {}) {
  const original = pack.evidence[0]
  const title = (original?.title || pack.title || '').replace(/\s[-–|]\s[^–|]+$/, '')
  const query = terms(title).slice(0, 4).join(' ')
  if (!query) return []
  const feedUrl = `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`
  const candidates = await read({ id: 'alternative-search', name: 'Google News RSS', domains: ['news.google.com'], feedUrl }, { maxAgeHours: 24 * 365 })
  const excluded = new Set(pack.evidence.flatMap(source => [source.url, source.discoveryUrl].filter(Boolean)))
  const originalDate = Date.parse(original?.publishedAt)
  const eligible = candidates.filter(candidate => {
    const candidateDate = Date.parse(candidate.publishedAt)
    // A similarly worded older event is not replacement evidence for dated news.
    if (Number.isFinite(originalDate) && (!Number.isFinite(candidateDate) || Math.abs(candidateDate - originalDate) > 7 * 86400000)) return false
    return !excluded.has(candidate.url) && matchingTerms(title).slice(0, 3).every(word => matchingTerms(candidate.title).includes(word))
  }).slice(0, 5)
  for (const candidate of eligible) {
    try {
      const fetched = await fetchSource(candidate.url)
      const host = new URL(fetched.url).hostname
      if (!publishers.some(domain => host === domain || host.endsWith(`.${domain}`)) || excluded.has(fetched.url)) continue
      if (fetched.excerpt.trim().length < 300 || !sameIdea(title, fetched.excerpt)) continue
      if (/press release commissioned|sponsored (?:content|article|post)|paid partnership/i.test(fetched.excerpt)) continue
      const secondary = host === 'cryptobriefing.com' || host.endsWith('.cryptobriefing.com')
      // Crypto Briefing's editorial policy permits AI-assisted reporting; retain that limitation.
      if (secondary && !/Disclosure: This article was edited by/i.test(fetched.excerpt)) continue
      return [{ ...fetched, publishedAt: candidate.publishedAt, discoveryUrl: candidate.url, type: 'alternative-publisher-article', limitations: [...(fetched.limitations || []), 'Alternative coverage matched to the selected idea by subject and topic terms; this is not independent fact verification.', 'Use only facts supported by this article. It may cover an earlier announcement or differ from the original lead.', ...(secondary ? ['Secondary reporting from Crypto Briefing, whose editorial policy permits AI-assisted reporting. Attribute claims to this publisher; the blocked original article has not been verified.'] : [])] }]
    } catch { /* Try the next bounded public source; never bypass publisher access controls. */ }
  }
  return []
}
