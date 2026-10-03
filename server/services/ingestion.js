import { randomUUID } from 'node:crypto'
import { log } from '../infrastructure/logger.js'
import { articleMetadata } from '../ingestion/images.js'
import { attributeOrganizations } from '../config/organizations.js'

export function createIngestion({ repository, sources, readSource, classify, config }) {
  let running = false
  return async function ingest() {
    const owner = randomUUID()
    if (running || !await repository.acquireLease('ingestion', owner)) return { status: 'busy' }
    running = true
    const runId = await repository.startRun()
    const report = { discovered: 0, selected: 0, saved: 0, sources: [], model: config.LLM_MODEL }
    try {
      const results = await Promise.allSettled(sources.map(source => readSource(source, { maxAgeHours: config.MAX_ARTICLE_AGE_HOURS })))
      const candidates = new Map()
      results.forEach((result, index) => {
        report.sources.push({ sourceId: sources[index].id, status: result.status === 'fulfilled' ? 'ok' : 'failed', count: result.status === 'fulfilled' ? result.value.length : 0 })
        if (result.status === 'fulfilled') for (const article of result.value) candidates.set(article.id, article)
        else log('warn', 'source_failed', { sourceId: sources[index].id })
      })
      report.discovered = candidates.size
      if (results.every(result => result.status === 'rejected')) throw new Error('No configured feed was reachable')
      // Round-robin source selection prevents one busy publisher consuming the entire run.
      const done = new Set(await repository.processedIds([...candidates.keys()]))
      const queues = sources.map(source => [...candidates.values()].filter(article => article.sourceId === source.id && !done.has(article.id)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)))
      const selected = []
      while (selected.length < config.MAX_ARTICLES_PER_RUN && queues.some(queue => queue.length)) {
        for (const queue of queues) { if (queue.length && selected.length < config.MAX_ARTICLES_PER_RUN) selected.push(queue.shift()) }
      }
      report.selected = selected.length
      // One bounded request per refresh; the rolling 24h quota includes every attempt.
      if (selected.length) {
        await repository.renewLease('ingestion', owner)
        const batch = selected
        // Fill missing feed evidence with publisher metadata and discover the actual cover image.
        let cursor = 0
        await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
          while (cursor < batch.length) {
            const candidate = batch[cursor++]
            const metadata = await articleMetadata(candidate, sources)
            candidate.imageUrl = metadata?.imageUrl ?? candidate.imageUrl ?? null
            if (candidate.excerpt.length < 60 && metadata?.description) candidate.excerpt = metadata.description
          }
        }))
        await repository.renewLease('ingestion', owner)
        const articles = await classify(batch, () => repository.reserveModelCall(config.MAX_MODEL_CALLS_PER_DAY))
        report.saved += await repository.persistBatch(articles.map(attributeOrganizations), batch)
      }
      const status = report.sources.some(source => source.status === 'failed') ? 'degraded' : 'success'
      await repository.finishRun(runId, status, report)
      log('info', 'ingestion_finished', { runId, status, saved: report.saved })
      return { status, ...report }
    } catch (error) {
      // Never log SDK error payloads: they can include request internals.
      const errorCode = error.status ? `VERTEX_HTTP_${error.status}` : 'INGESTION_FAILED'
      await repository.finishRun(runId, 'failed', { ...report, errorCode })
      log('error', 'ingestion_failed', { runId, errorCode })
      throw new Error(errorCode, { cause: error })
    } finally {
      running = false
      await repository.releaseLease('ingestion', owner)
    }
  }
}
