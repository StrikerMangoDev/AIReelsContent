import { env } from '../server/config/env.js'
import { createCronHandler } from '../server/http/cron.js'
import { capabilityAllowed } from '../server/policy.js'

export default createCronHandler({
  secret: env.CRON_SECRET,
  enabled: capabilityAllowed('scheduling'),
  loadCollection: async () => (await import('../server/collect-feeds.js')).collectFeeds,
  loadIngestion: async () => (await import('../server/bootstrap.js')).ingest,
})
