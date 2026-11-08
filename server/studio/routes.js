import { runContentJob, cancelContentJob, recoverRejectedGeneration } from './job-worker.js'
import { reserveFreeOperation } from '../budget/free-operation.js'
import { Router } from 'express'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { articleEvidence, fetchEvidence } from './evidence.js'
import { contentSchema, settingsSchema, generateContent, reviewContent } from './content.js'
import { createLibraryRouter } from './library.js'
import { requireAdmin } from '../auth/firebase.js'
import { intelligenceRouter } from './intelligence.js'
import { assertCapability, capabilityAllowed } from '../policy.js'
import { contentHash, independentlyReviewed, approvedVersion, contributors } from './approval.js'
import { workspaceRouter, workspaceAuth, requireWriteRole, ownerScope, workspaceRole } from './workspaces.js'
import { planningRouter } from './planning.js'
import { categoryImageAssets } from './category-images.js'
import { vertexFallbackAllowed } from '../providers/vertex-fallback.js'
import { findAlternativeEvidence } from './alternative-evidence.js'
import { ratingsSchema, assessQuality, finalizationPolicy } from './finalization.js'

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/)
const createSchema = z.object({ reuseExisting: z.boolean().optional(), articleId: z.string().max(100).optional(), sourceUrl: z.string().url().max(2000).optional(), sourceIds: z.array(z.string().max(100)).min(1).max(5).optional(), researchId: z.string().max(100).optional(), opportunityIndex: z.number().int().min(0).max(11).optional(), settings: settingsSchema.optional(), requestId }).strict().refine(value => [value.articleId, value.sourceUrl, value.sourceIds, value.researchId].filter(Boolean).length === 1)
const patchSchema = z.object({ revision: z.number().int().min(1), content: contentSchema.optional(), settings: settingsSchema.optional(), editorialStatus: z.enum(['draft', 'needs_review', 'approved']).optional() }).strict()
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message })
const lineageId = (uid, id) => createHash('sha256').update(`${uid}:${id}`).digest('hex')
const evidenceHash = evidence => createHash('sha256').update(JSON.stringify(evidence.map(item => item.hash))).digest('hex')

