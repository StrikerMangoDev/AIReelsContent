import { z } from 'zod'
import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { budgetError, costScopeHash } from '../budget/policy.js'
import { generateVertexJson, vertexDemoCallUpperBoundMicros, vertexProductionProject, vertexWifAudience, vertexWifServiceAccount } from '../providers/vertex-fallback.js'
import { generateOpenRouterDemoJson, openRouterDemoModel, openRouterDemoCallUpperBoundMicros } from '../providers/openrouter-demo.js'
import { contentHash } from '../studio/approval.js'
import { workspaceRole } from '../studio/workspaces.js'
import { automaticTextPolicyVersion, assessAutomaticText } from './review.js'
import { freeCampaignSchema, freeCampaignHash, freeCampaignRunId } from './campaign.js'

export const demoOwner = 'W8eI22SdAsZa2LGz6VZxWQkXsyj1'
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const demoAuthorizationSchema = z.object({
  version: z.literal('five-account-paid-demo-v1'), status: z.enum(['active', 'blocked', 'revoked']), owner: z.literal(demoOwner), actorUid: z.literal(demoOwner),
  currency: z.literal('USD'), totalLimitMicros: z.literal(5000000), projectId: z.enum(['ai-vertical-495712', vertexProductionProject]), provider: z.enum(['vertex', 'openrouter']).default('vertex'), model: z.enum(['gemini-3.8-flash', openRouterDemoModel]), priceExpiresAt: z.string().datetime().optional(),
  authorizedAt: z.string().datetime(), expiresAt: z.string().datetime(), allowedStages: z.tuple([z.literal('generate'), z.literal('review')]),
  runs: z.array(z.object({ runId: z.string().regex(/^[a-f0-9]{32}$/), accountId: z.string().min(1).max(200), profileId: z.string().min(1).max(200), profileHash: hash, packageId: z.string().regex(/^[a-f0-9]{32}$/), sourceContentHash: hash }).strict()).length(5).refine(runs => new Set(runs.map(run => run.runId)).size === 5 && new Set(runs.map(run => run.accountId)).size === 5, 'Use exactly five distinct authorized runs and accounts'),
  sourceCampaignContinuation: z.object({ sourceCampaignId: z.string().min(1).max(120), sourceCampaignHash: hash, sourceRunIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).length(5).refine(ids => new Set(ids).size === 5) }).strict().optional(),
}).strict()
const blocked = message => Object.assign(budgetError(message), { preDispatch: true })
export function demoAuthorizationActive(value, now = Date.now()) {
  const parsed = demoAuthorizationSchema.safeParse(Object.fromEntries(Object.keys(demoAuthorizationSchema.shape).map(key => [key, value?.[key]])))
  if (!parsed.success) return false
  const authorization = parsed.data
  const start = Date.parse(authorization.authorizedAt); const end = Date.parse(authorization.expiresAt)
  const providerMatches = authorization.provider === 'vertex' ? authorization.projectId === vertexProductionProject && authorization.model === 'gemini-3.8-flash' : authorization.model === openRouterDemoModel && Boolean(authorization.priceExpiresAt) && Date.parse(authorization.priceExpiresAt) > now && Date.parse(authorization.priceExpiresAt) <= end
  return providerMatches && authorization.status === 'active' && start <= now && end > now && end <= start + 86400000 && now < Date.parse('2027-01-01T00:00:00Z')
}
export const demoBudgetOwner = (owner, demoId) => `demo:${costScopeHash({ owner, demoId }, null).slice(0, 48)}`
export const demoSerialLeaseId = (owner, demoId) => `paid-demo-stage:${owner}:${demoId}`
export const demoSourceCampaignHash = record => freeCampaignHash(freeCampaignSchema.parse(Object.fromEntries(Object.keys(freeCampaignSchema.shape).map(key => [key, record?.[key]]))))

