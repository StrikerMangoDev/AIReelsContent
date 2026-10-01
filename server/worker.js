import { setTimeout } from 'node:timers/promises'
import { env } from './config/env.js'
import { repository, ingest } from './bootstrap.js'
import { log } from './infrastructure/logger.js'
import { collectFeeds } from './collect-feeds.js'

const once = process.argv.includes('--once')
if (!once && env.ENABLE_SCHEDULER !== 'true') {
  log('info', 'scheduler_disabled', { hint: 'Set ENABLE_SCHEDULER=true to enable recurring ingestion' })
  repository.close()
} else {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  try {
    let nextCuration = 0
    do {
      if (once) { try { await ingest() } catch { process.exitCode = 1 } }
      else {
        try { await collectFeeds() } catch { log('error', 'publisher_refresh_failed') }
        if (Date.now() >= nextCuration) {
          nextCuration = Date.now() + env.REFRESH_INTERVAL_MINUTES * 60000
          try { await ingest() } catch { /* Persistent quota still caps attempts across restarts. */ }
        }
      }
      if (once || controller.signal.aborted) break
      await setTimeout(env.FEED_REFRESH_INTERVAL_MINUTES * 60000, undefined, { signal: controller.signal })
    } while (!controller.signal.aborted)
  } catch (error) { if (error.name !== 'AbortError') throw error }
  finally { repository.close() }
}
