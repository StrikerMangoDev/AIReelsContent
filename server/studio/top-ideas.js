// Editorial prioritization of saved research; never a popularity or factual-accuracy score.
export function selectTopIdeas(reports, now = Date.now()) {
  const candidates = []
  let considered = 0
  for (const report of reports) {
    for (const [index, idea] of (report.opportunities || []).entries()) {
      considered++
      if (idea.verification !== 'reported' || !idea.title?.trim() || !idea.angle?.trim()) continue
      const sources = [...new Set(idea.evidenceIds || [])].map(id => report.evidence?.find(source => source.id === id)).filter(source => {
        try { return new URL(source?.url).protocol === 'https:' && source.excerpt?.trim().length >= 40 } catch { return false }
      })
      if (!sources.length || sources.length !== new Set(idea.evidenceIds || []).size) continue
      const domains = new Set(sources.map(source => new URL(source.url).hostname.replace(/^www\./, ''))).size
      const age = (now - Date.parse(report.researchedAt)) / 86400000
      const fresh = Number.isFinite(age) && age >= 0 && age <= (report.niche?.refreshIntervalDays || 7)
      const direct = sources.some(source => ['submitted-source', 'publisher-excerpt', 'retrieved-source'].includes(source.type))
      const score = 40 + Math.min(domains, 3) * 10 + (fresh ? 15 : 0) + (direct ? 10 : 0) + (idea.whyItMatters?.trim() ? 5 : 0)
      if (score < 60) continue
      candidates.push({ reportId: report.id, categoryId: report.nicheId, category: report.niche?.name || 'Saved category', index, title: idea.title, summary: idea.whatChanged, angle: idea.angle, whyItMatters: idea.whyItMatters, keywords: idea.keywords || [], researchedAt: report.researchedAt, fresh, score, reasons: [`${sources.length} saved ${sources.length === 1 ? 'source' : 'sources'}`, direct ? 'Publisher text available' : 'Headlines or summaries only', fresh ? 'Within refresh window' : 'Older research â€” check freshness', 'Clear content angle'], sources: sources.map(({ id, title, url, publisher, limitations }) => ({ id, title, url, publisher, limitations })) })
    }
  }
  candidates.sort((a,b) => b.score - a.score || String(b.researchedAt).localeCompare(String(a.researchedAt)) || a.title.localeCompare(b.title))
  const seen = new Set(); const counts = new Map(); const ideas = []
  const limit = Math.min(12, Math.max(1, Math.ceil(candidates.length * .3)))
  for (const idea of candidates) {
    const key = idea.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (seen.has(key) || (counts.get(idea.categoryId) || 0) >= 3) continue
    seen.add(key); counts.set(idea.categoryId, (counts.get(idea.categoryId) || 0) + 1); ideas.push(idea)
    if (ideas.length >= limit) break
  }
  return { ideas, considered, categoryCount: reports.length }
}