async function confirmedFree429(repository, owner, run) {
  if (run.status !== 'dispatch_unknown' || run.stage !== 'generate') return false
  const ids = [...new Set([run.jobId, ...(run.stages || []).filter(stage => stage.stage === 'generate').flatMap(stage => [stage.jobId, stage.requestId])].filter(Boolean))]
  for (const id of ids) {
    const job = await repository.studioJobGet(owner, id)
    if (!job || job.status !== 'dispatch_unknown' || job.result != null || job.scope?.operation !== 'generation' || job.scope?.generationProvider !== 'free' || job.scope?.packageId !== run.packageId) continue
    try {
      const value = typeof job.error === 'string' ? JSON.parse(job.error.includes('Diagnostics: ') ? job.error.split('Diagnostics: ').at(-1) : job.error) : null
      if (value?.code === 'MODEL_HTTP_ERROR' && value.httpStatus === 429) return true
    } catch { /* Only the recorded structured HTTP rejection qualifies; unknown transport stays held. */ }
  }
  return false
}

export async function assertDemoSourceContinuation(repository, owner, authorization, now = Date.now()) {
  const continuation = authorization.sourceCampaignContinuation
  if (!continuation) return null
  if (owner !== demoOwner || !demoAuthorizationActive(authorization, now) || authorization.provider !== 'vertex' || authorization.projectId !== vertexProductionProject) throw blocked('The paid continuation needs a fresh bounded production authorization.')
  if (new Set(authorization.runs.map(run => run.packageId)).size !== 5) throw blocked('The paid continuation requires five distinct new package clones.')
  const raw = await repository.studioGet(owner, 'automation_campaign', continuation.sourceCampaignId)
  const source = freeCampaignSchema.parse(Object.fromEntries(Object.keys(freeCampaignSchema.shape).map(key => [key, raw?.[key]])))
  if (source.status !== 'revoked' || source.actorUid !== authorization.actorUid || demoSourceCampaignHash(raw) !== continuation.sourceCampaignHash || Date.parse(source.createdAt) > Date.parse(authorization.authorizedAt) || source.accountIds.length !== 5 || JSON.stringify([...source.accountIds].sort()) !== JSON.stringify(authorization.runs.map(run => run.accountId).sort())) throw blocked('The source free campaign is not the exact frozen revoked five-account campaign.')
  const campaigns = await repository.studioList(owner, 'automation_campaign')
  if (campaigns.some(campaign => campaign.id !== source.id && campaign.status === 'active' && campaign.accountIds?.some(id => source.accountIds.includes(id)))) throw blocked('Another active campaign conflicts with the paid continuation.')
  const allRuns = await repository.studioList(owner, 'automation_run')
  const sourceRuns = allRuns.filter(run => run.campaignId === source.id)
  if (sourceRuns.length !== 5 || JSON.stringify(sourceRuns.map(run => run.id).sort()) !== JSON.stringify([...continuation.sourceRunIds].sort())) throw blocked('The continuation does not bind every original free campaign run.')
  const sourceHash = freeCampaignHash({ ...source, status: 'active', completedAt: undefined, completion: undefined })
  const sourcePackageIds = run => [run.packageId, createHash('sha256').update(`${run.id}:package`).digest('hex').slice(0, 32)].filter(Boolean)
  const oldPackages = new Set(sourceRuns.flatMap(sourcePackageIds))
  const oldRequests = new Set(sourceRuns.flatMap(run => run.stages?.map(stage => stage.requestId) || []))
  if (source.supersedesCampaignId) {
    const rawPrior = await repository.studioGet(owner, 'automation_campaign', source.supersedesCampaignId)
    const prior = freeCampaignSchema.parse(Object.fromEntries(Object.keys(freeCampaignSchema.shape).map(key => [key, rawPrior?.[key]])))
    const priorRuns = allRuns.filter(run => run.campaignId === prior.id)
    if (prior.supersedesCampaignId || prior.status !== 'completed' || prior.completion !== 'finished_with_blocks' || prior.actorUid !== source.actorUid || JSON.stringify([...prior.accountIds].sort()) !== JSON.stringify([...source.accountIds].sort()) || priorRuns.length !== 5 || priorRuns.some(run => !['blocked', 'failed'].includes(run.status) || run.demoAuthorizationId || run.paidBudgetMicros !== 0 || run.publicationId || run.providerPostId || run.id !== freeCampaignRunId(owner, prior.id, run.accountId))) throw blocked('The source campaign ancestor is not a completed unpublished free failure.')
    for (const run of priorRuns) { for (const id of sourcePackageIds(run)) oldPackages.add(id); for (const stage of run.stages || []) oldRequests.add(stage.requestId) }
  }
  for (const binding of authorization.runs) {
    const old = sourceRuns.find(run => run.accountId === binding.accountId)
    const priorBinding = source.profileBindings.find(item => item.accountId === binding.accountId)
    const profile = await repository.studioGet(owner, 'account_profile', binding.profileId)
    const original = old?.packageId && await repository.studioGet(owner, 'package', old.packageId)
    const sourceStopped = old && (['blocked', 'failed'].includes(old.status) || await confirmedFree429(repository, owner, old))
    if (!old || old.id !== freeCampaignRunId(owner, source.id, binding.accountId) || !sourceStopped || !['generate', 'review'].includes(old.stage) || old.actorUid !== authorization.actorUid || old.campaignHash !== sourceHash || old.campaignReferenceUrl !== source.referenceUrl || old.campaignTopic !== source.topic || old.paidBudgetMicros !== 0 || old.demoAuthorizationId || old.publicationId || old.providerPostId || sourceRuns.some(run => run.id === binding.runId) || oldPackages.has(binding.packageId) || !original || contentHash(original) !== binding.sourceContentHash || !priorBinding || priorBinding.profileId !== binding.profileId || priorBinding.profileHash !== binding.profileHash || old.profileHash !== binding.profileHash || !profile || profile.accountId !== binding.accountId || costScopeHash(profile, null) !== binding.profileHash || !profile.enabled || !profile.automationConsent || profile.automaticPolicy?.version !== 'account-automation-v1' || profile.automaticPolicy?.scope !== 'research-generation-and-social-publishing' || profile.automaticPolicy?.paidBudgetMicros !== 0 || profile.automaticPolicy?.consentedBy !== authorization.actorUid || await workspaceRole(repository, owner, authorization.actorUid) !== 'owner') throw blocked('The paid continuation source, clone, account profile or zero-publication scope changed.')
  }
  const publications = await repository.studioList(owner, 'social_publication')
  if (publications.some(receipt => oldPackages.has(receipt.packageId) || oldRequests.has(receipt.requestId))) throw blocked('A source campaign publication receipt exists; no continuation may publish again.')
  return { source, sourceRuns }
}

