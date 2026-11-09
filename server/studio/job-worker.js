import { researchChanges } from './research-changes.js'
import { createHash } from 'node:crypto'
import { generateContent, reviewContent } from './content.js'
import { contentHash } from './approval.js'
import { buildAssurance } from './assurance.js'
import { workspaceRole } from './workspaces.js'
import { dispatchFreeOperation } from '../budget/free-operation.js'
import { costScopeHash } from '../budget/policy.js'
import { assertCapability } from '../policy.js'
import { readFreeGenerationReceipt } from '../providers/llm.js'
import { generateVertexJson, vertexFallbackAllowed } from '../providers/vertex-fallback.js'

const failure = message => Object.assign(new Error(message), { code: 'JOB_BLOCKED', status: 409, publicMessage: message })
const reportId = id => createHash('sha256').update(id).digest('hex').slice(0, 32)
const rejectedGeneration = error => error?.code === 'EVIDENCE_VALIDATION' || (error?.code === 'MODEL_INCOMPLETE' && error.transportStatus === 200 && (['length', 'error'].includes(error.finishReason) || (Number.isInteger(error.providerErrorCode) && error.providerErrorCode >= 400 && error.providerErrorCode <= 599)))

export function safeJobFailure(error) {
  const codes = ['JOB_BLOCKED', 'BUDGET_BLOCKED', 'STUDIO_CONFLICT', 'STUDIO_QUOTA', 'EVIDENCE_VALIDATION', 'MODEL_JSON_INVALID', 'MODEL_INCOMPLETE', 'MODEL_HTTP_ERROR', 'MODEL_TIMEOUT', 'VERTEX_REQUEST_FAILED']
  const names = ['Error', 'SyntaxError', 'TypeError', 'ZodError', 'AbortError', 'TimeoutError']
  return {
    code: codes.includes(error?.code) ? error.code : error?.name === 'ZodError' ? 'MODEL_SCHEMA_INVALID' : error?.name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'JOB_FAILED',
    name: names.includes(error?.name) ? error.name : 'Error',
    ...(['fenced', 'object', 'other'].includes(error?.outputKind) ? { outputKind: error.outputKind } : {}),
    ...(error?.code === 'EVIDENCE_VALIDATION' && Number.isInteger(error.issueCount) && error.issueCount >= 0 && error.issueCount <= 100 ? { issueCount: error.issueCount } : {}),
    ...(error?.code === 'EVIDENCE_VALIDATION' && Array.isArray(error.issues) ? { validationIssues: error.issues.filter(issue => typeof issue === 'string' && issue.length <= 300 && !/https?:|[\r\n]/i.test(issue)).slice(0, 20) } : {}),
    ...(Number.isInteger(error?.transportStatus) && error.transportStatus >= 100 && error.transportStatus <= 599 ? { transportStatus: error.transportStatus } : {}),
    ...(Number.isInteger(error?.providerErrorCode) && error.providerErrorCode >= 400 && error.providerErrorCode <= 599 ? { providerErrorCode: error.providerErrorCode } : {}),
    ...(Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? { httpStatus: error.status } : {}),
    ...(typeof error?.generationId === 'string' && /^gen-[A-Za-z0-9-]{1,100}$/.test(error.generationId) ? { generationId: error.generationId } : {}),
    ...(['stop', 'length', 'content_filter', 'tool_calls', 'error'].includes(error?.finishReason) ? { finishReason: error.finishReason } : {}),
    ...(Number.isInteger(error?.toolCallCount) && error.toolCallCount >= 0 && error.toolCallCount <= 30 ? { toolCallCount: error.toolCallCount } : {}),
    ...(typeof error?.expectedTool === 'boolean' ? { expectedTool: error.expectedTool } : {}),
    ...(['string', 'object', 'undefined'].includes(error?.argumentKind) ? { argumentKind: error.argumentKind } : {}),
  }
}

