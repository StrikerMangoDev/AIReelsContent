import { setTimeout } from 'node:timers/promises'
import { repository } from './storage/index.js'
import { env } from './config/env.js'
import { refreshNextNiche } from './studio/intelligence.js'

if (env.STUDIO_RESEARCH_SCHEDULER !== 'true' || !env.GOOGLE_CLOUD_PROJECT) {
  console.error('Niche scheduler requires STUDIO_RESEARCH_SCHEDULER=true and a configured research provider.')
  repository.close(); process.exitCode = 1
} else {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort())
  try {
    do {
      try { console.log(JSON.stringify({ event: 'niche_refresh', ...await refreshNextNiche(repository) })) }
      catch { console.error(JSON.stringify({ event: 'niche_refresh', status: 'storage_unavailable' })) }
      if (process.argv.includes('--once') || controller.signal.aborted) break
      await setTimeout(60000, undefined, { signal: controller.signal })
    } while (!controller.signal.aborted)
  } catch (error) { if (error.name !== 'AbortError') throw error }
  finally { repository.close() }
}
