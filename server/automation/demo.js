import { z } from 'zod'
import { env } from '../config/env.js'
import { budgetError, costScopeHash } from '../budget/policy.js'
import { generateVertexJson, vertexDemoCallUpperBoundMicros, vertexProductionProject, vertexWifAudience, vertexWifServiceAccount } from '../providers/vertex-fallback.js'
import { generateOpenRouterDemoJson, openRouterDemoModel, openRouterDemoCallUpperBoundMicros } from '../providers/openrouter-demo.js'
import { contentHash } from '../studio/approval.js'
import { workspaceRole } from '../studio/workspaces.js'
import { automaticTextPolicyVersion, assessAutomaticText } from './review.js'

export const demoOwner = 'W8eI22SdAsZa2LGz6VZxWQkXsyj1'
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const demoAuthorizationSchema = z.object({
  version: z.literal('five-account-paid-demo-v1'), status: z.enum(['active', 'blocked', 'revoked']), owner: z.literal(demoOwner), actorUid: z.literal(demoOwner),
  currency: z.literal('USD'), totalLimitMicros: z.literal(5000000), projectId: z.enum(['ai-vertical-495712', vertexProductionProject]), provider: z.enum(['vertex', 'openrouter']).default('vertex'), model: z.enum(['gemini-3.8-flash', openRouterDemoModel]), priceExpiresAt: z.string().datetime().optional(),
  authorizedAt: z.string().datetime(), expiresAt: z.string().datetime(), allowedStages: z.tuple([z.literal('generate'), z.literal('review')]),
  runs: z.array(z.object({ runId: z.string().regex(/^[a-f0-9]{32}$/), accountId: z.string().min(1).max(200), profileId: z.string().min(1).max(200), profileHash: hash, packageId: z.string().regex(/^[a-f0-9]{32}$/), sourceContentHash: hash }).strict()).length(5).refine(runs => new Set(runs.map(run => run.runId)).size === 5 && new Set(runs.map(run => run.accountId)).size === 5, 'Use exactly five distinct authorized runs and accounts'),
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
export function demoStageRequestId(run, phase) {
  const digest = costScopeHash({ demoId: run.demoAuthorizationId, runId: run.id, phase, contentHash: phase === 'generate' ? run.demoSourceContentHash : run.contentHash, ...(phase === 'review' ? { policyVersion: automaticTextPolicyVersion } : {}), ...(run.qualityRevision ? { qualityRevision: { version: run.qualityRevision.version, reviewId: run.qualityRevision.reviewId, contentHash: run.qualityRevision.contentHash } } : {}) }, null)
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`
}
const repairReviewId = run => costScopeHash({ demoId: run.demoAuthorizationId, runId: run.id, reviewId: run.qualityRevision?.reviewId }, null).slice(0, 32)
async function settledDemoStage(repository, budgetOwner, run, phase, required = true) {
  for (let attempt = 0; attempt < (phase === 'generate' ? 2 : 1); attempt++) {
    const cost = await repository.budgetGet(budgetOwner, `demo:${demoStageRequestId(run, phase)}:${attempt}`)
    if ((!cost && attempt === 0 && required) || cost && (cost.status !== 'settled' || cost.overage)) throw blocked('Prior paid demo usage must be settled before a quality revision.')
  }
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
  const snapshot = { demoId: context.run.demoAuthorizationId, runId: context.run.id, packageId: pack.id, review }
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
  const binding = authorization.runs.find(value => value.runId === run.id)
  const currentRun = await repository.studioGet(owner, 'automation_run', run.id)
  const currentProfile = profile?.id && await repository.studioGet(owner, 'account_profile', profile.id)
  if (!binding || binding.profileId !== profile?.id || binding.accountId !== profile?.accountId || run.packageId !== binding.packageId || !currentRun || currentRun.demoAuthorizationId !== run.demoAuthorizationId || currentRun.stage !== phase || currentRun.status !== `${phase}_running` || currentRun.accountId !== binding.accountId || currentRun.packageId !== binding.packageId || currentRun.demoSourceContentHash !== binding.sourceContentHash || run.demoSourceContentHash !== binding.sourceContentHash) throw blocked('The paid demonstration run no longer matches its frozen authorization.')
  if (!currentProfile || costScopeHash(currentProfile, null) !== binding.profileHash || costScopeHash(profile, null) !== binding.profileHash || currentRun.profileHash !== binding.profileHash || !currentProfile.enabled || currentProfile.automationConsent !== true || currentProfile.automaticPolicy?.version !== 'account-automation-v1' || currentProfile.automaticPolicy?.scope !== 'research-generation-and-social-publishing' || currentProfile.automaticPolicy?.consentedBy !== actorUid || currentProfile.automaticPolicy?.paidBudgetMicros !== 0 || await workspaceRole(repository, owner, actorUid) !== 'owner') throw blocked('The account plan, owner role or recurring free-only consent changed.')
  if (!Number.isFinite(Date.parse(currentProfile.automaticPolicy.consentedAt || '')) || Date.parse(currentProfile.automaticPolicy.consentedAt) > now) throw blocked('The account automation consent timestamp is unavailable or invalid.')
  const pack = await repository.studioGet(owner, 'package', binding.packageId)
  const quality = currentRun.qualityRevision
  const budgetOwner = demoBudgetOwner(owner, run.demoAuthorizationId)
  if (quality || run.qualityRevision) {
    const saved = quality && await repository.studioGet(owner, 'automation_demo_review', repairReviewId(currentRun))
    if (!saved || quality.version !== 1 || costScopeHash(quality, null) !== costScopeHash(run.qualityRevision, null) || saved.demoId !== run.demoAuthorizationId || saved.runId !== run.id || saved.packageId !== binding.packageId || saved.review.model !== authorization.model || saved.review.policyVersion !== automaticTextPolicyVersion || saved.review.status !== 'needs_revision' || !saved.review.result || saved.review.responseFailure || saved.review.runId !== quality.reviewId || saved.review.contentHash !== quality.contentHash || saved.review.profileHash !== binding.profileHash || currentRun.publicationId || currentRun.providerPostId) throw blocked('The paid quality revision lacks its actual frozen rejected review.')
    const original = { ...currentRun, qualityRevision: undefined, contentHash: quality.contentHash }
    await settledDemoStage(repository, budgetOwner, original, 'generate')
    await settledDemoStage(repository, budgetOwner, original, 'review')
    if (phase === 'review') await settledDemoStage(repository, budgetOwner, currentRun, 'generate')
  }
  const expectedHash = phase === 'generate' ? quality?.contentHash || binding.sourceContentHash : currentRun.contentHash
  if (!pack || !expectedHash || contentHash(pack) !== expectedHash || (phase === 'review' && (run.contentHash !== expectedHash || currentRun.packageId !== pack.id))) throw blocked('The paid demonstration content changed outside the authorized stage.')
  const budget = await repository.budgetSummary(budgetOwner, 'USD')
  if (budget.limitMicros !== authorization.totalLimitMicros) throw blocked('The paid demonstration needs its own exact shared five-dollar budget.')
  if (quality) {
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
  return async input => {
    const admitted = await assertDemoAuthorization(context)
    if (!admitted) throw blocked('A paid demonstration authorization is required.')
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
      return await generateVertexJson(input, { repository: context.repository, owner: admitted.budgetOwner, requestId, config: scopedConfig, worstCaseModelBound: true, timeoutMs: 110000, ...(request ? { request } : {}), beforeAttempt: async () => { await assertDemoAuthorization(context); if (beforeAttempt) await beforeAttempt() } })
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
