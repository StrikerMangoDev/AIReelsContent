import { setTimeout } from 'node:timers/promises'
import { env } from './config/env.js'
import { repository, ingest } from './bootstrap.js'
import { log } from './infrastructure/logger.js'

const once = process.argv.includes('--once')
if (!once && env.ENABLE_SCHEDULER !== 'true') {
  log('info', 'scheduler_disabled', { hint: 'Set ENABLE_SCHEDULER=true to enable recurring ingestion' })
  repository.close()
} else {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  try {
    do {
      try { await ingest() } catch { if (once) process.exitCode = 1 }
      if (once || controller.signal.aborted) break
      await setTimeout(env.REFRESH_INTERVAL_MINUTES * 60000, undefined, { signal: controller.signal })
    } while (!controller.signal.aborted)
  } catch (error) { if (error.name !== 'AbortError') throw error }
  finally { repository.close() }
}
