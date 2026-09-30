import { regions } from '../domain/article.js'

export function dayInTimezone(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date))
}

export async function listNews(repository, { region, category, q, page, limit }) {
  const result = await repository.queryArticles({ region, category, q, page, limit })
  // Evidence excerpts stay in storage; the public API exposes only our short summary.
  return { ...result, articles: result.articles.map(({ excerpt: _excerpt, regionEvidence: _evidence, ...article }) => article) }
}

export async function worldActivity(repository, timezone, now = new Date(), period = 'today') {
  const day = dayInTimezone(now, timezone)
  // The last 48h covers today's local date across all IANA timezone offsets and DST changes.
  const today = (await repository.articlesSince(new Date(new Date(now).getTime() - (period === '72h' ? 72 : 48) * 3600000).toISOString())).filter(article => period === '72h' || dayInTimezone(article.publishedAt, timezone) === day)
  return { day, timezone, period, unlocated: today.filter(article => !article.regions.length).length, total: today.length, regions: regions.map(region => {
    const matching = today.filter(article => article.regions.includes(region))
    return { region, total: matching.length, research: matching.filter(article => article.category === 'Research').length, models: matching.filter(article => article.category === 'Models').length }
  }), global: { total: today.length, research: today.filter(article => article.category === 'Research').length, models: today.filter(article => article.category === 'Models').length } }
}
export async function feedTopics(repository, timezone) {
  const recent = await repository.articlesSince(new Date(Date.now() - 72 * 3600000).toISOString())
  const today = recent.filter(article => dayInTimezone(article.publishedAt, timezone) === dayInTimezone(new Date(), timezone))
  const active = today.length ? today : recent
  const counts = new Map()
  for (const article of active) counts.set(article.category, (counts.get(article.category) || 0) + 1)
  return { topics: [...counts].sort((a,b) => b[1]-a[1]).map(([name,count]) => ({name,count})), topicPeriod: today.length ? 'today' : '72h' }
}
