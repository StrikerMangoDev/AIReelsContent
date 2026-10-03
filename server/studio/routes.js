import { Router } from 'express'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { articleEvidence, fetchEvidence } from './evidence.js'
import { contentSchema, settingsSchema, generateContent, reviewContent } from './content.js'
import { createLibraryRouter } from './library.js'
import { requireAdmin } from '../auth/firebase.js'
import { intelligenceRouter } from './intelligence.js'

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/)
const createSchema = z.object({ articleId: z.string().max(100).optional(), sourceUrl: z.string().url().max(2000).optional(), sourceIds: z.array(z.string().max(100)).min(1).max(5).optional(), researchId: z.string().max(100).optional(), opportunityIndex: z.number().int().min(0).max(4).optional(), settings: settingsSchema.optional(), requestId }).strict().refine(value => [value.articleId, value.sourceUrl, value.sourceIds, value.researchId].filter(Boolean).length === 1)
const patchSchema = z.object({ revision: z.number().int().min(1), content: contentSchema.optional(), editorialStatus: z.enum(['draft', 'needs_review', 'approved']).optional() }).strict()
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message })
const lineageId = (uid, id) => createHash('sha256').update(`${uid}:${id}`).digest('hex')
const evidenceHash = evidence => createHash('sha256').update(JSON.stringify(evidence.map(item => item.hash))).digest('hex')

