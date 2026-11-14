import { randomUUID, createHash } from 'node:crypto'
import { costScopeHash } from '../budget/policy.js'
import { workspaceRole } from '../studio/workspaces.js'
import { automaticTextPolicyVersion } from './review.js'
import { contentHash } from '../studio/approval.js'
import { accountStrategyFeedback } from '../studio/strategy-workflow.js'
import { currentFreeCampaign, assertFreeCampaign, finishFreeCampaign } from './campaign.js'
import { nativePublishedUrl } from '../publishing/provider.js'
import { demoStageRequestId, demoAuthorizationSchema, demoAuthorizationActive, assertDemoQualityRepair, assertDemoReviewFormatRetry, assertDemoSourceContinuation, assertDemoRunContinuation, demoSerialLeaseId, demoBudgetOwner, paidRateRejection } from './demo.js'

export const automationRegistryOwner = '__automation_registry__'
const digest = value => createHash('sha256').update(value).digest('hex')
const dayInZone = (now, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const requestId = value => { const hash = digest(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}` }
const stageRequestId = (unitId, phase, run) => run.demoAuthorizationId && ['generate', 'review'].includes(phase) ? demoStageRequestId(run, phase) : requestId(`${unitId}:${phase}${phase === 'review' ? `:${automaticTextPolicyVersion}${run.contentHash ? `:content:${run.contentHash}` : ''}` : ''}${run.qualityRevision && phase !== 'research' ? ':quality:1' : run.replacements?.[phase] ? ':replacement:1' : ''}`)
const phases = ['research', 'generate', 'review', 'render', 'publish']
const held = status => !['blocked', 'skipped'].includes(status)
const campaignPollLimit = 8
const campaignPollInterval = 10000

async function recoverUndispatchedPaidPublication({ repository, owner, profile, run, services }) {
  if (!run?.demoAuthorizationId || run.status !== 'blocked' || run.stage !== 'publish' || run.preDispatchRecovery || run.publicationId || run.providerPostId || run.releaseUrl || typeof services.recoverPublication !== 'function') return run
  if (run.error !== 'The stage was blocked before dispatch.' || run.stages?.some(stage => stage.stage === 'publish') || !run.stages?.some(stage => stage.stage === 'render' && stage.status === 'completed') || !run.assetIds?.length) return run
  const id = digest(`${run.id}:pre-dispatch-publication-recovery:1`).slice(0, 32)
  if (await repository.studioGet(owner, 'automation_recovery', id)) return run
  const publicationRequestId = stageRequestId(run.id, 'publish', run)
  const packageIds = new Set([run.packageId, digest(`${run.id}:package`).slice(0, 32)])
  const receipts = await repository.studioList(owner, 'social_publication')
  if (receipts.some(receipt => packageIds.has(receipt.packageId) || receipt.requestId === publicationRequestId)) return run
  try {
    if (!await assertDemoRunContinuation({ repository, owner, actorUid: run.actorUid, run, profile })) return run
    const assessment = await services.recoverPublication({ repository, owner, profile, run, actorUid: run.actorUid, requestId: publicationRequestId })
    if (!assessment?.eligible) return run
    const current = await repository.studioGet(owner, 'automation_run', run.id)
    if (current?.revision !== run.revision || (await repository.studioList(owner, 'social_publication')).some(receipt => packageIds.has(receipt.packageId) || receipt.requestId === publicationRequestId)) return run
    await assertDemoRunContinuation({ repository, owner, actorUid: run.actorUid, run, profile })
    // Save the immutable failed state before resuming once; no generation, review or asset IDs change.
    const recovery = await repository.studioPut(owner, 'automation_recovery', id, { version: 'undispatched-paid-publication-v1', runId: run.id, packageId: run.packageId, requestId: publicationRequestId, contentHash: run.contentHash, profileHash: run.profileHash, previousRun: run, assessment: { eligible: true, textPolicy: automaticTextPolicyVersion, checkedAt: new Date().toISOString() } }, 0)
    return await repository.studioPut(owner, 'automation_run', run.id, { ...run, status: 'pending', error: null, preDispatchRecovery: { version: 1, recoveryId: recovery.id, requestId: publicationRequestId } }, run.revision)
  } catch { return run }
}
function campaignPollState(run, now) {
  if (!run.receiptPolling) return { attempts: 0, startedAt: now.toISOString(), nextAt: now.toISOString(), deadlineAt: new Date(now.getTime() + 180000).toISOString(), lastStatus: 'awaiting_receipt' }
  const value = run.receiptPolling
  if (!Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > campaignPollLimit || !Number.isFinite(Date.parse(value.nextAt)) || !Number.isFinite(Date.parse(value.startedAt)) || Date.parse(value.deadlineAt) > Date.parse(value.startedAt) + 180000 || !Number.isFinite(Date.parse(value.deadlineAt))) return { ...value, attempts: campaignPollLimit }
  return value
}
function campaignPollDelay(run, now) {
  const poll = campaignPollState(run, now)
  return poll.attempts < campaignPollLimit && Date.parse(poll.deadlineAt) > now.getTime() && Date.parse(poll.nextAt) <= Date.parse(poll.deadlineAt) ? Math.min(campaignPollInterval, Math.max(0, Date.parse(poll.nextAt) - now.getTime())) : null
}
async function pollCampaignReceipt({ repository, owner, profile, run, services, now }) {
  const leaseId = `campaign-receipt:${owner}:${run.id}`; const leaseOwner = randomUUID()
  if (!await repository.acquireLease(leaseId, leaseOwner, 90000)) return { busy: true }
  try {
    run = await repository.studioGet(owner, 'automation_run', run.id)
    if (run?.status !== 'awaiting_receipt') return
    const delay = campaignPollDelay(run, now)
    if (delay === null || delay > 0) return
    const currentProfile = await repository.studioGet(owner, 'account_profile', profile.id)
    if (!currentProfile || costScopeHash(currentProfile, null) !== run.profileHash || !await authorizedProfile(repository, owner, currentProfile)) return
    await assertFreeCampaign({ repository, owner, profile: currentProfile, run, actorUid: run.actorUid }, { now })
    await assertDemoRunContinuation({ repository, owner, profile: currentProfile, run, actorUid: run.actorUid }, now.getTime())
    const poll = campaignPollState(run, now)
    run = await repository.studioPut(owner, 'automation_run', run.id, { ...run, receiptPolling: { ...poll, attempts: poll.attempts + 1, nextAt: new Date(now.getTime() + campaignPollInterval).toISOString(), lastStatus: 'checking' } }, run.revision)
    try {
      const receipt = await services.readback({ repository, owner, profile: currentProfile, run, actorUid: run.actorUid, freeOnly: true, paidBudgetMicros: 0 })
      const checkedNow = new Date(Math.max(now.getTime(), Date.now()))
      await assertFreeCampaign({ repository, owner, profile: currentProfile, run, actorUid: run.actorUid }, { now: checkedNow })
      await assertDemoRunContinuation({ repository, owner, profile: currentProfile, run, actorUid: run.actorUid }, checkedNow.getTime())
      const status = receipt?.status === 'published' && nativePublishedUrl(currentProfile.platform, receipt.releaseUrl) ? 'completed' : receipt?.status === 'failed' ? 'failed' : 'awaiting_receipt'
      await repository.studioPut(owner, 'automation_run', run.id, { ...run, status, providerPostId: receipt?.providerPostId || run.providerPostId, releaseUrl: status === 'completed' ? receipt.releaseUrl : null, lastReadbackAt: checkedNow.toISOString(), receiptPolling: { ...run.receiptPolling, nextAt: new Date(checkedNow.getTime() + campaignPollInterval).toISOString(), lastStatus: receipt?.status || 'unavailable', error: null } }, run.revision)
    } catch {
      const current = await repository.studioGet(owner, 'automation_run', run.id)
      if (current?.revision === run.revision) await repository.studioPut(owner, 'automation_run', run.id, { ...run, receiptPolling: { ...run.receiptPolling, lastStatus: 'unavailable', error: 'Publication readback is unavailable; the submitted post was not retried.' } }, run.revision)
    }
  } catch { /* A held campaign cannot poll or dispatch; its existing receipt remains visible. */ }
  finally { await repository.releaseLease(leaseId, leaseOwner) }
}

export function planAccountWeek(profile, now = new Date()) {
  const timezone = profile.timezone || 'Asia/Calcutta'
  const localDate = dayInZone(now, timezone)
  const monday = new Date(`${localDate}T00:00:00.000Z`)
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  const cadence = Math.max(0, Math.min(14, Number.isInteger(profile.weeklyCadence) ? profile.weeklyCadence : 0))
  const cap = Math.max(1, Math.min(10, Number.isInteger(profile.maxDailyPosts) ? profile.maxDailyPosts : 1))
  const weekly = Array.from({ length: cadence }, (_, index) => Math.floor(index * 7 / cadence))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday); date.setUTCDate(date.getUTCDate() + index)
    const slots = [...weekly.filter(day => day === index).map((_day, slot) => ({ kind: 'weekly', index: slot })), ...(profile.dailyNews ? [{ kind: 'news', index: 0 }] : [])]
    return { date: date.toISOString().slice(0, 10), slots: slots.slice(0, cap), deferredSlots: Math.max(0, slots.length - cap) }
  })
  return { weekStart: monday.toISOString().slice(0, 10), timezone, localDate, days, scope: 'editorial-slots-not-invented-topics', limitations: ['The requested weekly cadence reserves slots first; daily news fills remaining daily capacity without bypassing publication limits. Actual topics require current source research.'] }
}

async function authorizedProfile(repository, owner, profile) {
  const actorUid = profile.automaticPolicy?.consentedBy
  return Boolean(profile.enabled && profile.automationConsent && profile.automaticPolicy?.version === 'account-automation-v1'
    && profile.automaticPolicy?.scope === 'research-generation-and-social-publishing' && profile.automaticPolicy?.paidBudgetMicros === 0
    && actorUid && await workspaceRole(repository, owner, actorUid) === 'owner')
}

async function currentEvergreenDemo(repository, owner, profile, localDate, now) {
  const profileHash = costScopeHash(profile, null)
  const candidates = (await repository.studioList(owner, 'automation_run')).filter(run => run.accountId === profile.accountId && run.localDate === localDate && run.slot?.kind === 'evergreen-demo' && Object.hasOwn(run, 'demoAuthorizationId')).slice(0, 10)
  const valid = []
  for (const run of candidates) {
    const record = await repository.studioGet(owner, 'automation_demo', run.demoAuthorizationId)
    const parsed = demoAuthorizationSchema.safeParse(Object.fromEntries(Object.keys(demoAuthorizationSchema.shape).map(key => [key, record?.[key]])))
    if (!parsed.success) continue
    const authorization = parsed.data
    if (authorization.sourceCampaignContinuation) { try { await assertDemoSourceContinuation(repository, owner, authorization, now.getTime()) } catch { continue } }
    const binding = authorization.runs.find(value => value.runId === run.id)
    if (!demoAuthorizationActive(authorization, now.getTime()) || !['generate', 'review', 'render', 'publish'].includes(run.stage) || authorization.owner !== owner || authorization.actorUid !== profile.automaticPolicy?.consentedBy || !binding || binding.accountId !== profile.accountId || binding.profileId !== profile.id || binding.profileHash !== profileHash || run.profileHash !== profileHash || binding.packageId !== run.packageId || binding.sourceContentHash !== run.demoSourceContentHash) continue
    if (run.qualityRevision && (run.qualityRevision.version !== 1 || typeof run.qualityRevision.reviewId !== 'string' || !run.qualityRevision.reviewId || !/^[a-f0-9]{64}$/.test(run.qualityRevision.contentHash || '') || typeof run.qualityRevision.instruction !== 'string' || !run.qualityRevision.instruction.trim())) continue
    if (run.reviewFormatRetry && (run.reviewFormatRetry.version !== 1 || typeof run.reviewFormatRetry.reviewId !== 'string' || !run.reviewFormatRetry.reviewId || !/^[a-f0-9]{64}$/.test(run.reviewFormatRetry.contentHash || ''))) continue
    const pack = await repository.studioGet(owner, 'package', binding.packageId)
    if (!pack || contentHash(pack) !== (run.stage === 'generate' ? run.qualityRevision?.contentHash || binding.sourceContentHash : run.contentHash)) continue
    valid.push(authorization.sourceCampaignContinuation ? { ...run, sourceCampaignContinuation: authorization.sourceCampaignContinuation } : run)
  }
  // Conflicting operator records do not select an arbitrary paid operation.
  return valid.length === 1 && candidates.length === 1 ? valid[0] : candidates.length ? { ...candidates[0], demoSelectionHeld: true } : null
}

// Services perform the actual admitted provider operations; each receives a stable request ID and a zero paid ceiling.
export async function runAccountAutomation(input) {
  const { repository, owner, profile, now = new Date() } = input
  const candidate = await currentEvergreenDemo(repository, owner, profile, dayInZone(now, profile.timezone || 'Asia/Calcutta'), now)
  if (!candidate?.sourceCampaignContinuation || candidate.demoSelectionHeld) return runAccountStages(input)
  const authorization = await assertDemoRunContinuation({ repository, owner, profile, run: candidate, actorUid: profile.automaticPolicy?.consentedBy }, now.getTime())
  const lease = { id: demoSerialLeaseId(owner, candidate.demoAuthorizationId), owner: randomUUID() }
  if (!await repository.acquireLease(lease.id, lease.owner, 270000)) {
    const id = digest(`${candidate.demoAuthorizationId}:${candidate.id}`).slice(0, 32)
    const previous = await repository.studioGet(owner, 'automation_demo_wait', id)
    const attempts = (Number.isInteger(previous?.attempts) ? previous.attempts : 0) + 1
    const startedAt = previous?.startedAt || now.toISOString()
    const stopped = attempts > 90 || now.getTime() - Date.parse(startedAt) >= 450000
    try { await repository.studioPut(owner, 'automation_demo_wait', id, { runId: candidate.id, demoId: candidate.demoAuthorizationId, attempts, startedAt, status: stopped ? 'exhausted' : 'waiting' }, previous?.revision || 0) } catch { /* Concurrent admissions cannot start another paid call. */ }
    return { accountId: profile.accountId, results: [{ id: candidate.id, status: stopped ? 'held' : 'busy', reason: stopped ? 'Bounded serialized demo waiting ended; no inference was dispatched.' : 'Another account holds this paid demo stage lease.' }], deferred: !stopped, ...(!stopped ? { retryAfterMs: 5000 } : {}) }
  }
  try {
    let current = await repository.studioGet(owner, 'automation_run', candidate.id)
    if (current.stage === 'generate' && ['blocked', 'dispatch_unknown'].includes(current.status) && !current.providerRateRetry && !current.qualityRevision && !current.reviewFormatRetry && !current.publicationId && !current.providerPostId && !current.releaseUrl && !current.stages?.some(stage => stage.stage === 'publish')) {
      try {
        const rejected = await paidRateRejection(repository, owner, current)
        const recoveryId = digest(`${current.id}:paid-generation-rate-retry:1`).slice(0, 32)
        const receipts = await repository.studioList(owner, 'social_publication')
        if (!await repository.studioGet(owner, 'automation_recovery', recoveryId) && !receipts.some(receipt => [current.packageId, digest(`${current.id}:package`).slice(0, 32)].includes(receipt.packageId) || receipt.requestId === stageRequestId(current.id, 'publish', current))) {
          await assertDemoRunContinuation({ repository, owner, profile, run: current, actorUid: current.actorUid })
          await repository.studioPut(owner, 'automation_recovery', recoveryId, { version: 'paid-generation-rate-retry-v1', runId: current.id, previousRun: current, job: rejected.job, proof: rejected.proof, cost: rejected.cost }, 0)
          current = await repository.studioPut(owner, 'automation_run', current.id, { ...current, status: 'pending', error: null, providerRateRetry: { version: 1, recoveryId, jobId: rejected.job.id, notBefore: rejected.notBefore } }, current.revision)
        }
      } catch { /* Actual ambiguous or billable provider outcomes remain held without retries. */ }
    }
    if (current.status === 'pending' && current.providerRateRetry && now.getTime() < Date.parse(current.providerRateRetry.notBefore)) return { accountId: profile.accountId, results: [{ id: current.id, status: 'held', reason: 'The confirmed nonbillable rate rejection is waiting for its bounded retry window.' }], deferred: false, continuationPending: true }
    if ((await repository.budgetSummary(demoBudgetOwner(owner, candidate.demoAuthorizationId), 'USD')).heldMicros > 0) return { accountId: profile.accountId, results: [{ id: candidate.id, status: 'held', reason: 'A paid demo cost remains unresolved; no additional paid inference was dispatched.' }], deferred: false, ...(['generate', 'review'].includes(current.stage) && current.status === 'pending' ? { continuationPending: true } : {}) }
    if (!authorization) throw new Error('The continuation authorization is unavailable')
    return await runAccountStages({ ...input, now, maxStages: 1, continuationRun: candidate, demoLease: lease })
  } finally { await repository.releaseLease(lease.id, lease.owner) }
}

async function runAccountStages({ repository, owner, profile, services, now = new Date(), maxSlots = 1, maxStages = Infinity, continuationRun = null, demoLease }) {
  if (!await authorizedProfile(repository, owner, profile)) return { accountId: profile.accountId, status: 'blocked', reason: 'Current owner consent for free account automation is required.' }
  if (phases.some(phase => typeof services?.[phase] !== 'function')) return { accountId: profile.accountId, status: 'blocked', reason: 'Account automation services are not configured.' }
  const plan = planAccountWeek(profile, now)
  const campaignSelection = continuationRun ? null : await currentFreeCampaign({ repository, owner, profile, now })
  const strategyFeedback = await accountStrategyFeedback(repository, owner, profile, now)
  let campaignPollBusy = false
  if (typeof services.readback === 'function') {
    const pending = (await repository.studioList(owner, 'automation_run')).filter(run => run.accountId === profile.accountId && run.status === 'awaiting_receipt').slice(0, 10)
    for (const run of pending) {
      if (run.campaignId || run.demoAuthorizationId) { if ((await pollCampaignReceipt({ repository, owner, profile, run, services, now }))?.busy) campaignPollBusy = true; continue }
      try {
        const receipt = await services.readback({ repository, owner, profile, run, actorUid: profile.automaticPolicy.consentedBy, freeOnly: true, paidBudgetMicros: 0 })
        if (['published', 'scheduled', 'draft', 'failed'].includes(receipt?.status)) await repository.studioPut(owner, 'automation_run', run.id, { ...run, status: receipt.status === 'failed' ? 'failed' : receipt.status === 'scheduled' ? 'awaiting_receipt' : 'completed', providerPostId: receipt.providerPostId || run.providerPostId, releaseUrl: receipt.releaseUrl || null, lastReadbackAt: new Date().toISOString() }, run.revision)
      } catch { /* Readback never starts a second publication. */ }
    }
  }
  await finishFreeCampaign(repository, owner, campaignSelection?.campaign?.id, now)
  if (campaignSelection?.held) return { accountId: profile.accountId, localDate: plan.localDate, results: [{ status: 'held', reason: campaignSelection.reason }], deferred: false }
  const profileHash = costScopeHash(profile, null)
  const planId = digest(`${profile.accountId}:${plan.weekStart}`).slice(0, 32)
  const savedPlan = await repository.studioGet(owner, 'automation_plan', planId)
  if (!savedPlan || savedPlan.profileHash !== profileHash || digest(JSON.stringify(savedPlan.strategyFeedback || null)) !== digest(JSON.stringify(strategyFeedback))) await repository.studioPut(owner, 'automation_plan', planId, { ...plan, accountId: profile.accountId, profileHash, weeklyBrief: profile.weeklyBrief, audience: profile.audience, tone: profile.tone, contentPillars: profile.contentPillars, strategyFeedback }, savedPlan?.revision || 0)
  const day = plan.days.find(day => day.date === plan.localDate)
  const demoRun = continuationRun || (campaignSelection ? null : await currentEvergreenDemo(repository, owner, profile, plan.localDate, now))
  if (demoRun?.demoSelectionHeld) return { accountId: profile.accountId, planId, localDate: plan.localDate, results: [{ id: demoRun.id, status: 'held', reason: 'The current-day evergreen demo authorization is invalid, expired or conflicting. No ordinary research fallback was started.' }], deferred: false }
  const slots = campaignSelection ? [campaignSelection.slot] : demoRun ? [demoRun.slot] : day.slots
  const results = []; let processed = 0; let deferred = false; let completedStages = 0
  const stageLimit = Number.isFinite(maxStages) ? Math.max(1, Math.floor(maxStages)) : Infinity
  for (const slot of slots) {
    if (processed >= Math.max(1, Math.min(10, maxSlots))) { deferred = true; break }
    const unitId = campaignSelection ? campaignSelection.runId : demoRun ? demoRun.id : digest(`${profile.accountId}:${plan.localDate}:${slot.kind}:${slot.index}`).slice(0, 32)
    const leaseId = `automation:${owner}:${profile.accountId}`; const leaseOwner = randomUUID()
    if (!await repository.acquireLease(leaseId, leaseOwner, 600000)) { results.push({ id: unitId, status: 'busy' }); break }
    try {
      let run = await repository.studioGet(owner, 'automation_run', unitId)
      if (continuationRun) run = await recoverUndispatchedPaidPublication({ repository, owner, profile, run, services })
      if (campaignSelection && run && (run.campaignId !== campaignSelection.campaign.id || run.campaignHash !== campaignSelection.campaignHash)) { results.push({ id: unitId, status: 'held', reason: 'The one-off campaign changed; no replacement post was started.' }); continue }
      if (demoRun && run?.status === 'blocked' && run.stage === 'review' && !run.publicationId && !run.providerPostId) {
        const pack = await repository.studioGet(owner, 'package', run.packageId)
        const actual = pack?.automaticReview
        const knownQuality = !run.qualityRevision && actual?.status === 'needs_revision' && actual.result && !actual.responseFailure
        const knownFormat = !run.reviewFormatRetry && actual?.status === 'blocked' && !actual.result && actual.responseFailure?.code === 'MODEL_SCHEMA_INVALID' && actual.responseFailure.outcome === 'invalid_response' && actual.responseFailure.schemaIssues?.length
        if ((knownQuality || knownFormat) && actual.policyVersion === automaticTextPolicyVersion && actual.contentHash === run.contentHash && actual.contentHash === contentHash(pack) && actual.profileHash === profileHash && run.stages?.some(stage => stage.stage === 'review' && stage.requestId === stageRequestId(unitId, 'review', run) && stage.status === actual.status)) {
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, status: 'review_running' }, run.revision)
          try { await (knownQuality ? assertDemoQualityRepair : assertDemoReviewFormatRetry)({ repository, owner, actorUid: run.actorUid, run, profile, phase: 'review' }) }
          catch { run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, status: 'blocked', error: 'The saved failed review remains held; paid quality repair was not admitted.' }, run.revision); results.push(run); continue }
        }
      }
      if (run && (['completed', 'blocked', 'failed', 'awaiting_receipt'].includes(run.status) || run.profileHash !== profileHash)) { results.push(run); continue }
      let reconciled
      if (run?.status.endsWith('_running') || run?.status === 'dispatch_unknown') {
        if (typeof services.reconcile === 'function') {
          try { reconciled = await services.reconcile({ repository, owner, profile, run, phase: run.stage, requestId: stageRequestId(unitId, run.stage, run), actorUid: profile.automaticPolicy.consentedBy, freeOnly: true, paidBudgetMicros: 0 }) }
          catch { /* Reconciliation may read receipts, never repeat provider dispatch. */ }
        }
        if (reconciled?.status === 'free_text_replacement_available') {
          if (run.demoAuthorizationId || run.qualityRevision || !['research', 'generate'].includes(run.stage) || run.replacements?.[run.stage] || reconciled.replacementOf !== stageRequestId(unitId, run.stage, run)) { results.push(run); continue }
          const replacement = { originalRequestId: reconciled.replacementOf, replacementRequestId: requestId(`${unitId}:${run.stage}:replacement:1`), reason: 'One new free text operation after local provider timeout; original outcome remains unknown.', createdAt: new Date().toISOString() }
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, replacements: { ...run.replacements, [run.stage]: replacement }, status: 'pending', error: null }, run.revision)
          reconciled = null
        } else if (!reconciled || ['reserved', 'running', 'dispatch_unknown', 'pending'].includes(reconciled.status)) {
          if (run.status !== 'dispatch_unknown') run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, status: 'dispatch_unknown', error: 'A prior worker stopped during a provider operation. Its receipt remains uncertain; no automatic retry was sent.' }, run.revision)
          results.push(run); continue
        }
        if (run.status !== 'pending') run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, status: 'pending', error: null }, run.revision)
      }
      const existingRuns = await repository.studioList(owner, 'automation_run')
      const publications = await repository.studioList(owner, 'social_publication')
      const todayRuns = existingRuns.filter(value => value.id !== unitId && value.accountId === profile.accountId && value.localDate === plan.localDate && held(value.status))
      const todayPosts = publications.filter(value => value.accountId === profile.accountId && value.status !== 'blocked' && dayInZone(new Date(value.publishAt || value.dispatchedAt || value.createdAt), plan.timezone) === plan.localDate)
      const represented = new Set(todayRuns.map(value => value.publicationId).filter(Boolean))
      if ((!run || demoRun) && todayRuns.length + todayPosts.filter(value => !represented.has(value.id) && value.id !== run?.publicationId).length >= profile.maxDailyPosts) { results.push({ id: unitId, status: 'skipped', reason: 'Daily cap includes existing and uncertain publication attempts.' }); continue }
      if (!run) run = await repository.studioPut(owner, 'automation_run', unitId, { accountId: profile.accountId, platform: profile.platform, localDate: plan.localDate, slot, profileHash, status: 'pending', stage: 'research', actorUid: profile.automaticPolicy.consentedBy, paidBudgetMicros: 0, stages: [], packageId: null, publicationId: null, ...(campaignSelection ? { campaignId: campaignSelection.campaign.id, campaignHash: campaignSelection.campaignHash, campaignReferenceUrl: campaignSelection.campaign.referenceUrl, campaignTopic: campaignSelection.campaign.topic } : {}) }, 0)
      processed++
      for (const phase of phases.slice(phases.indexOf(run.stage))) {
        const currentProfile = await repository.studioGet(owner, 'account_profile', profile.id)
        if (!currentProfile || costScopeHash(currentProfile, null) !== profileHash || !await authorizedProfile(repository, owner, currentProfile)) {
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, status: 'blocked', error: 'Account profile or owner consent changed before the next stage.' }, run.revision); break
        }
        try { await assertFreeCampaign({ repository, owner, profile: currentProfile, run, actorUid: run.actorUid }, { now }); await assertDemoRunContinuation({ repository, owner, profile: currentProfile, run, actorUid: run.actorUid }, now.getTime()) }
        catch { run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, status: 'blocked', error: 'The one-off campaign changed or expired before the next stage.' }, run.revision); break }
        const id = stageRequestId(unitId, phase, run)
        run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stage: phase, status: `${phase}_running` }, run.revision)
        let result
        try {
          result = reconciled || await services[phase]({ repository, owner, profile: currentProfile, slot, localDate: plan.localDate, now, run, requestId: id, replacementOf: run.qualityRevision ? undefined : run.replacements?.[phase]?.originalRequestId, actorUid: run.actorUid, freeOnly: !run.demoAuthorizationId, paidBudgetMicros: 0, demoLease })
          reconciled = null
        } catch (error) {
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, status: error.preDispatch === true ? 'blocked' : 'dispatch_unknown', error: error.preDispatch === true ? 'The stage was blocked before dispatch.' : 'Stage outcome is uncertain. Reconcile its actual job or provider receipt before any retry.', stageFailure: { stage: phase, requestId: id, preDispatch: error.preDispatch === true, code: typeof error.code === 'string' ? error.code.slice(0, 80) : null, detail: typeof error.publicMessage === 'string' ? error.publicMessage.slice(0, 2000) : null, checkedAt: new Date().toISOString() } }, run.revision); break
        }
        const outcome = result?.receipt || result
        const stageRecord = { stage: phase, requestId: id, status: outcome?.status || (result?.eligible === false ? 'blocked' : 'completed'), completedAt: new Date().toISOString(), jobId: result?.jobId || null }
        if (phase === 'review' && run.demoAuthorizationId && !run.reviewFormatRetry && result?.status === 'blocked' && !result.reviewResult && result.responseFailure?.code === 'MODEL_SCHEMA_INVALID' && result.responseFailure.outcome === 'invalid_response' && result.responseFailure.schemaIssues?.length && !run.publicationId && !run.providerPostId) {
          try { await assertDemoReviewFormatRetry({ repository, owner, actorUid: run.actorUid, run, profile: currentProfile, phase: 'review' }) }
          catch { run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stages: [...run.stages, stageRecord], status: 'blocked', error: 'The review format correction was not admitted; no additional evaluator request was started.' }, run.revision); break }
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stages: [...run.stages, stageRecord], reviewFormatRetry: { version: 1, reviewId: result.reviewId, contentHash: result.contentHash }, stage: 'review', status: 'pending', error: null }, run.revision)
          deferred = true; break
        }
        if (phase === 'review' && ['needs_revision', 'blocked'].includes(result?.status) && result.repairable === true && (result.reviewResult || result.preflightIssues?.length > 0) && result.reviewId && result.contentHash && !run.qualityRevision && !run.publicationId && !run.providerPostId && Array.isArray(result.issues) && result.issues.some(issue => typeof issue === 'string' && issue.trim())) {
          if (run.demoAuthorizationId) {
            if (result.status !== 'needs_revision' || !result.reviewResult) { run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stages: [...run.stages, stageRecord], status: 'blocked', error: 'A paid quality repair requires a complete failed model review.', findings: result.issues }, run.revision); break }
            try { await assertDemoQualityRepair({ repository, owner, actorUid: run.actorUid, run, profile: currentProfile, phase: 'review' }) }
            catch { run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stages: [...run.stages, stageRecord], status: 'blocked', error: 'The paid demo quality repair was not admitted; no additional provider operation was started.', findings: result.issues }, run.revision); break }
          }
          const issues = result.issues.filter(issue => typeof issue === 'string').slice(0, 20)
          const instruction = `Resolve the recorded automated review findings using only supported source passages. Preserve qualifications and citations; omit unsupported claims rather than inventing support. Findings: ${issues.slice(0, 8).map(issue => issue.slice(0, 200)).join(' | ')}`.slice(0, 1900)
          const qualityRevision = { version: 1, reviewRequestId: id, reviewId: result.reviewId, contentHash: result.contentHash, instruction, issues, createdAt: new Date().toISOString() }
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stages: [...run.stages, stageRecord], qualityRevision, stage: 'generate', status: 'pending', assetIds: [], publicationId: null, providerPostId: null, releaseUrl: null, error: null }, run.revision)
          deferred = true
          break
        }
        if (!result || result.eligible === false || ['blocked', 'failed', 'needs_revision'].includes(outcome?.status)) {
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stages: [...run.stages, stageRecord], status: 'blocked', error: 'Stage checks did not permit automatic continuation.', findings: result?.issues || [] }, run.revision); break
        }
        if (['reserved', 'running', 'dispatch_unknown', 'pending'].includes(outcome?.status)) {
          run = await repository.studioPut(owner, 'automation_run', unitId, { ...run, stages: [...run.stages, stageRecord], status: 'dispatch_unknown', jobId: result.jobId || null, error: 'An admitted operation has not completed. Reconcile its stable job before continuing.' }, run.revision)
          if (outcome.status === 'dispatch_unknown' && !run.demoAuthorizationId && !run.qualityRevision && ['research', 'generate'].includes(phase) && !run.replacements?.[phase] && typeof services.reconcile === 'function') {
            try {
              const available = await services.reconcile({ repository, owner, profile: currentProfile, run, phase, requestId: id, actorUid: run.actorUid, freeOnly: true, paidBudgetMicros: 0 })
              deferred = available?.status === 'free_text_replacement_available' && available.replacementOf === id
            } catch { /* Failed readback never schedules another provider operation. */ }
          }
          break
        }
        const next = { ...run, stages: [...run.stages, stageRecord], status: 'pending' }
        if (phase === 'review') { next.findings = []; next.error = null }
        if (phase === 'research') {
          if (!Array.isArray(result.topics) || !result.topics.length) { run = await repository.studioPut(owner, 'automation_run', unitId, { ...next, status: 'blocked', error: 'No source-supported topic was available.' }, run.revision); break }
          const priorTopics = new Set(existingRuns.filter(value => value.accountId === profile.accountId && value.topicHash && held(value.status)).map(value => value.topicHash))
          const currentFeedback = await accountStrategyFeedback(repository, owner, currentProfile, now)
          const normalize = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
          const matches = (title, subject) => normalize(title) === normalize(subject) || normalize(subject).length >= 8 && normalize(title).includes(normalize(subject))
          const ranked = [...result.topics].sort((a, b) => Number(currentFeedback.priorityTopics.some(subject => matches(b.title, subject))) - Number(currentFeedback.priorityTopics.some(subject => matches(a.title, subject))))
          const topic = ranked.find(topic => typeof topic.title === 'string' && topic.title.trim() && !currentFeedback.stoppedTopics.some(subject => matches(topic.title, subject)) && (topic.evidenceHash || topic.evidenceIds?.length) && !priorTopics.has(costScopeHash({ title: topic.title, evidenceHash: topic.evidenceHash, evidenceIds: topic.evidenceIds }, null)))
          if (!topic) { run = await repository.studioPut(owner, 'automation_run', unitId, { ...next, status: 'blocked', error: 'Every supported topic repeats an existing account opportunity.' }, run.revision); break }
          next.topic = topic; next.topicHash = costScopeHash({ title: topic.title, evidenceHash: topic.evidenceHash, evidenceIds: topic.evidenceIds }, null); next.researchId = result.reportId || result.id || null
        }
        if (phase === 'generate') {
          const pack = result.package || result.result || result
          if (!pack.id || !pack.content) { run = await repository.studioPut(owner, 'automation_run', unitId, { ...next, status: 'blocked', error: 'Generation returned no saved content package.' }, run.revision); break }
          next.packageId = pack.id; next.contentHash = contentHash(pack)
        }
        if (phase === 'render') {
          next.assetIds = (result.assets || []).map(asset => typeof asset === 'string' ? asset : asset.id)
          if (!next.assetIds.length || next.assetIds.some(id => typeof id !== 'string' || !id)) { run = await repository.studioPut(owner, 'automation_run', unitId, { ...next, status: 'blocked', error: 'Rendering returned no saved media assets.' }, run.revision); break }
        }
        if (phase === 'publish') {
          const receipt = result.receipt || result
          next.publicationId = receipt.id || null; next.providerPostId = receipt.providerPostId || null; next.releaseUrl = receipt.releaseUrl || null
          const oneOff = Boolean(run.campaignId || run.demoAuthorizationId)
          next.status = receipt.status === 'published' && (!oneOff || nativePublishedUrl(currentProfile.platform, receipt.releaseUrl)) || receipt.status === 'draft' && !oneOff ? 'completed' : receipt.status === 'dispatch_unknown' ? 'dispatch_unknown' : 'awaiting_receipt'
          if (oneOff && next.status === 'awaiting_receipt') next.receiptPolling = { attempts: 0, startedAt: now.toISOString(), nextAt: new Date(now.getTime() + campaignPollInterval).toISOString(), deadlineAt: new Date(now.getTime() + 180000).toISOString(), lastStatus: receipt.status || 'awaiting_receipt' }
        }
        next.stage = phases[phases.indexOf(phase) + 1] || 'publish'
        run = await repository.studioPut(owner, 'automation_run', unitId, next, run.revision)
        completedStages++
        if (run.status === 'pending' && completedStages >= stageLimit) { deferred = true; break }
      }
      results.push(run)
      if (deferred || ['blocked', 'failed', 'dispatch_unknown'].includes(run.status)) break
    } finally { await repository.releaseLease(leaseId, leaseOwner) }
  }
  await finishFreeCampaign(repository, owner, campaignSelection?.campaign?.id, now)
  const pendingReceipt = (await repository.studioList(owner, 'automation_run')).find(run => run.accountId === profile.accountId && (run.campaignId || run.demoAuthorizationId) && run.status === 'awaiting_receipt')
  const campaignPending = results.find(run => (run.campaignId || run.demoAuthorizationId) && run.status === 'awaiting_receipt') || pendingReceipt
  const retryAfterMs = campaignPending ? campaignPollBusy ? campaignPollInterval : campaignPollDelay(campaignPending, now) : null
  if (retryAfterMs !== null) deferred = true
  return { accountId: profile.accountId, planId, localDate: plan.localDate, results, deferred, ...(retryAfterMs !== null ? { retryAfterMs } : {}) }
}

export async function runRegisteredAutomation({ repository, services, now = new Date(), limit = 5 }) {
  const outcomes = []; const pending = []
  const owners = (await repository.studioList(automationRegistryOwner, 'automation_owner')).filter(record => record.enabled && typeof record.ownerScope === 'string')
  for (const record of owners) {
    const profiles = (await repository.studioList(record.ownerScope, 'account_profile')).filter(profile => profile.enabled && profile.automationConsent)
    const runs = await repository.studioList(record.ownerScope, 'automation_run')
    for (const profile of profiles) {
      const plan = planAccountWeek(profile, now)
      const slots = plan.days.find(day => day.date === plan.localDate).slots
      const currentRuns = runs.filter(run => run.accountId === profile.accountId && run.localDate === plan.localDate)
      const terminal = currentRuns.filter(run => ['completed', 'blocked', 'failed'].includes(run.status))
      const demo = await currentEvergreenDemo(repository, record.ownerScope, profile, plan.localDate, now)
      const campaign = await currentFreeCampaign({ repository, owner: record.ownerScope, profile, now })
      if (campaign?.held && !demo?.sourceCampaignContinuation && !runs.some(run => run.accountId === profile.accountId && run.status === 'awaiting_receipt')) continue
      const recoverablePublication = demo?.sourceCampaignContinuation && demo.status === 'blocked' && demo.stage === 'publish' && !demo.preDispatchRecovery && !demo.publicationId && !demo.providerPostId && demo.error === 'The stage was blocked before dispatch.' && typeof services.recoverPublication === 'function'
      if (!recoverablePublication && !campaign && (!demo || ['completed', 'blocked', 'failed'].includes(demo.status)) && slots.every(slot => terminal.some(run => run.slot.kind === slot.kind && run.slot.index === slot.index)) && !runs.some(run => run.accountId === profile.accountId && run.status === 'awaiting_receipt')) continue
      pending.push({ owner: record.ownerScope, profile })
    }
  }
  if (!pending.length) return { outcomes, deferred: false }
  const cursor = await repository.studioGet(automationRegistryOwner, 'automation_control', 'registered_batch')
  const start = (cursor?.offset || 0) % pending.length
  const batchSize = Math.max(1, Math.min(20, Number.isInteger(limit) ? limit : 5))
  const selected = Array.from({ length: Math.min(batchSize, pending.length) }, (_, index) => pending[(start + index) % pending.length])
  for (const target of selected) outcomes.push(await runAccountAutomation({ repository, ...target, services, now }))
  try { await repository.studioPut(automationRegistryOwner, 'automation_control', 'registered_batch', { offset: (start + selected.length) % pending.length }, cursor?.revision || 0) }
  catch (error) { if (error.code !== 'STUDIO_CONFLICT') throw error }
  return { outcomes, deferred: pending.length > selected.length }
}
