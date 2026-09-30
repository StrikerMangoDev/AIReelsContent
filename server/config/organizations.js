// Attribution is organization association, not evidence of the event's physical location.
// Source publisher identity alone is never used to assign a country.
export const organizations = [
  { pattern: /\bOpenAI\b/i, region: 'United States', name: 'OpenAI', reference: 'https://openai.com/policies/privacy-policy/' },
  { pattern: /\bNVIDIA\b/i, region: 'United States', name: 'NVIDIA', reference: 'https://www.nvidia.com/en-us/contact/' },
  { pattern: /\bAnthropic\b/i, region: 'United States', name: 'Anthropic', reference: 'https://www.anthropic.com/legal/privacy' },
  { pattern: /\bGoogle DeepMind\b|\bDeepMind\b/i, region: 'United Kingdom', name: 'Google DeepMind', reference: 'https://deepmind.google/about/' },
]

export function attributeOrganizations(article) {
  if (article.regions?.length) return article
  const evidence = `${article.title} ${article.summary || ''} ${article.excerpt || ''}`
  const matches = organizations.filter(organization => organization.pattern.test(evidence))
  if (!matches.length) return { ...article, regions: article.regions || [] }
  return { ...article, regions: [...new Set(matches.map(item => item.region))], regionEvidence: matches.map(item => `Organization association: ${item.name} (${item.region}); ${item.reference}`).join('; '), regionBasis: 'organization' }
}
