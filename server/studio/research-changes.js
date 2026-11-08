import { createHash } from 'node:crypto'
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const fingerprint = topic => createHash('sha256').update(JSON.stringify([normalized(topic.title), normalized(topic.whatChanged)])).digest('hex')
const evidenceKey = (topic, evidence) => JSON.stringify((topic.evidenceIds || []).map(id => evidence.find(source => source.id === id)).filter(Boolean).map(source => [source.url, source.hash || normalized(source.excerpt)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))

// Exact normalized text matching is deliberately conservative; it is not semantic deduplication.
export function researchChanges(current, previous) {
  const prior = previous?.opportunities || []
  const seen = new Set()
  const topics = (current.opportunities || []).map((topic, index) => {
    const key = fingerprint(topic)
    const previousIndex = prior.findIndex(value => fingerprint(value) === key)
    const duplicate = seen.has(key); seen.add(key)
    const status = duplicate ? 'duplicate-in-report' : previousIndex < 0 ? 'new-to-report' : evidenceKey(topic, current.evidence || []) === evidenceKey(prior[previousIndex], previous.evidence || []) ? 'repeated' : 'evidence-changed'
    return { index, fingerprint: key, status, previousIndex: previousIndex < 0 ? null : previousIndex, disposition: status === 'repeated' || duplicate ? 'review-before-reusing' : 'review-development' }
  })
  return { previousReportId: previous?.id || null, method: 'normalized-title-and-development-exact-match', limitations: 'New means unmatched in the previous saved report, not a newly occurring event. Reworded duplicates may be missed. Changed evidence does not establish a changed fact. No topics are hidden automatically.', topics, counts: Object.fromEntries(['new-to-report', 'repeated', 'evidence-changed', 'duplicate-in-report'].map(status => [status, topics.filter(topic => topic.status === status).length])) }
}
