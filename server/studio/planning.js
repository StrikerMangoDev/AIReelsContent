import { workspaceAuth, requireWriteRole, ownerScope } from './workspaces.js'
import { Router } from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { settingsSchema } from './content.js'
import { assessRelease } from './release.js'

const id = z.string().trim().min(1).max(100)
const revision = z.number().int().positive()
const status = z.enum(['idea', 'drafting', 'review', 'ready'])
const planningDate = z.iso.date().nullable()
const template = z.object({ name: z.string().trim().min(1).max(100), settings: settingsSchema }).strict()
const board = z.object({ packageId: id, status: status.default('idea'), planningDate: planningDate.default(null) }).strict()
const fail = (code, message) => Object.assign(new Error(message), { status: code, publicMessage: message })
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 32)

export function planningRouter({ repository, auth }) {
  const router = Router()
  router.use(workspaceAuth(repository, auth), requireWriteRole, (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
  async function owned(uid, kind, key) {
    const value = await repository.studioGet(uid, kind, key)
    if (!value) throw fail(404, 'Saved item not found')
    return value
  }
  async function isReady(uid, pack) {
    return (await assessRelease(repository, uid, pack, { requireApproval: false, policy: 'owner-download' })).eligible
  }
  router.get('/', async (req, res) => {
    const uid = ownerScope(req)
    const [templates, shortlist, cards, reports, packages] = await Promise.all(['template', 'shortlist', 'board', 'research', 'package'].map(kind => repository.studioList(uid, kind)))
    const active = values => values.filter(value => !value.archived)
    const resolvedCards = await Promise.all(active(cards).map(async card => {
      const pack = await repository.studioGet(uid, 'package', card.packageId)
      const ready = pack ? await isReady(uid, pack) : false
      return { ...card, title: pack?.title || 'Package unavailable', platform: pack?.settings?.platform || '', updatedAt: pack?.updatedAt || '', contentStatus: pack?.status || 'unavailable', hasContent: Boolean(pack?.content), status: card.status === 'ready' && !ready ? 'review' : card.status, ready, approvalChanged: card.status === 'ready' && !ready }
    }))
    const plannedPackages = new Set(resolvedCards.map(card => card.packageId))
    const savedIdeas = active(shortlist).map(idea => ({ ...idea, draftId: packages.filter(pack => pack.researchId === idea.reportId && pack.opportunityIndex === idea.index).sort((a, b) => Number(plannedPackages.has(b.id)) - Number(plannedPackages.has(a.id)))[0]?.id })).filter(idea => !idea.draftId || !plannedPackages.has(idea.draftId))
    res.json({ templates: active(templates), shortlist: savedIdeas, board: resolvedCards,
      topics: reports.slice(0, 100).flatMap(report => (Array.isArray(report.opportunities) ? report.opportunities : []).map((topic, index) => ({ reportId: report.id, index, title: topic.title }))),
      packages: packages.slice(0, 100).map(pack => ({ id: pack.id, title: pack.title, revision: pack.revision, settings: pack.settings })), optionsLimit: 100 })
  })
  router.post('/templates', async (req, res) => res.status(201).json(await repository.studioPut(ownerScope(req), 'template', randomUUID(), { ...template.parse(req.body), archived: false }, 0)))
  router.patch('/templates/:id', async (req, res) => {
    const input = template.partial().extend({ revision, archived: z.boolean().optional() }).strict().parse(req.body)
    const current = await owned(ownerScope(req), 'template', req.params.id)
    const { revision: expected, ...changes } = input
    if (expected !== current.revision) throw fail(409, 'This item changed. Reload before editing.')
    res.json(await repository.studioPut(ownerScope(req), 'template', current.id, { ...current, ...changes }, current.revision))
  })
  router.post('/shortlist', async (req, res) => {
    const input = z.object({ reportId: id, index: z.number().int().min(0).max(11) }).strict().parse(req.body)
    const report = await owned(ownerScope(req), 'research', input.reportId)
    const topic = report.opportunities?.[input.index]
    if (!topic) throw fail(422, 'Choose a saved topic from this report')
    const key = digest(`${input.reportId}:${input.index}`)
    const current = await repository.studioGet(ownerScope(req), 'shortlist', key)
    if (current && !current.archived) return res.json(current)
    res.status(201).json(await repository.studioPut(ownerScope(req), 'shortlist', key, { ...input, title: topic.title, archived: false }, current?.revision || 0))
  })
  router.patch('/shortlist/:id', async (req, res) => {
    const input = z.object({ revision, archived: z.boolean() }).strict().parse(req.body)
    const current = await owned(ownerScope(req), 'shortlist', req.params.id)
    if (input.revision !== current.revision) throw fail(409, 'This item changed. Reload before editing.')
    res.json(await repository.studioPut(ownerScope(req), 'shortlist', current.id, { ...current, archived: input.archived }, current.revision))
  })
  router.post('/board', async (req, res) => {
    const input = board.parse(req.body)
    const pack = await owned(ownerScope(req), 'package', input.packageId)
    if (input.status === 'ready' && !await isReady(ownerScope(req), pack)) throw fail(422, 'Save valid content and resolve source checks in Content Studio before marking it Ready')
    const key = digest(input.packageId)
    const current = await repository.studioGet(ownerScope(req), 'board', key)
    if (current && !current.archived) return res.json(current)
    res.status(201).json(await repository.studioPut(ownerScope(req), 'board', key, { ...input, archived: false }, current?.revision || 0))
  })
  router.patch('/board/:id', async (req, res) => {
    const input = z.object({ revision, status: status.optional(), planningDate: planningDate.optional(), archived: z.boolean().optional() }).strict().parse(req.body)
    const current = await owned(ownerScope(req), 'board', req.params.id)
    const { revision: expected, ...changes } = input
    if (expected !== current.revision) throw fail(409, 'This item changed. Reload before editing.')
    const pack = await owned(ownerScope(req), 'package', current.packageId)
    const next = { ...current, ...changes }
    if (!next.archived && next.status === 'ready' && !await isReady(ownerScope(req), pack)) throw fail(422, 'Save valid content and resolve source checks in Content Studio before marking it Ready')
    res.json(await repository.studioPut(ownerScope(req), 'board', current.id, next, current.revision))
  })
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Check the planning fields. Templates accept content preferences only.' })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'This item changed. Reload before editing.' })
    if (error.publicMessage) return res.status(error.status).json({ error: error.publicMessage })
    next(error)
  })
  return router
}
