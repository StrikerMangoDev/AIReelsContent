import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { categories, regions } from '../domain/article.js'
import { listNews, worldActivity, feedTopics } from '../services/news.js'
import { env } from '../config/env.js'
import { createAuthMiddleware, requireAdmin } from '../auth/firebase.js'
import { eventSchema } from '../services/analytics.js'
import { createMediaRouter } from '../media/router.js'
import { studioRouter } from '../studio/routes.js'

const querySchema = z.object({ region: z.enum(['Global', ...regions]).optional(), category: z.enum(['All signals', ...categories]).optional(), q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).max(200).default(1), limit: z.coerce.number().int().min(1).max(60).default(24), timezone: z.string().max(100).default('UTC') })
export function createApp({ repository, sources, verifyIdentity }) {
  const app = express()
  const auth = createAuthMiddleware(verifyIdentity)
  app.disable('x-powered-by'); app.use(helmet()); app.use(express.json({ limit: '128kb' }))
  app.use((_request, response, next) => { response.setHeader('X-Request-Id', randomUUID()); next() })
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))
  app.get('/api/health', async (_request, response) => { await repository.ping(); response.json({ status: 'ok', storage: env.STORAGE_PROVIDER }) })
  app.get('/api/status', async (_request, response) => response.json({ lastRun: await repository.lastRun(), lastSuccessfulRun: await repository.lastSuccessfulRun() }))
  app.get('/api/auth/config', (_request, response) => {
    let config = null
    try { const raw = JSON.parse(env.FIREBASE_WEB_CONFIG || 'null'); if (raw?.apiKey && raw?.authDomain && raw?.projectId === env.FIREBASE_PROJECT_ID) config = { apiKey: raw.apiKey, authDomain: raw.authDomain, projectId: raw.projectId, appId: raw.appId } } catch { /* Not configured yet. */ }
    response.json({ configured: Boolean(config), config })
  })
  app.get('/api/auth/me', auth, async (request, response) => { await repository.upsertUser(request.identity); response.setHeader('Cache-Control', 'no-store'); response.json(request.identity) })
  app.get('/api/admin/overview', auth, requireAdmin, async (_request, response) => { response.setHeader('Cache-Control', 'no-store'); response.json({ ...await repository.adminOverview(), ingestion: await repository.lastRun(), articleCount: (await repository.queryArticles({ page: 1, limit: 1 })).total }) })
  app.post('/api/events', rateLimit({ windowMs: 60000, limit: 40 }), (request, response, next) => request.headers.authorization ? auth(request, response, next) : next(), async (request, response) => {
    const event = eventSchema.safeParse(request.body)
    if (!event.success) return response.status(400).json({ error: 'Invalid event or missing consent' })
    await repository.recordEvent(event.data, request.identity?.uid || null)
    response.status(202).json({ accepted: true })
  })
  app.get('/api/sources', (_request, response) => response.json({ sources: sources.map(({ id, name, homepage, tier }) => ({ id, name, homepage, tier })) }))
  app.get('/api/news', async (request, response) => {
    const query = querySchema.safeParse(request.query)
    if (!query.success) return response.status(400).json({ error: 'Invalid news filters' })
    try { new Intl.DateTimeFormat('en', { timeZone: query.data.timezone }) } catch { return response.status(400).json({ error: 'Invalid timezone' }) }
    response.setHeader('Cache-Control', 'no-cache')
    const [news, topics, lastRun, successful] = await Promise.all([listNews(repository, query.data), feedTopics(repository, query.data.timezone, query.data), repository.lastRun(), repository.lastSuccessfulRun()])
    response.json({ ...news, ...topics, lastRun, updatedAt: successful?.finishedAt || null })
  })
  app.get('/api/activity', async (request, response) => {
    const timezone = typeof request.query.timezone === 'string' ? request.query.timezone : 'UTC'
    const period = request.query.period ?? 'today'
    if (!['today', '72h'].includes(period)) return response.status(400).json({ error: 'Invalid activity period' })
    try { response.json(await worldActivity(repository, timezone, new Date(), period)) }
    catch (error) { if (error instanceof RangeError) response.status(400).json({ error: 'Invalid timezone' }); else throw error }
  })
  app.get('/api/articles/:id/source', async (request, response) => {
    const article = await repository.find(request.params.id)
    if (!article) return response.status(404).json({ error: 'Article not found' })
    response.redirect(302, article.url)
  })
  app.use(createMediaRouter({ repository, auth }))
  app.use('/api/studio', studioRouter({ repository, auth }))
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint not found' }))
  app.use((error, _request, response, _next) => {
    console.error(JSON.stringify({ event: 'api_request_failed', requestId: response.getHeader('X-Request-Id'), type: error.name, code: error.code || null, storageCode: error.cause?.code || null }))
    response.status(error.status === 413 ? 413 : 500).json({ error: error.status === 413 ? 'Request too large' : 'Unexpected server error', requestId: response.getHeader('X-Request-Id') })
  })
  return app
}