export function studioRouter({ repository, auth, generate = generateContent, fetchSource = fetchEvidence }) {
  const router = Router()
  const publicationStatus = async publication => {
    const state = publication.lineageId && await repository.studioGet('public', 'publication_state', publication.lineageId)
    return { ...publication, correctionRequired: Boolean(state && state.evidenceHash !== publication.evidenceHash), evidenceCheckedAt: state?.checkedAt || null }
  }
  const requireCurrentLibrary = async (uid, value) => {
    for (const [index, sourceId] of (value.sourceIds || []).entries()) {
      const source = await repository.studioGet(uid, 'library_source', sourceId)
      if (!source || source.reviewStatus !== 'approved' || source.evidence.hash !== value.evidence[index].hash) throw fail(409, 'A library source changed or is no longer approved. Review the source and create a fresh package.')
    }
  }
  router.use('/library', createLibraryRouter({ repository, auth, fetchSource }))
  router.use('/intelligence', intelligenceRouter({ repository, auth }))
  router.get('/config', (_req, res) => res.json({ industries: ['AI', 'Technology', 'Finance', 'Healthcare', 'Education', 'Custom'], capabilities: { generation: Boolean(env.OPENROUTER_API_KEY), media: false, publishing: true, researchScheduling: env.STUDIO_RESEARCH_SCHEDULER === 'true' }, dailyGenerationLimit: env.STUDIO_DAILY_GENERATIONS }))
  router.get('/publications', async (_req, res) => res.json({ publications: await Promise.all((await repository.studioList('public', 'publication')).map(publicationStatus)) }))
  router.get('/publications/:publicationId', async (req, res) => {
    const publication = await repository.studioGet('public', 'publication', req.params.publicationId)
    if (!publication) throw fail(404, 'Publication not found')
    res.json(await publicationStatus(publication))
  })
  router.get('/articles/:id', async (req, res) => {
    const article = await repository.find(req.params.id)
    if (!article) throw fail(404, 'Article not found')
    res.json({ article, evidence: [articleEvidence(article)] })
  })
  router.use(auth, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/profile', async (req, res) => res.json(await repository.studioGet(req.identity.uid, 'profile', 'default') || settingsSchema.parse({})))
  router.put('/profile', async (req, res) => res.json(await repository.studioPut(req.identity.uid, 'profile', 'default', settingsSchema.parse(req.body))))
  router.get('/packages', async (req, res) => res.json({ packages: await repository.studioList(req.identity.uid, 'package') }))
  router.post('/packages', async (req, res) => {
    const input = createSchema.parse(req.body); const uid = req.identity.uid
    const id = createHash('sha256').update(input.requestId).digest('hex').slice(0, 32)
    const existing = await repository.studioGet(uid, 'package', id)
    if (existing) return res.json(existing)
    let evidence; let researchContext = null; let researchedSettings
    if (input.researchId) {
      const report = await repository.studioGet(uid, 'research', input.researchId)
      const opportunity = report?.opportunities[input.opportunityIndex ?? 0]
      if (!opportunity) throw fail(404, 'Research opportunity not found')
      const ids = new Set([...opportunity.evidenceIds, ...opportunity.positive.flatMap(item => item.evidenceIds), ...opportunity.negative.flatMap(item => item.evidenceIds), ...opportunity.audienceReaction.evidenceIds])
      evidence = report.evidence.filter(item => ids.has(item.id))
      researchContext = { brief: report.niche.brief, opportunity, researchedAt: report.researchedAt, methodology: report.methodology }
      researchedSettings = settingsSchema.parse({ industry: report.niche.name, audience: report.niche.audience || 'Infer from the brief', language: report.niche.language, voice: report.niche.voice, tone: report.niche.tone, platform: 'Instagram, YouTube, LinkedIn', duration: report.niche.duration })
    } else if (input.sourceIds) {
      evidence = await Promise.all(input.sourceIds.map(async (sourceId, index) => {
        const source = await repository.studioGet(uid, 'library_source', sourceId)
        if (!source || source.reviewStatus !== 'approved') throw fail(422, 'Select approved sources from your own library')
        return { ...source.evidence, id: `E${index + 1}` }
      }))
    } else if (input.articleId) {
      const article = await repository.find(input.articleId)
      if (!article) throw fail(404, 'Article not found')
      evidence = [articleEvidence(article)]
    } else {
      try { evidence = [await fetchSource(input.sourceUrl)] } catch { throw fail(422, 'Source could not be retrieved. Use an accessible public HTTPS article with readable text.') }
    }
    const profile = await repository.studioGet(uid, 'profile', 'default')
    const settings = input.settings || researchedSettings || settingsSchema.parse(profile ? Object.fromEntries(Object.keys(settingsSchema.shape).map(key => [key, profile[key]])) : {})
    const value = { title: researchContext?.opportunity.title || evidence[0].title, articleId: input.articleId || null, sourceIds: input.sourceIds || [], researchId: input.researchId || null, researchContext, settings, evidence, content: null, status: 'draft', editorialStatus: 'draft', review: { issues: ['Generate content to run automatic evidence checks.'] } }
    res.status(201).json(await repository.studioPut(uid, 'package', id, value, 0))
  })
  router.param('id', async (req, _res, next, id) => {
    // Public article lookup also has :id, and must not read private packages.
    if (!req.identity) return next()
    const value = await repository.studioGet(req.identity.uid, 'package', id)
    if (!value) return next(fail(404, 'Content package not found'))
    req.package = value; next()
  })
  router.get('/packages/:id', (req, res) => res.json(req.package))
  router.get('/packages/:id/history', async (req, res) => res.json({ revisions: await repository.studioHistory(req.identity.uid, 'package', req.params.id) }))
  router.patch('/packages/:id', async (req, res) => {
    const input = patchSchema.parse(req.body); const current = req.package
    if (current.status === 'generating') throw fail(409, 'Generation is in progress; wait before editing')
    const content = input.content || current.content; const review = reviewContent(content, current.evidence)
    if (input.editorialStatus === 'approved') await requireCurrentLibrary(req.identity.uid, current)
    if (input.editorialStatus === 'approved' && review.issues.length) throw fail(422, 'Resolve evidence review issues before approving')
    res.json(await repository.studioPut(req.identity.uid, 'package', current.id, { ...current, content, review, editorialStatus: input.editorialStatus || 'needs_review' }, input.revision))
  })
  router.post('/packages/:id/review', async (req, res) => {
    const current = req.package
    if (current.status === 'generating') throw fail(409, 'Generation is in progress')
    res.json(await repository.studioPut(req.identity.uid, 'package', current.id, { ...current, review: reviewContent(current.content, current.evidence), editorialStatus: 'needs_review' }, current.revision))
  })
  router.post('/packages/:id/refresh-evidence', async (req, res) => {
    const current = req.package
    if (current.status === 'generating') throw fail(409, 'Generation is in progress')
    let evidence
    try { evidence = await Promise.all(current.evidence.map(async item => ({ ...await fetchSource(item.url), id: item.id }))) } catch { throw fail(422, 'Source refresh failed. Existing evidence was preserved.') }
    const changed = evidence.some((item, index) => item.hash !== current.evidence[index].hash)
    // Keep snapshots intact; public reads compare them with the latest fetched evidence.
    await repository.studioPut('public', 'publication_state', lineageId(req.identity.uid, current.id), { evidenceHash: evidenceHash(evidence), checkedAt: new Date().toISOString() })
    res.json(await repository.studioPut(req.identity.uid, 'package', current.id, { ...current, evidence, editorialStatus: changed ? 'needs_review' : current.editorialStatus, evidenceChanged: changed, review: changed ? { issues: ['Source text changed. Review or regenerate content before approving again.'] } : current.review }, current.revision))
  })
  router.post('/packages/:id/publish', requireAdmin, async (req, res) => {
    const current = req.package
    await requireCurrentLibrary(req.identity.uid, current)
    if (current.editorialStatus !== 'approved' || reviewContent(current.content, current.evidence).issues.length) throw fail(422, 'Approve a complete, reviewed package before publishing')
    const id = createHash('sha256').update(`${req.identity.uid}:${current.id}:${current.revision}`).digest('hex').slice(0, 32)
    const existing = await repository.studioGet('public', 'publication', id)
    if (existing) return res.json(existing)
    const evidence = current.evidence.map(({ id: evidenceId, url, title, publisher, publishedAt, retrievedAt, type, limitations }) => ({ id: evidenceId, url, title, publisher, publishedAt, retrievedAt, type, limitations }))
    res.status(201).json(await repository.studioPut('public', 'publication', id, { title: current.content.website.title, body: current.content.website.body, evidence, claims: current.content.claims, publishedAt: new Date().toISOString(), sourceRevision: current.revision, lineageId: lineageId(req.identity.uid, current.id), evidenceHash: evidenceHash(current.evidence) }, 0))
  })
  router.post('/packages/:id/generate', async (req, res) => {
    const input = z.object({ requestId, instruction: z.string().trim().max(2000).optional() }).strict().parse(req.body); const current = req.package; const uid = req.identity.uid
    await requireCurrentLibrary(uid, current)
    if (!env.OPENROUTER_API_KEY && generate === generateContent) throw fail(503, 'Content generation is not configured yet')
    if (!current.evidence.some(item => item.excerpt.length >= 100)) throw fail(422, 'Insufficient source evidence. Create a package from the original article URL.')
    if (current.status === 'generating' && Date.now() - Date.parse(current.updatedAt) < 120000) throw fail(409, 'Generation already in progress')
    const reservation = await repository.studioReserve(uid, `${current.id}:${input.requestId}`, env.STUDIO_DAILY_GENERATIONS)
    if (!reservation.reserved) return res.json(current)
    const running = await repository.studioPut(uid, 'package', current.id, { ...current, status: 'generating', error: null }, current.revision)
    try {
      const content = await generate(current.evidence, current.settings, { ...current.researchContext, revisionInstruction: input.instruction || null, previousContent: input.instruction ? current.content : null })
      const review = reviewContent(content, current.evidence)
      if (review.issues.length) throw new Error('Evidence validation failed')
      res.json(await repository.studioPut(uid, 'package', current.id, { ...running, content, review, status: 'completed', editorialStatus: 'needs_review' }, running.revision))
    } catch (error) {
      console.error(JSON.stringify({ event: 'studio_generation_failed', type: error instanceof z.ZodError ? 'schema' : error instanceof SyntaxError ? 'json' : 'provider_or_evidence', code: error.code === 'EVIDENCE_VALIDATION' ? error.code : null, status: Number.isInteger(error.status) ? error.status : null, issueCount: error.issueCount || null }))
      const failed = await repository.studioPut(uid, 'package', current.id, { ...running, status: 'failed', error: 'Generation failed or returned unsupported content. Existing content was preserved. Retry with a new request.' }, running.revision)
      res.status(502).json({ ...failed, error: failed.error })
    }
  })
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid studio request', details: error.issues.map(item => ({ path: item.path.join('.'), message: item.message })) })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'This draft changed. Reload the latest revision before saving.' })
    if (error.code === 'STUDIO_QUOTA') return res.status(429).json({ error: 'Daily content generation limit reached.' })
    if (error.publicMessage) return res.status(error.status).json({ error: error.publicMessage })
    next(error)
  })
  return router
}
