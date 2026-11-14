import { policyReferenceOwner } from './package-rules.js'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { generateJson, generationReceipt, readFreeGenerationReceipt } from '../providers/llm.js'
import { reserveFreeOperation, dispatchFreeOperation } from '../budget/free-operation.js'
import { costScopeHash } from '../budget/policy.js'
import { assertCapability } from '../policy.js'
import { contentHash } from './approval.js'
import { workspaceAuth, requireWriteRole, ownerScope, workspaceRole } from './workspaces.js'
import { assessRelease } from './release.js'
import { buildCompletePackage, completeContextSchema, completeInputHash, analysisRequest, validateAnalysisResult, completePackageVersion } from './complete-package.js'
import { selectedPlatforms } from './content.js'
import { auditSeoPage, seoContextHash } from './seo-workflow.js'

const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message })
const analysisInput = z.object({ requestId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), contextRevision: z.number().int().min(0) }).strict()
const recoveryInput = analysisInput.extend({ acknowledgeUnknownOutcome: z.boolean().default(false) }).strict()
const recoveryScope = z.object({ operation: z.literal('generation'), purpose: z.literal('complete-package-analysis'), packageId: z.string().min(1), actorUid: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/), inputHash: z.string().regex(/^[a-f0-9]{64}$/), contextRevision: z.number().int().min(0), model: z.string().regex(/^nvidia\/[a-z0-9.-]+:free$/) }).strict()