export async function runContentJob({ repository, uid, requestId, generate = generateContent, research }) {
  let job = await repository.studioJobGet(uid, requestId)
  if (!job || job.status !== 'reserved' || job.ready !== true) return { status: 'skipped', jobId: requestId }
  const scope = job.scope
  if (!['generation', 'research'].includes(scope.operation)) return { status: 'skipped', jobId: requestId }
  if ((scope.operation === 'generation' && generate === generateContent) || (scope.operation === 'research' && !research)) assertCapability(scope.operation)
  try { job = await repository.studioJobUpdate(uid, requestId, { status: 'running' }, job.revision, 'reserved') }
  catch (error) { if (error.code === 'STUDIO_CONFLICT') return { status: 'skipped', jobId: requestId }; throw error }
  let cost; let pack; let state; let result; let dispatched = false
  async function checkActor() {
    if (!scope.actorUid || !['owner', 'editor'].includes(await workspaceRole(repository, uid, scope.actorUid))) throw failure('The requesting account no longer has permission to dispatch this job.')
  }
  async function beforeAttempt() {
    await checkActor()
    if (scope.automatic) {
      const niche = await repository.studioGet(uid, 'niche', scope.nicheId)
      if (!niche?.autoRefresh || niche.autoRefreshConsent !== 1 || niche.revision !== scope.revision || niche.autoRefreshActor !== scope.actorUid) throw failure('Automatic refresh settings changed. Saved research is preserved.')
    }
    const current = await repository.studioJobGet(uid, requestId)
    const reservation = await repository.budgetGet(uid, requestId)
    if (current?.status !== 'running' || !reservation || reservation.cancellationRequested || reservation.status !== 'dispatched') throw failure('Job or budget authorization changed before the next provider attempt.')
  }
  try {
    await checkActor()
    cost = await repository.budgetGet(uid, requestId)
    if (!cost || cost.status !== 'reserved' || cost.cancellationRequested || cost.scopeHash !== costScopeHash(scope, cost.quote)) throw failure('A matching reserved budget is required before dispatch.')
    if (scope.operation === 'generation') {
      pack = await repository.studioGet(uid, 'package', scope.packageId)
      if (!pack || pack.jobId !== job.id || pack.status !== 'generating' || pack.revision !== scope.revision + 1 || contentHash(pack) !== scope.contentHash) throw failure('The queued package changed before dispatch.')
      for (const [index, id] of (pack.sourceIds || []).entries()) {
        const source = await repository.studioGet(uid, 'library_source', id)
        if (!source || source.reviewStatus !== 'approved' || source.evidence.hash !== pack.evidence[index]?.hash) throw failure('A source changed before dispatch.')
      }
    } else {
      const niche = await repository.studioGet(uid, 'niche', scope.nicheId)
      state = await repository.studioGet(uid, 'research_state', scope.nicheId)
      if (!niche || niche.revision !== scope.revision || state?.jobId !== job.id) throw failure('The queued research scope changed before dispatch.')
    }
    cost = await dispatchFreeOperation(repository, uid, cost)
    await beforeAttempt()
    dispatched = true
    if (scope.operation === 'generation') {
      const fallback = generate === generateContent && vertexFallbackAllowed() ? (request, attempt) => generateVertexJson(request, { repository, owner: uid, requestId: `vertex-${job.id}-${attempt}`, beforeAttempt }) : undefined
      const content = await generate(pack.evidence, pack.settings, { ...pack.researchContext, revisionInstruction: scope.instruction || null, previousContent: scope.instruction ? pack.content : null }, undefined, { beforeAttempt, fallback, startWithFallback: scope.generationProvider === 'vertex-fallback' })
      const review = reviewContent(content, pack.evidence, pack.settings)
      if (review.issues.length) throw Object.assign(new Error('Generated output failed validation'), { code: 'EVIDENCE_VALIDATION', issues: review.issues, issueCount: review.issues.length })
      const completed = { ...pack, content, review, status: 'completed', editorialStatus: 'needs_review', independentReview: null, approval: null }
      completed.assurance = buildAssurance(completed, { actorId: scope.actorUid, runId: job.id, stage: 'generation' })
      result = await repository.studioPut(uid, 'package', pack.id, completed, pack.revision)
    } else {
      const { researchNiche, validateIntelligence } = await import('./intelligence.js')
      const fallback = !scope.freeOnly && !scope.automatic && !research && vertexFallbackAllowed() ? (request, attempt) => generateVertexJson(request, { repository, owner: uid, requestId: `vertex-${job.id}-${attempt}`, beforeAttempt, kind: 'research' }) : undefined
      const briefing = await (research || researchNiche)(scope.niche, { beforeAttempt, fallback })
      validateIntelligence(briefing, briefing.evidence)
      const previous = (await repository.studioList(uid, 'research')).filter(report => report.nicheId === scope.nicheId).sort((a, b) => String(b.createdAt || b.researchedAt).localeCompare(String(a.createdAt || a.researchedAt)))[0]
      result = await repository.studioPut(uid, 'research', reportId(job.id), { ...briefing, changes: researchChanges(briefing, previous), nicheId: scope.nicheId, nicheRevision: scope.revision, niche: { ...scope.niche, id: scope.nicheId, revision: scope.revision } }, 0)
    }
    job = await repository.studioJobUpdate(uid, job.id, { status: 'completed', result }, job.revision, 'running')
    if (state) await repository.studioPut(uid, 'research_state', scope.nicheId, { jobId: job.id, status: 'completed', reportId: result.id }, state.revision)
    return { status: 'completed', jobId: job.id, result }
  } catch (error) {
    const accessRejected = error?.code === 'MODEL_HTTP_ERROR' && [401, 403].includes(error.status)
    const rejected = accessRejected || scope.operation === 'generation' && rejectedGeneration(error)
    const status = dispatched && !rejected ? 'dispatch_unknown' : 'failed'
    const diagnostics = safeJobFailure(error)
    const message = `${accessRejected ? 'The free AI provider rejected the server API key or its access. Update the provider key before trying again. Your saved category and content are preserved.' : rejected ? 'The generated draft did not pass validation. Your saved content is preserved. Review the sources and request a new attempt when ready.' : dispatched ? 'Provider outcome needs reconciliation. Existing content is preserved; no automatic retry is permitted.' : 'Queued work was blocked before provider dispatch. Review scope, membership and budget.'} Diagnostics: ${JSON.stringify(diagnostics)}`
    const currentJob = await repository.studioJobGet(uid, requestId)
    if (currentJob?.status === 'completed') return { status: 'completed', jobId: job.id, result: currentJob.result }
    // Reload the budget because cancellation may have changed its revision during an attempt.
    cost = await repository.budgetGet(uid, requestId)
    if (cost?.status === 'dispatched') await repository.budgetTransition(uid, cost.id, cost.revision, 'unknown')
    else if (cost?.status === 'reserved') await repository.budgetTransition(uid, cost.id, cost.revision, 'cancel')
    if (currentJob?.status === 'running') await repository.studioJobUpdate(uid, job.id, { status, error: message }, currentJob.revision, 'running')
    if (scope.operation === 'generation') {
      const current = await repository.studioGet(uid, 'package', scope.packageId)
      if (current?.jobId === job.id && ['generating', 'completed'].includes(current.status)) await repository.studioPut(uid, 'package', current.id, { ...current, status, error: message }, current.revision)
    }
    if (scope.operation === 'research') {
      const current = await repository.studioGet(uid, 'research_state', scope.nicheId)
      if (current?.jobId === job.id) await repository.studioPut(uid, 'research_state', scope.nicheId, { ...current, status }, current.revision)
    }
    return { status, jobId: job.id, error: message, code: diagnostics.code, diagnostics }
  }
}

