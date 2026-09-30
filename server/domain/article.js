import { createHash } from 'node:crypto'
import { z } from 'zod'

export const categories = ['Models', 'Research', 'Compute', 'Policy', 'Companies', 'Robotics', 'Software', 'Hardware', 'Security', 'Space', 'Technology']
export const regions = ['United States', 'India', 'China', 'Europe', 'Japan', 'United Kingdom']
export const classificationSchema = z.object({
  articles: z.array(z.object({
    candidateId: z.string(), relevant: z.boolean(),
    summary: z.string().max(600),
    category: z.enum(categories),
    regions: z.array(z.enum(regions)).max(6),
    regionEvidence: z.string().max(500),
    tags: z.array(z.string().max(40)).max(6),
  }).strict()).max(100),
}).strict()

export function canonicalUrl(value, domains) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !domains.includes(url.hostname)) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
    }
    return url.href
  } catch { return null }
}

export function articleId(url) { return createHash('sha256').update(url).digest('hex').slice(0, 24) }
export function plainText(value = '') { return String(value).replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g, ' ').replace(/\s+/g, ' ').trim() }

export function validateClassifications(candidates, raw) {
  const result = classificationSchema.parse(raw)
  const lookup = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const seen = new Set()
  const articles = result.articles.flatMap(item => {
    const candidate = lookup.get(item.candidateId)
    if (!candidate || seen.has(item.candidateId)) throw new Error('Gemini returned an unknown or repeated candidate ID')
    seen.add(item.candidateId)
    if (!item.relevant || !item.summary.trim()) return []
    // Geographic labels must include an evidence explanation, otherwise remain global.
    return [{ ...candidate, summary: item.summary, category: item.category, regions: item.regionEvidence.trim() ? item.regions : [], regionEvidence: item.regionEvidence, tags: item.tags }]
  })
  if (seen.size !== candidates.length) throw new Error('Gemini omitted candidate classifications')
  return articles
}