export function studioRouter({ repository, auth, generate = generateContent, fetchSource = fetchEvidence, findAlternatives = findAlternativeEvidence, dispatchMode = 'queue', onResearchAdmitted, onGenerationAdmitted }) {
  const router = Router()
  router.use('/category-images', categoryImageAssets(repository))
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
  const requireCurrentApproval = async (uid, value) => {
    if (value.reviewerId === uid) throw fail(422, 'The content owner cannot independently review this package')
    if (!independentlyReviewed(value)) throw fail(422, 'A current independent review of this exact version is required. Reviews expire after 24 hours; recheck sources before reviewing again.')
    if (uid.startsWith('ws:') && !['owner', 'editor', 'reviewer'].includes(await workspaceRole(repository, uid, value.reviewerId))) throw fail(422, 'The reviewer no longer has workspace access. Assign a current reviewer.')
    if (uid.startsWith('ws:') && value.approval && !['owner', 'editor'].includes(await workspaceRole(repository, uid, value.approval.approvedBy))) throw fail(422, 'The person who approved this content no longer has editing access. Approve it again.')
  }
  router.use('/workspaces', workspaceRouter({ repository, auth }))
  router.use('/library', createLibraryRouter({ repository, auth, fetchSource }))
  router.use('/planning', planningRouter({ repository, auth }))
  router.use('/intelligence', intelligenceRouter({ repository, auth, onResearchAdmitted }))
  router.get('/config', (_req, res) => res.json({ finalizationPolicy, industries: ['AI', 'Technology', 'Finance', 'Healthcare', 'Education', 'Custom'], capabilities: { generation: capabilityAllowed('generation') && Boolean(env.OPENROUTER_API_KEY), research: capabilityAllowed('research') && Boolean(env.OPENROUTER_API_KEY), media: false, publishing: false, researchScheduling: false, vertexFallback: vertexFallbackAllowed() }, dailyGenerationLimit: env.STUDIO_DAILY_GENERATIONS, creditCoverage: 'unconfirmed', paidBudget: vertexFallbackAllowed() ? null : 0 }))
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
  router.use(workspaceAuth(repository, auth), (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  async function assignedReview(req) {
    const value = await repository.studioGet(req.params.owner, 'package', req.params.packageId)
    if (!value || value.reviewerId !== req.identity.uid || (value.generatedBy || value.createdBy || req.params.owner) === req.identity.uid) throw fail(404, 'Assigned review not found')
    if (contributors(value).includes(req.identity.uid)) throw fail(403, 'A content contributor cannot independently review this package')
    if (req.params.owner.startsWith('ws:') && !['owner', 'editor', 'reviewer'].includes(await workspaceRole(repository, req.params.owner, req.identity.uid))) throw fail(404, 'Assigned review not found')
    return value
  }
  router.get('/reviews/:owner/:packageId', async (req, res) => res.json(await assignedReview(req)))
  router.post('/reviews/:owner/:packageId', async (req, res) => {
    const input = z.object({ revision: z.number().int().positive(), claims: z.array(z.object({ id: z.string(), supported: z.literal(true), note: z.string().trim().min(10).max(1000) }).strict()).min(1).max(50), rightsConfirmed: z.literal(true), promiseAligned: z.literal(true), freshnessConfirmed: z.literal(true), contradictionsResolved: z.literal(true), accessibilityConfirmed: z.literal(true), scopeConfirmed: z.literal(true), ratings: ratingsSchema }).strict().parse(req.body)
    const current = await assignedReview(req)
    if (input.revision !== current.revision) throw fail(409, 'Review version changed')
    if (current.status === 'generating' || !current.content) throw fail(409, 'Content is not ready for review')
    const ids = input.claims.map(claim => claim.id)
    if (new Set(ids).size !== ids.length || current.content.claims.length !== ids.length || current.content.claims.some(claim => !ids.includes(claim.id))) throw fail(422, 'Review every claim exactly once')
    if (reviewContent(current.content, current.evidence, current.settings).issues.length) throw fail(422, 'Resolve citation and output issues before independent review')
    const { ratings, ...attestations } = input
    const quality = assessQuality(ratings, current.evidence)
    if (!quality) throw fail(422, 'Each rating must cite sources attached to this version')
    const reviewedAt = Date.now()
    const independentReview = { ...attestations, quality, status: quality.eligible ? 'passed' : 'needs_revision', reviewerId: req.identity.uid, contentHash: contentHash(current), reviewedAt: new Date(reviewedAt).toISOString(), expiresAt: new Date(reviewedAt + 86400000).toISOString(), method: 'independent-human' }
    res.json(await repository.studioPut(req.params.owner, 'package', current.id, { ...current, independentReview, editorialStatus: 'needs_review', approval: null }, current.revision))
  })
  router.use(requireWriteRole)
  router.get('/usage', async (req, res) => {
    if (req.workspace.role !== 'owner') throw fail(403, 'Workspace owner access is required to view usage')
    const uid = ownerScope(req)
    const [budget, packages, researchStates] = await Promise.all([repository.budgetSummary(uid, 'USD'), repository.studioList(uid, 'package'), repository.studioList(uid, 'research_state')])
    const ids = [...new Set([...packages, ...researchStates].map(item => item.jobId).filter(Boolean))].slice(0, 100)
    const jobs = (await Promise.all(ids.map(id => repository.studioJobGet(uid, id)))).filter(Boolean).map(job => ({ id: job.id, operation: job.scope.operation, status: job.status, createdAt: job.createdAt, error: job.error }))
    res.json({ budget, capabilities: { generation: capabilityAllowed('generation') && Boolean(env.OPENROUTER_API_KEY), research: capabilityAllowed('research') && Boolean(env.OPENROUTER_API_KEY), paid: vertexFallbackAllowed() && budget.limitMicros > 0 }, jobs })
  })
  router.get('/profile', async (req, res) => res.json(await repository.studioGet(ownerScope(req), 'profile', 'default') || settingsSchema.parse({})))
  router.put('/profile', async (req, res) => res.json(await repository.studioPut(ownerScope(req), 'profile', 'default', settingsSchema.parse(req.body))))
  router.get('/packages', async (req, res) => res.json({ packages: await repository.studioList(ownerScope(req), 'package') }))
  router.post('/packages', async (req, res) => {
    const input = createSchema.parse(req.body); const uid = ownerScope(req)
    const reuseTopic = input.reuseExisting && input.researchId
    const id = createHash('sha256').update(reuseTopic ? `topic:${input.researchId}:${input.opportunityIndex ?? 0}` : input.requestId).digest('hex').slice(0, 32)
    const existing = await repository.studioGet(uid, 'package', id)
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    if (existing) {
      if (!reuseTopic && existing.requestHash !== requestHash) throw fail(409, 'This request identifier belongs to different inputs. Use a new identifier.')
      return res.json(existing)
    }
    let evidence; let researchContext = null; let researchedSettings
    if (input.researchId) {
      const report = await repository.studioGet(uid, 'research', input.researchId)
      const opportunity = report?.opportunities[input.opportunityIndex ?? 0]
      if (!opportunity) throw fail(404, 'Research opportunity not found')
      if (reuseTopic) {
        const previous = (await repository.studioList(uid, 'package')).find(pack => pack.researchId === input.researchId && (pack.opportunityIndex === (input.opportunityIndex ?? 0) || (pack.opportunityIndex == null && pack.researchContext?.opportunity?.title === opportunity.title)))
        if (previous) return res.json(previous)
      }
      const ids = new Set([...opportunity.evidenceIds, ...opportunity.positive.flatMap(item => item.evidenceIds), ...opportunity.negative.flatMap(item => item.evidenceIds), ...opportunity.audienceReaction.evidenceIds])
      evidence = report.evidence.filter(item => ids.has(item.id))
      researchContext = { brief: report.niche.brief, opportunity, researchedAt: report.researchedAt, methodology: report.methodology }
      researchedSettings = settingsSchema.parse({ industry: report.niche.name, audience: report.niche.audience || 'Infer from the brief', language: report.niche.language, voice: report.niche.voice, tone: report.niche.tone, platform: 'Instagram', duration: report.niche.duration, outputs: ['captions', 'platforms'] })
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
    const value = { title: researchContext?.opportunity.title || evidence[0].title, articleId: input.articleId || null, sourceIds: input.sourceIds || [], researchId: input.researchId || null, opportunityIndex: input.researchId ? (input.opportunityIndex ?? 0) : null, researchContext, settings, evidence, content: null, status: 'draft', editorialStatus: 'draft', review: { issues: ['Generate content to run automatic evidence checks.'] } }
    try {
      res.status(201).json(await repository.studioPut(uid, 'package', id, { ...value, requestHash, createdBy: req.identity.uid, contributorUids: [req.identity.uid] }, 0))
    } catch (error) {
      if (!reuseTopic || error.code !== 'STUDIO_CONFLICT') throw error
      const concurrent = await repository.studioGet(uid, 'package', id)
      if (!concurrent) throw error
      res.json(concurrent)
    }
  })
  router.param('id', async (req, _res, next, id) => {
    // Public article lookup also has :id, and must not read private packages.
    if (!req.identity) return next()
    const value = await repository.studioGet(ownerScope(req), 'package', id)
    if (!value) return next(fail(404, 'Content package not found'))
    req.package = value; next()
  })
  router.get('/packages/:id', (req, res) => res.json(req.package))
  router.post('/packages/:id/prepare-sources', async (req, res) => {
    const current = req.package; const uid = ownerScope(req)
    if (!current.researchId || current.content || current.jobId || current.status !== 'draft') return res.json(current)
    if (current.evidence.some(source => source.excerpt.trim().length >= 100)) return res.json(current)
    const evidence = await Promise.all(current.evidence.map(async source => {
      try {
        const fetched = await fetchSource(source.url)
        if (fetched.excerpt.trim().length < 100) return source
        return { ...fetched, id: source.id, publishedAt: source.publishedAt || fetched.publishedAt, type: 'retrieved-publisher-article', limitations: ['Retrieved publisher text; independent corroboration has not been established.'], discoveryUrl: source.url }
      } catch { return source }
    }))
    if (!evidence.some(source => source.excerpt.trim().length >= 100)) {
      const alternatives = await findAlternatives(current, { fetchSource }).catch(() => [])
      const ids = new Set(evidence.map(source => source.id)); let number = 1
      for (const source of alternatives.slice(0, Math.max(0, 12 - evidence.length))) {
        while (ids.has(`E${number}`)) number++
        evidence.push({ ...source, id: `E${number}` }); ids.add(`E${number}`)
      }
    }
    if (!evidence.some(source => source.excerpt.trim().length >= 100)) throw fail(422, 'The original article is unavailable, and we could not retrieve a matching article from a trusted publisher. Your idea is saved. Retry the automatic search later or choose another idea; no AI generation has started.')
    if (!['owner', 'editor'].includes(await workspaceRole(repository, uid, req.identity.uid))) throw fail(403, 'Workspace access changed before saving evidence')
    try {
      res.json(await repository.studioPut(uid, 'package', current.id, { ...current, evidence }, current.revision))
    } catch (error) {
      if (error.code !== 'STUDIO_CONFLICT') throw error
      res.json(await repository.studioGet(uid, 'package', current.id))
    }
  })
  router.get('/packages/:id/history', async (req, res) => res.json({ revisions: await repository.studioHistory(ownerScope(req), 'package', req.params.id) }))
  router.post('/packages/:id/sources', async (req, res) => {
    const input = z.object({ revision: z.number().int().positive(), sourceUrl: z.string().url().max(2000) }).strict().parse(req.body)
    const current = req.package; const uid = ownerScope(req)
    if (current.revision !== input.revision) throw fail(409, 'Package version changed')
    if (current.status !== 'draft' || current.content || current.jobId) throw fail(409, 'Add evidence only to an ungenerated draft')
    if (current.sourceIds?.length) throw fail(422, 'Library packages must use their approved library sources')
    if (current.evidence.length >= 12) throw fail(422, 'A package can contain at most twelve evidence sources')
    let source
    try { source = await fetchSource(input.sourceUrl) } catch { throw fail(422, 'Source could not be retrieved. Use an accessible public HTTPS article with readable text.') }
    if (!source?.excerpt || source.excerpt.trim().length < 100) throw fail(422, 'Source did not provide enough readable evidence')
    if (current.evidence.some(item => item.url === source.url)) throw fail(422, 'This source is already attached')
    if (!['owner', 'editor'].includes(await workspaceRole(repository, uid, req.identity.uid))) throw fail(403, 'Workspace access changed before saving evidence')
    const ids = new Set(current.evidence.map(item => item.id)); let number = 1
    while (ids.has(`E${number}`)) number++
    const evidence = [...current.evidence, { ...source, id: `E${number}` }]
    res.json(await repository.studioPut(uid, 'package', current.id, { ...current, evidence, contributorUids: [...new Set([...contributors(current), req.identity.uid])], independentReview: null, approval: null, editorialStatus: 'draft', review: { issues: ['Generate content to run automatic evidence checks.'] } }, current.revision))
  })
  router.post('/packages/:id/assign-reviewer', async (req, res) => {
    const input = z.object({ revision: z.number().int().positive(), reviewerId: z.string().trim().min(1).max(128) }).strict().parse(req.body)
    if (input.revision !== req.package.revision) throw fail(409, 'Package version changed')
    if (input.reviewerId === req.identity.uid || input.reviewerId === (req.package.generatedBy || req.package.createdBy)) throw fail(422, 'Select a different person for independent review')
    if (contributors(req.package).includes(input.reviewerId)) throw fail(422, 'Select a reviewer who has not contributed to this package')
    if (ownerScope(req).startsWith('ws:') && !['owner', 'editor', 'reviewer'].includes(await workspaceRole(repository, ownerScope(req), input.reviewerId))) throw fail(422, 'Reviewer must be an active workspace member with a review-capable role')
    if (req.package.status === 'generating') throw fail(409, 'Generation is in progress')
    res.json(await repository.studioPut(ownerScope(req), 'package', req.package.id, { ...req.package, reviewerId: input.reviewerId, independentReview: null, approval: null, editorialStatus: 'needs_review' }, input.revision))
  })
  router.get('/packages/:id/export', async (req, res) => {
    const current = req.package
    await requireCurrentLibrary(ownerScope(req), current)
    if (!approvedVersion(current) || reviewContent(current.content, current.evidence, current.settings).issues.length) throw fail(409, 'Save valid content and confirm this version before downloading.')
    await requireCurrentApproval(ownerScope(req), current)
    res.json({ manifest: { scope: 'text-package', mediaVerification: 'Production directions are not verification of rendered media or publishing readiness.', packageId: current.id, revision: current.revision, contentHash: contentHash(current), approvedAt: current.approval.approvedAt, approvedBy: current.approval.approvedBy, approvalMethod: current.approval.method, reviewerId: current.reviewerId, quality: current.independentReview.quality, exportedAt: new Date().toISOString(), sources: current.evidence.map(({ id, url, retrievedAt, hash }) => ({ id, url, retrievedAt, hash })) }, package: current })
  })
  router.patch('/packages/:id', async (req, res) => {
    const input = patchSchema.parse(req.body); const current = req.package
    if (input.revision !== current.revision) throw fail(409, 'Package version changed')
    if (current.status === 'generating') throw fail(409, 'Generation is in progress; wait before editing')
    const content = input.content || current.content; const settings = input.settings || current.settings
    const review = reviewContent(content, current.evidence, settings)
    const changed = Boolean(input.content || input.settings)
    if (input.editorialStatus === 'approved') await requireCurrentLibrary(ownerScope(req), current)
    if (input.editorialStatus === 'approved' && review.issues.length) throw fail(422, 'Resolve evidence review issues before approving')
    if (input.editorialStatus === 'approved' && changed) throw fail(422, 'Save your edits before confirming the current content.')
    if (input.editorialStatus === 'approved') {
      await requireCurrentApproval(ownerScope(req), { ...current, approval: null })
      if (req.identity.uid === current.reviewerId) throw fail(422, 'A different owner or editor must approve the independently reviewed version')
    }
    const approval = input.editorialStatus === 'approved' ? { contentHash: contentHash(current), approvedAt: new Date().toISOString(), approvedBy: req.identity.uid, method: 'independent-human' } : null
    res.json(await repository.studioPut(ownerScope(req), 'package', current.id, { ...current, content, settings, review, contributorUids: changed ? [...new Set([...contributors(current), req.identity.uid])] : contributors(current), independentReview: changed ? null : current.independentReview, approval, editorialStatus: content ? (input.editorialStatus || 'needs_review') : 'draft' }, current.revision))
  })
  router.post('/packages/:id/review', async (req, res) => {
    const current = req.package
    if (current.status === 'generating') throw fail(409, 'Generation is in progress')
    res.json(await repository.studioPut(ownerScope(req), 'package', current.id, { ...current, review: reviewContent(current.content, current.evidence), editorialStatus: 'needs_review' }, current.revision))
  })
  router.post('/packages/:id/refresh-evidence', async (req, res) => {
    z.object({ confirmed: z.literal(true) }).strict().parse(req.body)
    const current = req.package
    if (current.status === 'generating') throw fail(409, 'Generation is in progress')
    let evidence
    try { evidence = await Promise.all(current.evidence.map(async item => ({ ...await fetchSource(item.url), id: item.id }))) } catch { throw fail(422, 'Source refresh failed. Existing evidence was preserved.') }
    const changed = evidence.some((item, index) => item.hash !== current.evidence[index].hash)
    const versionChanged = contentHash({ ...current, evidence }) !== contentHash(current)
    // Keep snapshots intact; public reads compare them with the latest fetched evidence.
    await repository.studioPut('public', 'publication_state', lineageId(ownerScope(req), current.id), { evidenceHash: evidenceHash(evidence), checkedAt: new Date().toISOString() })
    res.json(await repository.studioPut(ownerScope(req), 'package', current.id, { ...current, evidence, editorialStatus: versionChanged ? 'needs_review' : current.editorialStatus, independentReview: versionChanged ? null : current.independentReview, approval: versionChanged ? null : current.approval, evidenceChanged: changed, review: changed ? { issues: ['Source text changed. Review or regenerate content before approving again.'] } : current.review }, current.revision))
  })
  router.post('/packages/:id/publish', requireAdmin, async (req, res) => {
    assertCapability('publishing')
    const current = req.package
    if (!current.content?.website) throw fail(422, 'This package does not contain website content')
    await requireCurrentLibrary(ownerScope(req), current)
    if (!approvedVersion(current) || reviewContent(current.content, current.evidence, current.settings).issues.length) throw fail(422, 'Approve a complete, reviewed package before publishing')
    await requireCurrentApproval(ownerScope(req), current)
    const id = createHash('sha256').update(`${ownerScope(req)}:${current.id}:${current.revision}`).digest('hex').slice(0, 32)
    const existing = await repository.studioGet('public', 'publication', id)
    if (existing) return res.json(existing)
    const evidence = current.evidence.map(({ id: evidenceId, url, title, publisher, publishedAt, retrievedAt, type, limitations }) => ({ id: evidenceId, url, title, publisher, publishedAt, retrievedAt, type, limitations }))
    res.status(201).json(await repository.studioPut('public', 'publication', id, { title: current.content.website.title, body: current.content.website.body, evidence, claims: current.content.claims, publishedAt: new Date().toISOString(), sourceRevision: current.revision, lineageId: lineageId(ownerScope(req), current.id), evidenceHash: evidenceHash(current.evidence) }, 0))
  })
  router.get('/jobs/:requestId', async (req, res) => {
    const job = await repository.studioJobGet(ownerScope(req), req.params.requestId)
    if (!job) throw fail(404, 'Job not found')
    res.json(job)
  })
  router.post('/jobs/:requestId/cancel', async (req, res) => res.json(await cancelContentJob({ repository, uid: ownerScope(req), requestId: req.params.requestId })))
  router.post('/packages/:id/recover-generation', async (req, res) => {
    const { revision, acknowledgeTimeoutCost } = z.object({ revision: z.number().int().positive(), acknowledgeTimeoutCost: z.boolean().optional() }).strict().parse(req.body)
    res.json(await recoverRejectedGeneration({ repository, uid: ownerScope(req), packageId: req.params.id, revision, acknowledgeTimeoutCost }))
  })
  router.post('/packages/:id/generate', async (req, res) => {
    const input = z.object({ requestId, revision: z.number().int().positive(), confirmed: z.literal(true), instruction: z.string().trim().max(2000).optional() }).strict().parse(req.body)
    const current = req.package; const uid = ownerScope(req)
    const previous = await repository.studioJobGet(uid, input.requestId)
    if (previous) {
      const prior = previous.scope
      if (prior.operation !== 'generation' || prior.packageId !== current.id || prior.revision !== input.revision || prior.instruction !== (input.instruction || '') || prior.actorUid !== req.identity.uid) throw fail(409, 'Request identifier belongs to different inputs')
      return res.status(previous.status === 'completed' ? 200 : 202).json(previous.result || { ...current, jobId: previous.id, jobStatus: previous.status })
    }
    if (current.revision !== input.revision) throw fail(409, 'The package changed. Review the latest version before generating.')
    if (current.jobId) {
      const active = await repository.studioJobGet(uid, current.jobId)
      if (!active || ['reserved', 'running', 'dispatch_unknown'].includes(active.status)) throw fail(409, 'Previous job needs reconciliation before another dispatch.')
    }
    if (current.status === 'generating' || current.status === 'dispatch_unknown') throw fail(409, 'Previous dispatch needs reconciliation; do not retry with a new request.')
    await requireCurrentLibrary(uid, current)
    if (generate === generateContent) assertCapability('generation')
    if (dispatchMode === 'inline' && generate === generateContent) throw fail(503, 'Inline dispatch is available only with an injected test provider')
    if (!current.evidence.some(item => item.excerpt.length >= 100)) throw fail(422, 'Insufficient source evidence. Create a package from the original article URL.')
    const priorFailure = current.jobId && await repository.studioJobGet(uid, current.jobId)
    const generationProvider = vertexFallbackAllowed() && priorFailure?.status === 'failed' && (priorFailure.scope?.generationProvider === 'vertex-fallback' || /"code":"(?:MODEL_|EVIDENCE_VALIDATION)/.test(priorFailure.error || '')) ? 'vertex-fallback' : 'free'
    const scope = { packageId: current.id, revision: input.revision, instruction: input.instruction || '', operation: 'generation', actorUid: req.identity.uid, contentHash: contentHash(current), generationProvider }
    const scopeHash = createHash('sha256').update(JSON.stringify(scope)).digest('hex')
    const reservation = await repository.studioJobReserve(uid, input.requestId, scopeHash, env.STUDIO_DAILY_GENERATIONS, scope)
    if (!reservation.reserved) return res.status(202).json({ ...current, jobId: reservation.job.id, jobStatus: reservation.job.status })
    const job = reservation.job; let queued; let cost
    try {
      cost = await reserveFreeOperation(repository, uid, input.requestId, scope)
      queued = await repository.studioPut(uid, 'package', current.id, { ...current, generatedBy: req.identity.uid, contributorUids: [...new Set([...(current.contributorUids || []), req.identity.uid])], status: 'generating', jobId: job.id, error: null, independentReview: null, approval: null, editorialStatus: 'needs_review' }, current.revision)
      await repository.studioJobUpdate(uid, job.id, { status: 'reserved', ready: true }, job.revision, 'reserved')
    } catch (error) {
      if (cost?.status === 'reserved') await repository.budgetTransition(uid, cost.id, cost.revision, 'cancel')
      await repository.studioJobUpdate(uid, job.id, { status: 'failed', error: 'Package or budget admission changed before dispatch' }, job.revision, job.status)
      throw error
    }
    if (dispatchMode === 'inline') {
      const outcome = await runContentJob({ repository, uid, requestId: job.id, generate })
      return res.status(outcome.status === 'completed' ? 200 : 502).json(outcome.result || await repository.studioGet(uid, 'package', current.id))
    }
    if (onGenerationAdmitted) {
      try { await onGenerationAdmitted({ uid, requestId: job.id }) }
      catch { console.error(JSON.stringify({ event: 'local_generation_dispatch_unavailable' })) }
    }
    res.status(202).json({ ...queued, jobStatus: 'reserved' })
  })
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid studio request', details: error.issues.map(item => ({ path: item.path.join('.'), message: item.message })) })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'This draft changed. Reload the latest revision before saving.' })
    if (error.code === 'BUDGET_BLOCKED') return res.status(409).json({ error: 'Budget or pricing verification blocked this request. No paid fallback is permitted.' })
    if (error.code === 'STUDIO_QUOTA') return res.status(429).json({ error: 'Daily content generation limit reached.' })
    if (error.publicMessage) return res.status(error.status).json({ error: error.publicMessage })
    next(error)
  })
  return router
}


