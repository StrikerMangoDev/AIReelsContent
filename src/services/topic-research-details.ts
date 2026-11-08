/** Editorial suggestions only: news excerpts do not measure audience demand. */
export function topicResearchDetails(topic: { title: string; keywords?: string[] }) {
  const keywords = [...new Set((topic.keywords || []).map(value => value.trim()).filter(Boolean))]
  return {
    keywords: keywords.map(term => ({ term, intent: null, intentStatus: 'not-researched', searchVolume: null, searchVolumeStatus: 'unavailable', basis: 'Suggested topic terminology; not validated search demand.' })),
    observedQuestions: { status: 'unavailable', items: [] as { text: string; evidenceIds: string[] }[], reason: 'No audience discussion or question dataset was retrieved. News excerpts cannot establish audience questions.' },
    proposedQuestions: { status: 'editorial-suggestions', items: [`What does “${topic.title}” mean for this audience?`, `What evidence and limitations should readers check before acting on “${topic.title}”?`], reason: 'Prompts to consider, not questions observed from real users or measured search queries.' },
  }
}