export async function recoverRejectedGeneration({ repository, uid, packageId, revision, acknowledgeTimeoutCost = false, readFailure = readFreeGenerationReceipt }) {
  const pack = await repository.studioGet(uid, 'package', packageId)
  if (!pack || pack.revision !== revision) throw failure('Draft version changed. Open the latest draft before checking the attempt.')
  const job = pack.jobId && await repository.studioJobGet(uid, pack.jobId)
  // Legacy workers stored this server-generated diagnostic in the error message.
  let diagnostics
  try { diagnostics = JSON.parse(job?.error?.split(' Diagnostics: ')[1] || 'null') } catch { /* Unknown outcomes stay blocked. */ }
  if (!job || job.scope?.operation !== 'generation' || job.scope.packageId !== pack.id || !['dispatch_unknown', 'failed'].includes(job.status)) throw failure('This attempt has no confirmed rejection. Its provider outcome still needs reconciliation.')
  let reconciliation
  // A confirmed request rejection permits a new user-confirmed attempt; ambiguous cost stays held.
  const vertexReservations = await Promise.all([0, 1].map(attempt => repository.budgetGet(uid, `vertex-${job.id}-${attempt}`)))
  const vertexAttempted = vertexReservations.some(value => value?.quote.priceVersion === 'gemini-3.8-flash-global-2026-10-29')
  const cost = await repository.budgetGet(uid, job.id)
  const preDispatchRejected = job.status === 'failed' && diagnostics?.code === 'JOB_BLOCKED' && cost?.status === 'cancelled' && !vertexAttempted
  const acknowledgedTimeout = acknowledgeTimeoutCost === true && vertexAttempted && diagnostics?.code === 'VERTEX_REQUEST_FAILED' && diagnostics.httpStatus === 504
  const vertexRejected = (vertexAttempted || job.scope.generationProvider === 'vertex-fallback') && ['JOB_FAILED', 'VERTEX_REQUEST_FAILED'].includes(diagnostics?.code) && [400, 429].includes(diagnostics.httpStatus)
  if (!rejectedGeneration(diagnostics) && !vertexRejected && diagnostics?.code === 'MODEL_INCOMPLETE' && diagnostics.generationId) {
    try { reconciliation = await readFailure(diagnostics.generationId) }
    catch { throw failure('The provider has not confirmed a failed zero-cost attempt. Your saved content is preserved; try checking its status later.') }
    const cost = await repository.budgetGet(uid, job.id)
    if (cost && ['dispatched', 'dispatch_unknown'].includes(cost.status)) await repository.budgetTransition(uid, cost.id, cost.revision, 'settle', reconciliation.actualMicros)
  } else if (!rejectedGeneration(diagnostics) && !vertexRejected && !acknowledgedTimeout && !preDispatchRejected) throw failure('This attempt has no confirmed validation rejection. Its provider outcome still needs reconciliation.')
  if (job.status === 'dispatch_unknown') await repository.studioJobUpdate(uid, job.id, { status: 'failed', error: job.error, ...(acknowledgedTimeout ? { result: { timeoutAcknowledgedAt: new Date().toISOString(), billingOutcome: 'unknown-reservation-retained' } } : {}), ...(reconciliation ? { result: { reconciliation } } : {}) }, job.revision, 'dispatch_unknown')
  if (pack.status !== 'dispatch_unknown' && !(preDispatchRejected && pack.status === 'generating')) return pack
  return repository.studioPut(uid, 'package', pack.id, { ...pack, status: 'failed', error: 'The previous attempt produced no usable content. Your saved draft is preserved; you can request a new attempt.' }, pack.revision)
}

