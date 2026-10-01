import { Router } from 'express'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { fetchEvidence } from './evidence.js'

const intake = z.object({ url: z.string().url().max(2000), industry: z.string().trim().min(1).max(100) }).strict()
const review = z.object({ revision: z.number().int().min(1), reviewStatus: z.enum(['needs_review', 'approved', 'rejected']) }).strict()

export function createLibraryRouter({ repository, auth, fetchSource = fetchEvidence }) {
  const router = Router()
  router.use(auth, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/sources', async (req, res) => res.json({ sources: await repository.studioList(req.identity.uid, 'library_source') }))
  router.post('/sources', async (req, res) => {
    const input = intake.parse(req.body)
    let evidence
    try { evidence = await fetchSource(input.url) } catch { return res.status(422).json({ error: 'Source could not be retrieved. Use an accessible public HTTPS article with readable text.' }) }
    const id = createHash('sha256').update(`${input.industry.toLowerCase()}\n${evidence.url}`).digest('hex').slice(0, 32)
    const current = await repository.studioGet(req.identity.uid, 'library_source', id)
    const unchanged = current && current.evidence.hash === evidence.hash
    const value = { industry: input.industry, evidence, reviewStatus: unchanged ? current.reviewStatus : 'needs_review', reviewedAt: unchanged ? current.reviewedAt : null,
      reviewBasis: 'Personal editorial source selection; approval does not independently verify its claims.' }
    const saved = await repository.studioPut(req.identity.uid, 'library_source', id, value, current?.revision || 0)
    res.status(current ? 200 : 201).json(saved)
  })
  router.patch('/sources/:id', async (req, res) => {
    const input = review.parse(req.body)
    const current = await repository.studioGet(req.identity.uid, 'library_source', req.params.id)
    if (!current) return res.status(404).json({ error: 'Library source not found' })
    res.json(await repository.studioPut(req.identity.uid, 'library_source', current.id, { ...current, reviewStatus: input.reviewStatus, reviewedAt: new Date().toISOString() }, input.revision))
  })
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid library request' })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'This source changed. Reload before reviewing.' })
    next(error)
  })
  return router
}
