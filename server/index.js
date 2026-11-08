import { refreshNextNiche } from './studio/intelligence.js'
import { env } from './config/env.js'
import { sources } from './config/sources.js'
import { repository } from './storage/index.js'
import { createApp } from './http/app.js'
import { log } from './infrastructure/logger.js'
import { localResearchDispatcher, localGenerationDispatcher } from './studio/local-research-dispatch.js'

const onResearchAdmitted = localResearchDispatcher({ repository, enabled: process.env.LOCAL_RESEARCH_DISPATCH, host: env.HOST, nodeEnv: env.NODE_ENV, vercel: process.env.VERCEL, report: entry => log('info', entry.event, { jobId: entry.jobId, status: entry.status, code: entry.code, diagnostics: entry.diagnostics }) })
const onGenerationAdmitted = localGenerationDispatcher({ repository, enabled: process.env.LOCAL_GENERATION_DISPATCH, host: env.HOST, nodeEnv: env.NODE_ENV, vercel: process.env.VERCEL, report: entry => log('info', entry.event, { jobId: entry.jobId, status: entry.status, code: entry.code, diagnostics: entry.diagnostics }) })
const app = createApp({ repository, sources, onResearchAdmitted, onGenerationAdmitted })
// Local-only timer; hosted scheduling is not enabled by this change.
if (onResearchAdmitted && env.STORAGE_PROVIDER === 'sqlite') {
  const timer = setInterval(() => { void refreshNextNiche({ repository, onResearchAdmitted }).catch(() => log('error', 'category_refresh_failed')) }, 60000)
  timer.unref()
}
const server = app.listen(env.PORT, env.HOST, () => log('info', 'api_listening', { port: env.PORT }))
server.on('error', () => { log('error', 'api_listen_failed'); process.exitCode = 1 })
function shutdown() { server.close(() => { repository.close(); process.exit(0) }); setTimeout(() => process.exit(1), 10000).unref() }
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
