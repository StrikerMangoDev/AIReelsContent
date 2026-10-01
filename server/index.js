import { env } from './config/env.js'
import { sources } from './config/sources.js'
import { repository } from './storage/index.js'
import { createApp } from './http/app.js'
import { log } from './infrastructure/logger.js'

const app = createApp({ repository, sources })
const server = app.listen(env.PORT, env.HOST, () => log('info', 'api_listening', { port: env.PORT }))
server.on('error', () => { log('error', 'api_listen_failed'); process.exitCode = 1 })
function shutdown() { server.close(() => { repository.close(); process.exit(0) }); setTimeout(() => process.exit(1), 10000).unref() }
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
