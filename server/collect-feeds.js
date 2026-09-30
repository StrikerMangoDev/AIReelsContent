import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { repository } from './bootstrap.js'
import { sources } from './config/sources.js'
import { readSource } from './ingestion/feeds.js'
import { attributeOrganizations } from './config/organizations.js'

function categoryFor(item) {
  const text = item.title.toLowerCase()
  if (item.sourceTier === 'research') return 'Research'
  for (const [category, expression] of [['Robotics', /robot|humanoid/], ['Security', /security|hack|breach|vulnerab/], ['Space', /space|satellite|rocket/], ['Compute', /chip|gpu|data center|datacenter/], ['Models', /model|llm|gpt|gemini|claude/], ['Policy', /regulat|legislat|law|government/], ['Hardware', /device|phone|laptop|headset/], ['Software', /software|app\b|tool|platform/]]) if (expression.test(text)) return category
  return 'Technology'
}

export async function collectFeeds() {
  const owner = randomUUID()
  if (!await repository.acquireLease('ingestion', owner)) return { status: 'busy' }
  const run = await repository.startRun()
  try {
    const results = await Promise.allSettled(sources.map(source => readSource(source, { maxAgeHours: 72 })))
    const candidates = [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(item => [item.id, item])).values()]
    if (!candidates.length) throw new Error('No usable publisher articles')
    const articles = candidates.map(item => attributeOrganizations({ ...item, summary: item.excerpt.slice(0, 220) || 'Read the original announcement for details.', summaryBasis: 'publisher-excerpt', category: categoryFor(item), regions: [], tags: [] }))
    const saved = await repository.persistBatch(articles, [])
    // Repair older unlocated records only when the article explicitly names a known organization.
    let located = 0
    for (const article of await repository.allArticles()) {
      const attributed = attributeOrganizations(article)
      if (!article.regions.length && attributed.regions.length) { await repository.updateArticle(attributed); located++ }
    }
    const failedSources = results.flatMap((result, index) => result.status === 'rejected' ? [sources[index].id] : [])
    const result = { status: failedSources.length ? 'degraded' : 'success', saved, candidates: candidates.length, located, failedSources, method: 'publisher-feeds', vertexCalls: 0 }
    await repository.finishRun(run, result.status, result)
    return result
  } catch (error) { await repository.finishRun(run, 'failed', { errorCode: 'FEED_COLLECTION_FAILED' }); throw error }
  finally { await repository.releaseLease('ingestion', owner) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await collectFeeds())) }
  finally { repository.close() }
}