export async function recoverCompleteAnalysis({ repository, owner, actor, pack, input, config = env, readReceipt = readFreeGenerationReceipt }) {
  input = recoveryInput.parse(input)
  const jobId = `complete-analysis:${input.requestId}`
  async function current() {
    if (!['owner', 'editor'].includes(await workspaceRole(repository, owner, actor))) throw fail(403, 'Your workspace access cannot recover this analysis')
    const [latest, analysis, job, cost] = await Promise.all([repository.studioGet(owner, 'package', pack.id), repository.studioGet(owner, 'complete_analysis', pack.id), repository.studioJobGet(owner, jobId), repository.budgetGet(owner, jobId)])
    if (!latest?.content || ['generating', 'dispatch_unknown'].includes(latest.status)) throw fail(409, 'Resolve the current content generation before recovering analysis')
    const complete = await buildCompletePackage(repository, owner, latest)
    const scope = recoveryScope.safeParse(job?.scope)
    if (complete.contentHash !== input.contentHash || complete.contextRevision !== input.contextRevision || !analysis || analysis.requestId !== input.requestId || analysis.jobId !== jobId || analysis.contentHash !== complete.contentHash || analysis.contextRevision !== complete.contextRevision || analysis.inputHash !== complete.inputHash) throw fail(409, 'The saved content, context or analysis attempt changed. Reload before recovering.')
    if (!scope.success || job.id !== jobId || scope.data.packageId !== pack.id || scope.data.model !== analysis.model || scope.data.actorUid !== analysis.requestedBy || scope.data.contentHash !== analysis.contentHash || scope.data.inputHash !== analysis.inputHash || scope.data.contextRevision !== analysis.contextRevision || job.scopeHash !== costScopeHash(scope.data, null)) throw fail(409, 'Only the matching saved free-analysis attempt can be recovered')
    const quote = cost?.quote
    if (!cost || cost.id !== jobId || !['dispatched', 'dispatch_unknown'].includes(cost.status) || quote?.upperBoundMicros !== 0 || quote.priceVersion !== 'enforced-provider-max-price-zero-v1' || quote.currency !== 'USD' || quote.kind !== 'generation' || Object.keys(quote).some(key => !['upperBoundMicros', 'priceVersion', 'currency', 'kind', 'priceExpiresAt'].includes(key)) || cost.scopeHash !== costScopeHash(scope.data, quote)) throw fail(409, 'The original free-analysis budget reservation could not be verified')
    const recovery = job.result?.recovery
    const recovered = recovery?.version === 'complete-analysis-recovery-v1' && recovery.requestId === input.requestId && recovery.contentHash === analysis.contentHash && recovery.inputHash === analysis.inputHash && recovery.contextRevision === analysis.contextRevision && recovery.billingOutcome === 'unknown-reservation-retained' && (recovery.mode === 'acknowledged-unknown' && recovery.acknowledgedUnknownOutcome === true || recovery.mode === 'verified-unusable' && recovery.receipt && recovery.receipt.generationId === analysis.diagnostics?.generationId && recovery.receipt.actualMicros === 0 && ['error', 'length'].includes(recovery.receipt.finishReason))
    if (!(analysis.status === 'dispatch_unknown' && (job.status === 'dispatch_unknown' || job.status === 'failed' && recovered) || analysis.status === 'failed' && job.status === 'failed' && recovered && costScopeHash(analysis.recovery, null) === costScopeHash(recovery, null))) throw fail(409, 'This analysis is not an uncertain attempt awaiting recovery')
    if (!['owner', 'editor'].includes(await workspaceRole(repository, owner, actor))) throw fail(403, 'Your workspace access cannot recover this analysis')
    return { latest, analysis, job, cost, recovery: recovered ? recovery : null }
  }
  const unchanged = (before, after) => before.latest.revision === after.latest.revision && before.analysis.revision === after.analysis.revision && before.job.revision === after.job.revision && before.cost.revision === after.cost.revision
  let state = await current()
  if (state.analysis.status === 'failed') return buildCompletePackage(repository, owner, state.latest)
  let recovery = state.recovery
  if (!recovery) {
    let receipt
    const generationId = state.analysis.diagnostics?.generationId
    if (typeof generationId === 'string' && /^gen-[A-Za-z0-9-]{1,100}$/.test(generationId)) {
      let candidate
      try { candidate = await readReceipt(generationId, { config }) } catch { /* Missing receipts do not establish billing or permit an automatic retry. */ }
      const afterReceipt = await current()
      if (!unchanged(state, afterReceipt)) throw fail(409, 'The saved analysis changed during the receipt check. Reload before continuing.')
      if (candidate && (candidate.generationId !== generationId || candidate.actualMicros !== 0)) throw fail(409, 'The provider receipt does not match this zero-price analysis')
      if (candidate && ['error', 'length'].includes(candidate.finishReason)) receipt = { generationId, actualMicros: 0, finishReason: candidate.finishReason, checkedAt: new Date().toISOString() }
    }
    if (!receipt && !input.acknowledgeUnknownOutcome) throw fail(409, 'No confirmed unusable provider receipt is available. Explicitly acknowledge the unknown outcome before preparing a separate attempt; the original reservation will remain held.')
    recovery = { version: 'complete-analysis-recovery-v1', requestId: input.requestId, contentHash: state.analysis.contentHash, inputHash: state.analysis.inputHash, contextRevision: input.contextRevision, recoveredBy: actor, recoveredAt: new Date().toISOString(), mode: receipt ? 'verified-unusable' : 'acknowledged-unknown', acknowledgedUnknownOutcome: input.acknowledgeUnknownOutcome, billingOutcome: 'unknown-reservation-retained', ...(receipt ? { receipt } : {}) }
  }
  let checked = await current()
  if (!unchanged(state, checked)) throw fail(409, 'The saved analysis changed during recovery. Reload before continuing.')
  if (state.job.status === 'dispatch_unknown') {
    const job = await repository.studioJobUpdate(owner, jobId, { status: 'failed', error: 'No usable analysis was saved. Recovery permits a separate explicit request; the original budget reservation remains held.', result: { ...state.job.result, recovery } }, state.job.revision, 'dispatch_unknown')
    state = { ...state, job, recovery }
    checked = await current()
    if (!unchanged(state, checked)) throw fail(409, 'The saved analysis changed after recovery was recorded. Reload to finish safely.')
  }
  await repository.studioPut(owner, 'complete_analysis', pack.id, { ...state.analysis, status: 'failed', recovery, error: 'The previous attempt was closed without usable decisions. Its original budget reservation remains held. You may request a new analysis explicitly.' }, state.analysis.revision)
  return buildCompletePackage(repository, owner, checked.latest)
}