export async function assertDemoRunContinuation({ repository, owner, actorUid, run, profile }, now = Date.now()) {
  if (!run?.demoAuthorizationId) return null
  const record = await repository.studioGet(owner, 'automation_demo', run.demoAuthorizationId)
  const parsed = demoAuthorizationSchema.safeParse(Object.fromEntries(Object.keys(demoAuthorizationSchema.shape).map(key => [key, record?.[key]])))
  if (!parsed.success && record?.sourceCampaignContinuation) throw blocked('The paid continuation authorization is invalid.')
  if (!parsed.success || !parsed.data.sourceCampaignContinuation) return null
  const authorization = parsed.data
  await assertDemoSourceContinuation(repository, owner, authorization, now)
  const binding = authorization.runs.find(item => item.runId === run.id)
  const pack = binding && await repository.studioGet(owner, 'package', binding.packageId)
  if (actorUid !== authorization.actorUid || !binding || run.campaignId || binding.accountId !== profile.accountId || binding.profileId !== profile.id || costScopeHash(profile, null) !== binding.profileHash || run.profileHash !== binding.profileHash || run.packageId !== binding.packageId || run.demoSourceContentHash !== binding.sourceContentHash || !pack || contentHash(pack) !== (run.stage === 'generate' ? run.qualityRevision?.contentHash || binding.sourceContentHash : run.contentHash)) throw blocked('The continuation run no longer matches its new paid clone and authorization.')
  return authorization
}
export function demoStageRequestId(run, phase) {
  const digest = costScopeHash({ demoId: run.demoAuthorizationId, runId: run.id, phase, contentHash: phase === 'generate' ? run.demoSourceContentHash : run.contentHash, ...(run.providerRateRetry ? { providerRateRetry: { version: run.providerRateRetry.version, jobId: run.providerRateRetry.jobId, recoveryId: run.providerRateRetry.recoveryId } } : {}), ...(phase === 'review' ? { policyVersion: automaticTextPolicyVersion, ...(run.reviewFormatRetry ? { reviewFormatRetry: { version: run.reviewFormatRetry.version, reviewId: run.reviewFormatRetry.reviewId, contentHash: run.reviewFormatRetry.contentHash } } : {}) } : {}), ...(run.qualityRevision ? { qualityRevision: { version: run.qualityRevision.version, reviewId: run.qualityRevision.reviewId, contentHash: run.qualityRevision.contentHash } } : {}) }, null)
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`
}
export async function paidRateRejection(repository, owner, run) {
  const original = { ...run, providerRateRetry: undefined }
  const jobId = demoStageRequestId(original, 'generate')
  const job = await repository.studioJobGet(owner, jobId)
  const proof = await repository.studioGet(owner, 'provider_rejection', jobId)
  const requestId = `demo:${jobId}:0`
  const cost = await repository.budgetGet(demoBudgetOwner(owner, run.demoAuthorizationId), requestId)
  let diagnostics
  try { diagnostics = JSON.parse(job?.error?.split('Diagnostics: ').at(-1)) } catch { /* Unstructured uncertainty is never retryable. */ }
  if (!job || !['failed', 'dispatch_unknown'].includes(job.status) || job.result != null || job.scope?.operation !== 'generation' || job.scope.generationProvider !== 'vertex-demo' || job.scope.demoId !== run.demoAuthorizationId || job.scope.packageId !== run.packageId || job.scope.contentHash !== run.demoSourceContentHash || job.scope.profileHash !== run.profileHash || diagnostics?.httpStatus !== 429 || !cost || cost.status !== 'settled' || cost.actualMicros !== 0 || cost.overage || !proof || proof.version !== 'vertex-http-rejection-v1' || proof.jobId !== jobId || proof.requestId !== requestId || proof.runId !== run.id || proof.packageId !== run.packageId || proof.demoAuthorizationId !== run.demoAuthorizationId || proof.provider !== 'vertex' || proof.projectId !== vertexProductionProject || proof.model !== 'gemini-3.8-flash' || proof.httpStatus !== 429 || proof.actualMicros !== 0 || proof.noOutput !== true || !hash.safeParse(proof.evidenceHash).success || !Number.isFinite(Date.parse(proof.settledAt || ''))) throw blocked('This generation lacks exact settled-zero provider rejection evidence.')
  return { job, proof, cost, notBefore: new Date(Math.max(Date.parse(job.updatedAt), Date.parse(proof.settledAt)) + 60000).toISOString() }
}
const repairReviewId = run => costScopeHash({ demoId: run.demoAuthorizationId, runId: run.id, reviewId: run.qualityRevision?.reviewId }, null).slice(0, 32)
const formatReviewId = run => costScopeHash({ demoId: run.demoAuthorizationId, runId: run.id, reviewId: run.reviewFormatRetry?.reviewId, kind: 'review-format' }, null).slice(0, 32)
const formatFailure = review => review?.policyVersion === automaticTextPolicyVersion && review.status === 'blocked' && review.result === null && review.responseFailure?.code === 'MODEL_SCHEMA_INVALID' && review.responseFailure.outcome === 'invalid_response' && review.responseFailure.issueCount > 0 && review.responseFailure.schemaIssues?.length > 0
async function settledDemoStage(repository, budgetOwner, run, phase, required = true) {
  for (let attempt = 0; attempt < (phase === 'generate' ? 2 : 1); attempt++) {
    const cost = await repository.budgetGet(budgetOwner, `demo:${demoStageRequestId(run, phase)}:${attempt}`)
    if ((!cost && attempt === 0 && required) || cost && (cost.status !== 'settled' || cost.overage)) throw blocked('Prior paid demo usage must be settled before a quality revision.')
  }
}
export async function assertDemoReviewFormatRetry(context) {
  const admitted = await assertDemoAuthorization(context)
  if (!admitted || context.phase !== 'review' || context.run.reviewFormatRetry || context.run.publicationId || context.run.providerPostId) throw blocked('Only one confirmed review schema failure may authorize a format correction.')
  const pack = await context.repository.studioGet(context.owner, 'package', context.run.packageId)
  const review = pack?.automaticReview
  let parsed = false
  try { parsed = assessAutomaticText(pack, context.profile).policyVersion === automaticTextPolicyVersion } catch { /* Malformed content cannot authorize a paid format correction. */ }
  if (!parsed || !formatFailure(review) || review.model !== admitted.model || review.profileHash !== context.run.profileHash || review.contentHash !== contentHash(pack) || Date.parse(review.reviewedAt) > Date.now() || Date.parse(review.expiresAt) <= Date.now()) throw blocked('Format correction requires the actual current schema-invalid review of unchanged content.')
  if ((await context.repository.budgetSummary(admitted.budgetOwner, 'USD')).heldMicros !== 0) throw blocked('Unsettled demo usage prevents a paid format correction.')
  await settledDemoStage(context.repository, admitted.budgetOwner, context.run, 'generate')
  await settledDemoStage(context.repository, admitted.budgetOwner, context.run, 'review')
  const id = formatReviewId({ ...context.run, reviewFormatRetry: { reviewId: review.runId } })
  const saved = await context.repository.studioGet(context.owner, 'automation_demo_review_format', id)
  if (saved && costScopeHash(saved.review, null) !== costScopeHash(review, null)) throw blocked('The schema-invalid review history changed.')
  if (!saved) await context.repository.studioPut(context.owner, 'automation_demo_review_format', id, { demoId: context.run.demoAuthorizationId, runId: context.run.id, packageId: pack.id, review, qualityRevision: context.run.qualityRevision || null }, 0)
  return admitted
}
export async function assertDemoQualityRepair(context) {
  const admitted = await assertDemoAuthorization(context)
  if (!admitted || context.phase !== 'review' || context.run.qualityRevision || context.run.publicationId || context.run.providerPostId) throw blocked('Only one actual failed demo review may authorize a quality revision.')
  const pack = await context.repository.studioGet(context.owner, 'package', context.run.packageId)
  const review = pack?.automaticReview
  let parsedReview = false
  try { parsedReview = assessAutomaticText(pack, context.profile).policyVersion === automaticTextPolicyVersion } catch { /* Malformed content cannot authorize a paid repair. */ }
  const repairable = review?.status === 'needs_revision' && Boolean(review.result) && !review.responseFailure && parsedReview
  if (!repairable || review.model !== admitted.model || review.policyVersion !== automaticTextPolicyVersion || Date.parse(review.reviewedAt) > Date.now() || Date.parse(review.expiresAt) <= Date.now() || review.contentHash !== contentHash(pack) || review.profileHash !== context.run.profileHash || !review.runId || !review.issues?.some(issue => typeof issue === 'string' && issue.trim())) throw blocked('Quality revision requires an actual failed current-policy review of this saved package.')
  const budget = await context.repository.budgetSummary(admitted.budgetOwner, 'USD')
  if (budget.heldMicros !== 0) throw blocked('Unsettled demo usage prevents a paid quality revision.')
  await settledDemoStage(context.repository, admitted.budgetOwner, context.run, 'generate')
  await settledDemoStage(context.repository, admitted.budgetOwner, context.run, 'review')
  const id = repairReviewId({ ...context.run, qualityRevision: { reviewId: review.runId } })
  const saved = await context.repository.studioGet(context.owner, 'automation_demo_review', id)
  const snapshot = { demoId: context.run.demoAuthorizationId, runId: context.run.id, packageId: pack.id, review, reviewFormatRetry: context.run.reviewFormatRetry || null }
  if (saved && costScopeHash(saved.review, null) !== costScopeHash(review, null)) throw blocked('The rejected demo review history changed.')
  if (!saved) await context.repository.studioPut(context.owner, 'automation_demo_review', id, snapshot, 0)
  return admitted
}

export async function assertDemoAuthorization({ repository, owner, actorUid, run, profile, phase }) {
  const now = Date.now()
  if (!Object.hasOwn(run || {}, 'demoAuthorizationId')) return null
  if (owner !== demoOwner || actorUid !== demoOwner || !['generate', 'review'].includes(phase) || typeof run.demoAuthorizationId !== 'string' || run.demoAuthorizationId.length > 100) throw blocked('The paid demonstration is outside its authorized owner or stage scope.')
  const record = await repository.studioGet(owner, 'automation_demo', run.demoAuthorizationId)
  const parsed = demoAuthorizationSchema.safeParse(Object.fromEntries(Object.keys(demoAuthorizationSchema.shape).map(key => [key, record?.[key]])))
  if (!parsed.success) throw blocked('The paid demonstration authorization is missing or invalid.')
  const authorization = parsed.data
  if (!demoAuthorizationActive(authorization, now)) throw blocked('The demonstration owner, provider, production project, pricing or expiry is outside its approval.')
  await assertDemoSourceContinuation(repository, owner, authorization, now)
  const binding = authorization.runs.find(value => value.runId === run.id)
  const currentRun = await repository.studioGet(owner, 'automation_run', run.id)
  const currentProfile = profile?.id && await repository.studioGet(owner, 'account_profile', profile.id)
  if (!binding || binding.profileId !== profile?.id || binding.accountId !== profile?.accountId || run.packageId !== binding.packageId || !currentRun || currentRun.demoAuthorizationId !== run.demoAuthorizationId || currentRun.stage !== phase || currentRun.status !== `${phase}_running` || currentRun.accountId !== binding.accountId || currentRun.packageId !== binding.packageId || currentRun.demoSourceContentHash !== binding.sourceContentHash || run.demoSourceContentHash !== binding.sourceContentHash) throw blocked('The paid demonstration run no longer matches its frozen authorization.')
  if (!currentProfile || costScopeHash(currentProfile, null) !== binding.profileHash || costScopeHash(profile, null) !== binding.profileHash || currentRun.profileHash !== binding.profileHash || !currentProfile.enabled || currentProfile.automationConsent !== true || currentProfile.automaticPolicy?.version !== 'account-automation-v1' || currentProfile.automaticPolicy?.scope !== 'research-generation-and-social-publishing' || currentProfile.automaticPolicy?.consentedBy !== actorUid || currentProfile.automaticPolicy?.paidBudgetMicros !== 0 || await workspaceRole(repository, owner, actorUid) !== 'owner') throw blocked('The account plan, owner role or recurring free-only consent changed.')
  if (!Number.isFinite(Date.parse(currentProfile.automaticPolicy.consentedAt || '')) || Date.parse(currentProfile.automaticPolicy.consentedAt) > now) throw blocked('The account automation consent timestamp is unavailable or invalid.')
  const pack = await repository.studioGet(owner, 'package', binding.packageId)
  const quality = currentRun.qualityRevision
  const format = currentRun.reviewFormatRetry
  const budgetOwner = demoBudgetOwner(owner, run.demoAuthorizationId)
  if (format || run.reviewFormatRetry) {
    const saved = format && await repository.studioGet(owner, 'automation_demo_review_format', formatReviewId(currentRun))
    if (!saved || format.version !== 1 || costScopeHash(format, null) !== costScopeHash(run.reviewFormatRetry, null) || saved.demoId !== run.demoAuthorizationId || saved.runId !== run.id || saved.packageId !== binding.packageId || !formatFailure(saved.review) || saved.review.model !== authorization.model || saved.review.runId !== format.reviewId || saved.review.contentHash !== format.contentHash || saved.review.profileHash !== binding.profileHash || !quality && (phase !== 'review' || format.contentHash !== currentRun.contentHash) || currentRun.publicationId || currentRun.providerPostId) throw blocked('The format correction lacks its actual frozen schema-invalid review.')
    await settledDemoStage(repository, budgetOwner, { ...currentRun, qualityRevision: saved.qualityRevision || undefined, reviewFormatRetry: undefined, contentHash: format.contentHash }, 'review')
  }
  if (quality || run.qualityRevision) {
    const saved = quality && await repository.studioGet(owner, 'automation_demo_review', repairReviewId(currentRun))
    if (!saved || quality.version !== 1 || costScopeHash(quality, null) !== costScopeHash(run.qualityRevision, null) || saved.demoId !== run.demoAuthorizationId || saved.runId !== run.id || saved.packageId !== binding.packageId || saved.review.model !== authorization.model || saved.review.policyVersion !== automaticTextPolicyVersion || saved.review.status !== 'needs_revision' || !saved.review.result || saved.review.responseFailure || saved.review.runId !== quality.reviewId || saved.review.contentHash !== quality.contentHash || saved.review.profileHash !== binding.profileHash || currentRun.publicationId || currentRun.providerPostId) throw blocked('The paid quality revision lacks its actual frozen rejected review.')
    const original = { ...currentRun, qualityRevision: undefined, reviewFormatRetry: saved.reviewFormatRetry || undefined, contentHash: quality.contentHash }
    await settledDemoStage(repository, budgetOwner, original, 'generate')
    await settledDemoStage(repository, budgetOwner, original, 'review')
    if (phase === 'review') await settledDemoStage(repository, budgetOwner, currentRun, 'generate')
  }
  const expectedHash = phase === 'generate' ? quality?.contentHash || binding.sourceContentHash : currentRun.contentHash
  if (!pack || !expectedHash || contentHash(pack) !== expectedHash || (phase === 'review' && (run.contentHash !== expectedHash || currentRun.packageId !== pack.id))) throw blocked('The paid demonstration content changed outside the authorized stage.')
  const budget = await repository.budgetSummary(budgetOwner, 'USD')
  if (currentRun.providerRateRetry || run.providerRateRetry) {
    const retry = currentRun.providerRateRetry
    const saved = retry?.recoveryId && await repository.studioGet(owner, 'automation_recovery', retry.recoveryId)
    const rejected = await paidRateRejection(repository, owner, currentRun)
    const expectedRecoveryId = createHash('sha256').update(`${run.id}:paid-generation-rate-retry:1`).digest('hex').slice(0, 32)
    if (!saved || retry.version !== 1 || retry.recoveryId !== expectedRecoveryId || retry.jobId !== rejected.job.id || !Number.isFinite(Date.parse(retry.notBefore || '')) || costScopeHash(retry, null) !== costScopeHash(run.providerRateRetry, null) || saved.version !== 'paid-generation-rate-retry-v1' || saved.runId !== run.id || saved.job.id !== retry.jobId || saved.proof.evidenceHash !== rejected.proof.evidenceHash || saved.previousRun.id !== run.id || saved.previousRun.providerRateRetry || Date.parse(retry.notBefore) < Date.parse(rejected.notBefore) || now < Date.parse(retry.notBefore)) throw blocked('The bounded paid rate retry lacks its exact original rejection or waiting window.')
  }
  if (budget.limitMicros !== authorization.totalLimitMicros) throw blocked('The paid demonstration needs its own exact shared five-dollar budget.')
  if (quality || format) {
    let ownReservedMicros = 0
    for (let attempt = 0; attempt < (phase === 'generate' ? 2 : 1); attempt++) {
      const cost = await repository.budgetGet(budgetOwner, `demo:${demoStageRequestId(currentRun, phase)}:${attempt}`)
      if (cost?.status === 'reserved') ownReservedMicros += cost.quote.upperBoundMicros
    }
    if (budget.heldMicros > ownReservedMicros) throw blocked('Other unsettled demo usage prevents paid quality dispatch.')
  }
  return { authorization, budgetOwner, model: authorization.model, projectId: authorization.projectId, requiredQuoteMicros: authorization.provider === 'openrouter' ? openRouterDemoCallUpperBoundMicros : vertexDemoCallUpperBoundMicros }
}

export function createDemoGenerator(context, { beforeAttempt, config = env, request } = {}) {
  let calls = 0
  const assertSerialLease = async admitted => {
    if (!admitted.authorization.sourceCampaignContinuation) return
    const lease = context.demoLease
    if (!lease || lease.id !== demoSerialLeaseId(context.owner, context.run.demoAuthorizationId) || typeof lease.owner !== 'string') throw blocked('The serialized paid demo stage lease is unavailable; no provider call was sent.')
    await context.repository.renewLease(lease.id, lease.owner)
    if ((await context.repository.budgetSummary(admitted.budgetOwner, 'USD')).heldMicros !== 0) throw blocked('A prior paid continuation call is unresolved; no additional inference was admitted.')
  }
  return async input => {
    const admitted = await assertDemoAuthorization(context)
    if (!admitted) throw blocked('A paid demonstration authorization is required.')
    await assertSerialLease(admitted)
    const maximum = context.phase === 'generate' ? 2 : 1
    if (calls >= maximum) throw blocked('The paid demonstration stage exhausted its bounded attempts.')
    const attempt = calls++
    if (attempt > 0) {
      const prior = await context.repository.budgetGet(admitted.budgetOwner, `demo:${demoStageRequestId(context.run, context.phase)}:${attempt - 1}`)
      if (prior?.status !== 'settled' || prior.overage) throw blocked('The prior paid attempt has unsettled usage; no paid correction may dispatch.')
    }
    const requestId = `demo:${demoStageRequestId(context.run, context.phase)}:${attempt}`
    const scopedConfig = { ...config, CONTENT_VERTEX_FALLBACK: 'true', VERTEX_FALLBACK_PROJECT: admitted.projectId, VERTEX_FALLBACK_MODEL: admitted.model, VERTEX_FALLBACK_APPROVED_UNTIL: admitted.authorization.expiresAt }
    try {
      if (admitted.authorization.provider === 'openrouter') return await generateOpenRouterDemoJson(input, { repository: context.repository, owner: admitted.budgetOwner, requestId, config, priceExpiresAt: admitted.authorization.priceExpiresAt, ...(request ? { request } : {}), beforeAttempt: async () => { await assertDemoAuthorization(context); if (beforeAttempt) await beforeAttempt() } })
      if (scopedConfig.VERTEX_WIF_AUDIENCE !== vertexWifAudience || scopedConfig.VERTEX_WIF_SERVICE_ACCOUNT !== vertexWifServiceAccount) throw Object.assign(blocked('The approved production federation configuration is unavailable.'), { configurationFailure: true })
      return await generateVertexJson(input, { repository: context.repository, owner: admitted.budgetOwner, requestId, config: scopedConfig, worstCaseModelBound: true, timeoutMs: 110000, ...(request ? { request } : {}), beforeAttempt: async () => { await assertDemoAuthorization(context); if (admitted.authorization.sourceCampaignContinuation) { const lease = context.demoLease; if (!lease) throw blocked('The paid demo stage lease changed before inference dispatch.'); await context.repository.renewLease(lease.id, lease.owner) } if (beforeAttempt) await beforeAttempt() } })
    } catch (error) {
      if ([401, 402, 403].includes(error.status) || error.configurationFailure === true) {
        const current = await context.repository.studioGet(context.owner, 'automation_demo', context.run.demoAuthorizationId)
        if (current?.status === 'active') await context.repository.studioPut(context.owner, 'automation_demo', current.id, { ...current, status: 'blocked', failureCode: admitted.authorization.provider === 'openrouter' ? error.configurationFailure ? 'OPENROUTER_CONFIG_INVALID' : 'OPENROUTER_ACCESS_REJECTED' : error.configurationFailure ? 'VERTEX_CONFIG_INVALID' : 'VERTEX_ACCESS_REJECTED', ...(error.authFailure ? { authFailure: error.authFailure } : {}) }, current.revision)
      }
      if (error.code === 'BUDGET_BLOCKED') error.preDispatch = true
      throw error
    }
  }
}