export async function cancelContentJob({ repository, uid, requestId }) {
  const job = await repository.studioJobGet(uid, requestId)
  if (!job) throw Object.assign(failure('Job not found'), { status: 404 })

  if (job.status === 'reserved' && job.ready !== true) throw failure('Job admission is not complete. Wait for admission or reconcile an interrupted request.')
  if (!['reserved', 'cancelled'].includes(job.status)) throw failure('Only queued jobs can be cancelled. Running or uncertain work requires reconciliation.')
  const cancelled = job.status === 'cancelled' ? job : await repository.studioJobUpdate(uid, job.id, { status: 'cancelled', error: 'Cancelled before dispatch' }, job.revision, 'reserved')
  const cost = await repository.budgetGet(uid, requestId)
  if (cost?.status === 'reserved') await repository.budgetTransition(uid, cost.id, cost.revision, 'cancel')
  if (job.scope.operation === 'generation') {
    const pack = await repository.studioGet(uid, 'package', job.scope.packageId)
    if (pack?.jobId === job.id && pack.status === 'generating') await repository.studioPut(uid, 'package', pack.id, { ...pack, status: 'cancelled', error: 'Cancelled before dispatch' }, pack.revision)
  } else if (job.scope.operation === 'research') {
    const state = await repository.studioGet(uid, 'research_state', job.scope.nicheId)
    if (state?.jobId === job.id) await repository.studioPut(uid, 'research_state', job.scope.nicheId, { ...state, status: 'cancelled' }, state.revision)
  }
  return cancelled
}

export async function runPendingContentJobs(repository, options = {}) {
  const pending = await repository.studioPendingJobs(20)
  const results = []
  for (const { uid, id } of pending) results.push(await runContentJob({ repository, uid, requestId: id, ...options }))
  return results
}