export async function analyzeCompletePackage({ repository, owner, actor, pack, input, generate = generateJson, config = env }) {
  const outcome = (status, body) => ({ status, body })
    input = analysisInput.parse(input)
    if (!pack.content) throw fail(422, 'Generate and save supported content before requesting production analysis')
    if (['generating', 'dispatch_unknown'].includes(pack.status)) throw fail(409, 'Resolve the current generation before analyzing this package')
    const complete = await buildCompletePackage(repository, owner, pack)
    if (input.contentHash !== complete.contentHash || input.contextRevision !== complete.contextRevision) throw fail(409, 'Content or context changed. Reload before analyzing.')
    if (generate === generateJson) {
      assertCapability('generation', config)
      if (!config.OPENROUTER_API_KEY || !/^nvidia\/[a-z0-9.-]+:free$/.test(config.LLM_MODEL || '')) throw fail(503, 'Configure an allowed free AI provider before analysis')
    }
    const requestId = `complete-analysis:${input.requestId}`
    const scope = { operation: 'generation', purpose: 'complete-package-analysis', packageId: pack.id, actorUid: actor, contentHash: complete.contentHash, inputHash: complete.inputHash, contextRevision: complete.contextRevision, model: config.LLM_MODEL }
    const existingJob = await repository.studioJobGet(owner, requestId)
    if (existingJob) {
      if (existingJob.scopeHash !== costScopeHash(scope, null)) throw fail(409, 'This analysis identifier belongs to different inputs')
      return outcome(['reserved', 'running'].includes(existingJob.status) ? 202 : 200, await buildCompletePackage(repository, owner, pack))
    }
    const active = await repository.studioGet(owner, 'complete_analysis', pack.id)
    if (active && ['reserved', 'running', 'dispatch_unknown'].includes(active.status)) throw fail(409, 'A previous analysis needs completion or reconciliation; no second request was sent')
    const admission = await repository.studioJobReserve(owner, requestId, costScopeHash(scope, null), config.STUDIO_DAILY_GENERATIONS, scope)
    if (!admission.reserved) return outcome(202, await buildCompletePackage(repository, owner, pack))
    let job = admission.job; let cost; let dispatched = false; let received = false
    const checkCurrent = async () => {
      if (!['owner', 'editor'].includes(await workspaceRole(repository, owner, actor))) throw fail(403, 'Workspace access changed before analysis completed')
      const [latestPack, latestContext, currentJob, reservation, currentAccounts, providerSnapshots, policySnapshots, seoAudits] = await Promise.all([repository.studioGet(owner, 'package', pack.id), repository.studioGet(owner, 'complete_context', pack.id), repository.studioJobGet(owner, requestId), repository.budgetGet(owner, requestId), repository.studioList(owner, 'account_profile'), repository.studioList(owner, 'complete_provider_metrics'), repository.studioList(policyReferenceOwner, 'policy_reference'), repository.studioList(owner, 'seo_audit')])
      if (!latestPack || contentHash(latestPack) !== scope.contentHash || completeInputHash(latestPack, latestContext?.context || {}, currentAccounts, new Date(), providerSnapshots, policySnapshots, seoAudits) !== scope.inputHash || (latestContext?.revision || 0) !== scope.contextRevision || config.LLM_MODEL !== scope.model || currentJob?.status !== 'running' || !reservation || reservation.cancellationRequested || !['reserved', 'dispatched'].includes(reservation.status)) throw fail(409, 'Analysis inputs, permission or budget changed; saved content is preserved')
    }
    try {
      cost = await reserveFreeOperation(repository, owner, requestId, scope)
      if (cost.status !== 'reserved') throw fail(409, 'The analysis budget needs reconciliation')
      await repository.studioPut(owner, 'complete_analysis', pack.id, { status: 'running', requestId: input.requestId, jobId: requestId, contentHash: scope.contentHash, inputHash: scope.inputHash, contextRevision: scope.contextRevision, model: scope.model, requestedBy: actor, result: null, error: null }, active?.revision || 0)
      // This operation is executed here; never mark it ready for the content/research worker.
      job = await repository.studioJobUpdate(owner, requestId, { status: 'running' }, job.revision, 'reserved')
      await checkCurrent()
      cost = await dispatchFreeOperation(repository, owner, cost)
      await checkCurrent()
      dispatched = true
      const raw = await generate(analysisRequest(pack, complete.context, complete.analytics, complete.accounts, complete.seoWorkflow.audits), generate === generateJson ? { config } : undefined)
      received = true
      await checkCurrent()
      const result = validateAnalysisResult(raw, pack, complete.context, complete.analytics)
      const currentAnalysis = await repository.studioGet(owner, 'complete_analysis', pack.id)
      if (currentAnalysis?.jobId !== requestId || currentAnalysis.status !== 'running') throw fail(409, 'The saved analysis attempt changed')
      await repository.studioPut(owner, 'complete_analysis', pack.id, { ...currentAnalysis, status: 'completed', generatedAt: new Date().toISOString(), result, providerReceipt: generationReceipt(raw) || null, error: null, billingVerified: false }, currentAnalysis.revision)
      await repository.studioJobUpdate(owner, requestId, { status: 'completed', result: { packageId: pack.id, inputHash: scope.inputHash } }, job.revision, 'running')
      // A max-price-zero dispatch is not an invoice receipt; retain its unresolved monetary record.
      cost = await repository.budgetGet(owner, requestId)
      if (cost?.status === 'dispatched') await repository.budgetTransition(owner, requestId, cost.revision, 'unknown')
      return outcome(200, await buildCompletePackage(repository, owner, await repository.studioGet(owner, 'package', pack.id)))
    } catch (error) {
      const uncertain = dispatched && !received && !(error.code === 'MODEL_HTTP_ERROR' && [400, 401, 403, 404, 429].includes(error.status))
      const status = uncertain ? 'dispatch_unknown' : 'failed'
      const message = uncertain ? 'The AI outcome is uncertain. Reconcile this saved request before requesting another analysis.' : dispatched ? 'The AI analysis did not pass its checks or provider access failed. Saved content is preserved.' : 'Analysis was blocked before provider dispatch. Saved content is preserved.'
      const currentJob = await repository.studioJobGet(owner, requestId)
      if (currentJob?.status === 'completed') return outcome(200, await buildCompletePackage(repository, owner, pack))
      if (currentJob && ['reserved', 'running'].includes(currentJob.status)) await repository.studioJobUpdate(owner, requestId, { status, error: message }, currentJob.revision, currentJob.status)
      const current = await repository.studioGet(owner, 'complete_analysis', pack.id)
      if (current?.jobId === requestId && current.status === 'running') await repository.studioPut(owner, 'complete_analysis', pack.id, { ...current, status, error: message, diagnostics: {
        code: ['MODEL_HTTP_ERROR', 'MODEL_TIMEOUT', 'MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code) ? error.code : received ? 'ANALYSIS_VALIDATION' : 'ANALYSIS_BLOCKED',
        ...(Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? { httpStatus: error.status } : {}),
        ...(typeof error.generationId === 'string' && /^gen-[A-Za-z0-9-]{1,100}$/.test(error.generationId) ? { generationId: error.generationId } : {}),
        ...(['stop', 'length', 'error', 'tool_calls', 'content_filter'].includes(error.finishReason) ? { finishReason: error.finishReason } : {}),
        ...(Number.isInteger(error.transportStatus) && error.transportStatus >= 100 && error.transportStatus <= 599 ? { transportStatus: error.transportStatus } : {}),
        ...(Number.isInteger(error.providerErrorCode) && error.providerErrorCode >= 400 && error.providerErrorCode <= 599 ? { providerErrorCode: error.providerErrorCode } : {}),
      } }, current.revision)
      cost = await repository.budgetGet(owner, requestId)
      if (cost?.status === 'reserved') await repository.budgetTransition(owner, requestId, cost.revision, 'cancel')
      else if (cost?.status === 'dispatched') await repository.budgetTransition(owner, requestId, cost.revision, 'unknown')
      return outcome(error.status === 403 ? 403 : 502, { error: message, completePackage: await buildCompletePackage(repository, owner, await repository.studioGet(owner, 'package', pack.id) || pack) })
    }
}

export function createCompletePackageRouter({ repository, auth, generate = generateJson, assessDownload = assessRelease, config = env, onContextSaved, auditPage = auditSeoPage, readReceipt = readFreeGenerationReceipt }) {
  const router = Router()
  router.use((req, _res, next) => /^\/packages\/[^/]+\/complete-package(?:\/|$)/.test(req.path) ? next() : next('router'))
  router.use(workspaceAuth(repository, auth), requireWriteRole)
  router.param('id', async (req, _res, next, id) => {
    try {
      if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(id)) throw fail(400, 'Invalid package identifier')
      req.completePack = await repository.studioGet(ownerScope(req), 'package', id)
      if (!req.completePack) throw fail(404, 'Content package not found')
      next()
    } catch (error) { next(error) }
  })
  const base = '/packages/:id/complete-package'
  router.get(base, async (req, res) => res.json(await buildCompletePackage(repository, ownerScope(req), req.completePack)))
  router.put(`${base}/context`, async (req, res) => {
    const input = z.object({ expectedRevision: z.number().int().min(0), context: completeContextSchema }).strict().parse(req.body)
    const owner = ownerScope(req)
    if ((input.context.workflow?.destinations || []).some(item => !selectedPlatforms(req.completePack.settings).includes(item.platform))) throw fail(422, 'Configure workflow only for platforms selected in this saved package')
    const [profiles, publications] = await Promise.all([repository.studioList(owner, 'account_profile'), repository.studioList(owner, 'social_publication')])
    if (input.context.accountId && ![...profiles, ...publications].some(item => item.accountId === input.context.accountId)) throw fail(422, 'Choose an account belonging to this workspace')
    for (const account of input.context.platformAccounts || []) if (![...profiles, ...publications].some(item => item.accountId === account.accountId && item.platform === account.platform)) throw fail(422, 'Choose a matching workspace account for each selected platform')
    for (const observation of input.context.metrics || []) {
      if (observation.publicationId) {
        const publication = publications.find(item => item.id === observation.publicationId)
        if (!publication || publication.accountId !== observation.accountId || publication.platform !== observation.platform || publication.providerPostId !== observation.postId) throw fail(422, 'Metric publication does not match this workspace account and post')
      }
    }
    await repository.studioPut(owner, 'complete_context', req.completePack.id, { packageId: req.completePack.id, context: input.context, updatedBy: req.identity.uid }, input.expectedRevision)
    let preparation
    if (onContextSaved) {
      try { preparation = await onContextSaved({ repository, owner, actor: req.identity.uid, pack: req.completePack }) }
      catch { preparation = { status: 'blocked', reason: 'Context was saved, but automatic analysis could not start. Check the saved attempt before retrying.' } }
    }
    res.json({ ...await buildCompletePackage(repository, owner, req.completePack), ...(preparation ? { preparation } : {}) })
  })
  router.post(`${base}/analyze`, async (req, res) => {
    const result = await analyzeCompletePackage({ repository, owner: ownerScope(req), actor: req.identity.uid, pack: req.completePack, input: req.body, generate, config })
    res.status(result.status).json(result.body)
  })
  router.post(`${base}/recover-analysis`, async (req, res) => res.json(await recoverCompleteAnalysis({ repository, owner: ownerScope(req), actor: req.identity.uid, pack: req.completePack, input: req.body, config, readReceipt })))
  router.post(`${base}/seo-audit`, async (req, res) => {
    const input = z.object({ expectedRevision: z.number().int().min(1), pageUrl: z.string().url().max(2000) }).strict().parse(req.body)
    const owner = ownerScope(req)
    const saved = await repository.studioGet(owner, 'complete_context', req.completePack.id)
    if (saved?.revision !== input.expectedRevision) throw fail(409, 'SEO context changed. Save and reload before auditing this page.')
    const workflow = saved.context?.seoWorkflow
    if (!req.completePack.settings.outputs?.includes('website') || !workflow?.enabled || !workflow.siteUrl || !workflow.pages.some(page => page.url === input.pageUrl) || new URL(input.pageUrl).origin !== new URL(workflow.siteUrl).origin) throw fail(422, 'Choose a saved mapped page on this workflow website before auditing.')
    const hash = contentHash(req.completePack)
    const contextHash = seoContextHash(saved.context)
    const auditId = costScopeHash({ packageId: req.completePack.id, pageUrl: input.pageUrl, contentHash: hash, contextHash }, null)
    const previous = await repository.studioGet(owner, 'seo_audit', auditId)
    let result
    try { result = await auditPage(input.pageUrl) }
    catch { throw fail(422, 'The public HTML page could not be audited. Check its URL, access and readable response; no website changes were sent.') }
    if (new URL(result.finalUrl).origin !== new URL(workflow.siteUrl).origin) throw fail(422, 'The page redirected outside the selected website. No owned-page audit was saved.')
    const [latest, currentPack, role] = await Promise.all([repository.studioGet(owner, 'complete_context', req.completePack.id), repository.studioGet(owner, 'package', req.completePack.id), workspaceRole(repository, owner, req.identity.uid)])
    if (!['owner', 'editor'].includes(role)) throw fail(403, 'Workspace access changed during the page audit.')
    if (!currentPack || contentHash(currentPack) !== hash || latest?.revision !== saved.revision || seoContextHash(latest.context) !== contextHash) throw fail(409, 'Saved content or SEO context changed during the audit. Reload before trying again.')
    await repository.studioPut(owner, 'seo_audit', auditId, { ...result, packageId: req.completePack.id, contextRevision: saved.revision, contentHash: hash, contextHash, capturedBy: req.identity.uid }, previous?.revision || 0)
    res.json(await buildCompletePackage(repository, owner, currentPack))
  })
  router.get(`${base}/download`, async (req, res) => {
    const owner = ownerScope(req)
    if (await workspaceRole(repository, owner, req.identity.uid) !== 'owner') throw fail(403, 'Only the workspace owner can download the complete package')
    const release = await assessDownload(repository, owner, req.completePack, { requireApproval: false, policy: 'owner-download' })
    if (!release.eligible) throw fail(422, 'Resolve saved content and source checks before downloading this package')
    const completePackage = await buildCompletePackage(repository, owner, req.completePack)
    res.setHeader('Content-Disposition', `attachment; filename="complete-package-${req.completePack.id}.json"`)
    res.json({ manifest: { version: completePackageVersion, packageId: req.completePack.id, contentHash: completePackage.contentHash, inputHash: completePackage.inputHash, exportedAt: new Date().toISOString(), downloadedBy: req.identity.uid, scope: 'internal-complete-package', sourcePackageExport: `/api/studio/packages/${req.completePack.id}/export`, limitations: ['Internal decisions, reported analytics and attestations are not public copy or legal certification.', 'Production prompts do not certify generated assets or publication.'] }, completePackage })
  })
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid complete-package request', issues: error.issues.slice(0, 10).map(item => ({ path: item.path.join('.'), message: item.message })) })
    if (['STUDIO_CONFLICT', 'STUDIO_QUOTA', 'BUDGET_BLOCKED'].includes(error.code)) return res.status(409).json({ error: 'Package, context or admission changed. Reload before continuing.' })
    if (error.publicMessage) return res.status(error.status).json({ error: error.publicMessage })
    next(error)
  })
  return router
}
