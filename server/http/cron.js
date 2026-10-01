import { timingSafeEqual } from 'node:crypto'
import { randomUUID } from 'node:crypto'

// Log identifiers only: database messages/details can contain row data or secrets.
export function cronFailure(error, stage, requestId) {
  const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : null
  return { event: 'scheduled_refresh_failed', requestId, stage, type: identifier(error?.name), operation: identifier(error?.operation), code: identifier(error?.code), causeCode: identifier(error?.cause?.code) }
}

export function createCronHandler({ secret, loadCollection, loadIngestion, now = () => new Date(), log = value => console.error(JSON.stringify(value)) }) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store')
    const expected = Buffer.from(`Bearer ${secret || ''}`)
    const actual = Buffer.from(request.headers.authorization || '')
    if (request.method !== 'GET' || !secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return response.status(401).json({ error: 'Unauthorized' })
    const requestId = randomUUID()
    response.setHeader('X-Request-Id', requestId)
    let stage = 'load_collection'
    try {
      const collectFeeds = await loadCollection()
      stage = 'collect_feeds'
      const collected = await collectFeeds()
      if (collected.status === 'busy') return response.json({ collected, curated: { status: 'skipped', reason: 'Another refresh holds the lease' } })
      const hour = now().getUTCHours()
      let curated = { status: 'skipped', reason: 'Publisher-only refresh' }
      if (hour === 1 || hour === 13) {
        stage = 'load_ingestion'
        const ingest = await loadIngestion()
        stage = 'curate'
        curated = await ingest()
      }
      return response.json({ collected, curated })
    } catch (error) {
      log(cronFailure(error, stage, requestId))
      return response.status(500).json({ error: 'Scheduled refresh failed. Check runtime logs using the request ID.', requestId })
    }
  }
}
