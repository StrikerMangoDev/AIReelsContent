import { timingSafeEqual } from 'node:crypto'
import { env } from '../server/config/env.js'
import { ingest } from '../server/bootstrap.js'
import { collectFeeds } from '../server/collect-feeds.js'
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET || ''}`)
  const actual = Buffer.from(request.headers.authorization || '')
  if (request.method !== 'GET' || !env.CRON_SECRET || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return response.status(401).json({ error: 'Unauthorized' })
  try {
    const collected = await collectFeeds()
    // Four publisher refreshes daily; only the 01:00 and 13:00 UTC slots curate.
    const hour = new Date().getUTCHours()
    const curated = hour === 1 || hour === 13 ? await ingest() : { status: 'skipped', reason: 'Publisher-only refresh' }
    response.json({ collected, curated })
  }
  catch { response.status(500).json({ error: 'Scheduled refresh failed; consult server run history' }) }
}
