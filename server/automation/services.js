import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { costScopeHash } from '../budget/policy.js'
import { reserveFreeOperation } from '../budget/free-operation.js'
import { createResearch, nicheSchema, researchNiche, refreshAvailableAt, researchScopeKey, freeTextReplacementJob } from '../studio/intelligence.js'
import { generateContent, reviewContent, settingsSchema } from '../studio/content.js'
import { contentAlignment } from '../studio/content-alignment.js'
import { runContentJob } from '../studio/job-worker.js'
import { contentHash } from '../studio/approval.js'
import { fetchEvidence } from '../studio/evidence.js'
import { workspaceRole } from '../studio/workspaces.js'
import { assessRelease } from '../studio/release.js'
import { generateJson } from '../providers/llm.js'
import { reviewAutomaticText, assessAutomaticText, automaticTextPolicyVersion } from './review.js'
import { renderLocalMedia } from '../media/render.js'
import { saveMediaFile, readMediaFile } from '../media/files.js'
import { inspectMediaBytes, assessAutomaticMedia, assessMediaAcceptance } from '../media/acceptance.js'
import { approvedCaption, createPublishingService } from '../publishing/router.js'
import { runAccountAutomation } from './runner.js'
import { assertCapability } from '../policy.js'
import { assertDemoAuthorization, createDemoGenerator, demoStageRequestId, assertDemoRunContinuation } from './demo.js'
import { buildAssurance } from '../studio/assurance.js'
import { generationReceipt } from '../providers/llm.js'
import { safeJobFailure } from '../studio/job-worker.js'
import { accountStrategyFeedback, accountWorkflowTemplate, workflowPrepublicationIssues, workflowGenerationContext } from '../studio/strategy-workflow.js'
import { enrichPackagePublicResearch } from './public-research-intake.js'
import { assertFreeCampaign } from './campaign.js'
import { recordAutomaticStrategyMedia } from './strategy-media.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const uuid = value => { const digest = hash(value); return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}` }
const blocked = message => Object.assign(new Error(message), { preDispatch: true })
const writingConstraint = 'Return the complete requested schema concisely. Use a factual title under 65 characters, at most three supported claims totalling at most 48 words, website body at most 180 words, each planning field one sentence, and short platform adaptations. Preserve necessary attribution, citation markers and source limitations. These length targets do not authorize adding unsupported numbers to the content.'

function reviewOutcome(pack, profile) {
  const actual = pack.automaticReview
  const preflightIssues = actual?.preflightIssues || []
  return { ...assessAutomaticText(pack, profile), status: actual?.status || 'blocked', repairable: actual?.policyVersion === automaticTextPolicyVersion && ((actual?.status === 'needs_revision' && Boolean(actual.result)) || (actual?.status === 'blocked' && preflightIssues.length > 0)), reviewResult: actual?.result || null, responseFailure: actual?.responseFailure || null, preflightIssues, reviewId: actual?.runId || null, contentHash: actual?.contentHash || null }
}

function recordedReviewFeedback(review) {
  return { reviewId: review.runId, contentHash: review.contentHash, issues: [...new Set([...(review.issues || []), ...(review.preflightIssues || []), ...(review.result?.issues || [])])], ratings: review.result?.ratings || null, claims: (review.result?.claims || []).map(({ id, verdict, reason }) => ({ id, verdict, reason })) }
}

function normalizedResearch(report, context) {
  const day = context.localDate || new Date(context.now || Date.now()).toISOString().slice(0, 10)
  const current = Date.parse(`${day}T00:00:00Z`)
  const topics = report.opportunities.map((topic, index) => ({ ...topic, index, evidenceHash: costScopeHash(report.evidence.filter(source => topic.evidenceIds.includes(source.id)), null) })).filter(topic => {
    if (topic.verification !== 'reported') return false
    if (context.slot.kind !== 'news') return true
    const event = Date.parse(`${topic.eventDate}T00:00:00Z`)
    if (!Number.isFinite(event) || event < current - 86400000 || event > current) return false
    return report.evidence.some(source => {
      if (!topic.evidenceIds.includes(source.id)) return false
      const published = Date.parse(source.publishedAt || '')
      const capturedDateMatches = Number.isFinite(published) && published <= new Date(context.now || Date.now()).getTime() && new Date(published).toISOString().slice(0, 10) === topic.eventDate
      return capturedDateMatches || String(source.excerpt || '').includes(topic.eventDate)
    })
  })
  return { status: topics.length ? 'completed' : 'blocked', reportId: report.id, topics, ...(topics.length ? {} : { issues: [context.slot.kind === 'news' ? 'No current news opportunity has a source-captured supporting date. Undated or older topics were not labelled latest.' : 'No source-supported opportunity was available.'] }) }
}

export async function assessAutomationRelease({ repository, owner, pack, assets, profile, actorUid, input, readFile = readMediaFile }) {
  if (!input?.automatic) {
    if (pack.paidContinuation) return { eligible: false, issues: ['This paid continuation clone requires its exact authorized automatic release path.'] }
    const text = await assessRelease(repository, owner, pack)
    const media = assessMediaAcceptance(pack, assets)
    const issues = [...text.issues, ...media.issues]
    if (owner.startsWith('ws:') && !['owner', 'editor'].includes(await workspaceRole(repository, owner, pack.mediaApproval?.approvedBy))) issues.push('The media approver no longer has editing access.')
    return { eligible: issues.length === 0, issues, text, media }
  }
  const issues = []
  if (pack.paidContinuation) {
    const run = await repository.studioGet(owner, 'automation_run', pack.paidContinuation.runId)
    try { if (!run || run.demoAuthorizationId !== pack.paidContinuation.demoAuthorizationId || !await assertDemoRunContinuation({ repository, owner, actorUid, run, profile })) issues.push('The one-off paid continuation is no longer authorized.') } catch { issues.push('The one-off paid continuation changed or expired before release.') }
  }
  const strategyContext = await repository.studioGet(owner, 'complete_context', pack.id)
  if (!input.automatic || !profile || profile.accountId !== input.accountId || profile.platform !== input.platform || profile.automaticPolicy?.consentedBy !== actorUid || await workspaceRole(repository, owner, actorUid) !== 'owner') issues.push('Current account owner consent is required for automatic publishing.')
  const text = assessAutomaticText(pack, profile)
  issues.push(...text.issues)
  for (const [index, sourceId] of (pack.sourceIds || []).entries()) {
    const source = await repository.studioGet(owner, 'library_source', sourceId)
    if (!source || source.reviewStatus !== 'approved' || source.evidence.hash !== pack.evidence[index]?.hash) issues.push('A reviewed library source changed or was withdrawn.')
  }
  const inspections = []
  for (const asset of assets || []) {
    if (!asset) { issues.push('A selected asset is missing.'); continue }
    try { inspections.push(inspectMediaBytes(asset, await readFile(asset.id))) } catch { issues.push('Actual media bytes are unavailable for release checks.') }
  }
  const media = assessAutomaticMedia(pack, assets || [], inspections)
  issues.push(...media.issues)
  const strategyMedia = profile ? await recordAutomaticStrategyMedia(repository, owner, pack, profile, assets || [], inspections) : null
  issues.push(...workflowPrepublicationIssues(pack, strategyContext?.context || {}, input.platform, input.accountId, new Date(), strategyMedia ? [{ record: strategyMedia, profile, assets: assets || [] }] : []))
  return { eligible: issues.length === 0, issues: [...new Set(issues)], text, media, strategyMedia }
}

export function createAutomationServices(repository, { research = researchNiche, fetchSource = fetchEvidence, write = generateContent, evaluate = reviewAutomaticText, render = renderLocalMedia, saveFile = saveMediaFile, readFile = readMediaFile, publisher, demoGenerate = createDemoGenerator, publicResearch = enrichPackagePublicResearch } = {}) {
  const publishing = publisher || createPublishingService({ repository, readFile, assessReady: context => assessAutomationRelease({ ...context, readFile }) })
  async function savedPack(context) {
    const pack = await repository.studioGet(context.owner, 'package', context.run.packageId)
    if (!pack) throw blocked('The automation content package is missing.')
    return pack
  }
  async function checkConsent(context) {
    const current = await repository.studioGet(context.owner, 'account_profile', context.profile.id)
    if (!current?.enabled || !current.automationConsent || costScopeHash(current, null) !== costScopeHash(context.profile, null) || await workspaceRole(repository, context.owner, context.actorUid) !== 'owner') throw Object.assign(blocked('The account plan or owner consent changed before dispatch.'), { code: 'JOB_BLOCKED' })
    await assertFreeCampaign({ ...context, repository })
    await assertDemoRunContinuation({ ...context, repository })
  }
  const boundedGenerate = request => generateJson({ ...request, maxTokens: Math.min(request.maxTokens || 8000, 6000) }, { preferTools: Boolean(request.schema?.properties?.claims && !request.schema?.properties?.ratings), acceptCompleteJsonAtLength: Boolean(request.schema?.properties?.claims), request: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(110000)]) }) })
  async function generateDemo(context, pack) {
    const demoContext = { ...context, repository, phase: 'generate' }
    const authorization = await assertDemoAuthorization(demoContext)
    const binding = authorization.authorization.runs.find(value => value.runId === context.run.id)
    if (!pack || pack.id !== binding?.packageId) throw blocked('The paid demo draft does not match its authorized package.')
    if (context.requestId !== demoStageRequestId(context.run, 'generate')) throw blocked('The paid demo operation identifier does not match this exact run.')
    await checkConsent(context)
    const strategy = await repository.studioGet(context.owner, 'complete_context', pack.id)
    const strategyRevision = strategy?.revision || 0; const strategyHash = costScopeHash(strategy?.context || {}, null)
    const checkStrategy = async () => {
      const current = await repository.studioGet(context.owner, 'complete_context', pack.id)
      if ((current?.revision || 0) !== strategyRevision || costScopeHash(current?.context || {}, null) !== strategyHash) throw blocked('The saved strategy changed during paid writing; its draft was preserved.')
    }
    const quality = context.run.qualityRevision
    let automaticReviewFeedback
    if (quality) {
      const actualReview = pack.automaticReview
      const repairable = actualReview?.status === 'needs_revision' && actualReview.result && !actualReview.responseFailure
      if (quality.version !== 1 || !quality.instruction || quality.contentHash !== contentHash(pack) || actualReview?.policyVersion !== automaticTextPolicyVersion || actualReview?.runId !== quality.reviewId || actualReview?.contentHash !== quality.contentHash || !repairable) throw blocked('Paid quality repair requires the actual failed review of this exact saved content.')
      automaticReviewFeedback = recordedReviewFeedback(actualReview)
    }
    const previous = await repository.studioJobGet(context.owner, context.requestId)
    if (previous) {
      if (previous.scope?.demoId !== context.run.demoAuthorizationId || previous.scope?.packageId !== pack?.id) throw blocked('The paid demo operation belongs to different content.')
      return { status: previous.status, jobId: previous.id, package: previous.result }
    }
    const scope = { operation: 'generation', generationProvider: `${authorization.authorization.provider || 'vertex'}-demo`, demoId: context.run.demoAuthorizationId, packageId: pack.id, revision: pack.revision, actorUid: context.actorUid, contentHash: contentHash(pack), profileHash: costScopeHash(context.profile, null), strategyRevision, strategyHash, model: authorization.model, ...(quality ? { qualityRevisionOf: quality.reviewId } : {}) }
    let admission
    try { admission = await repository.studioJobReserve(context.owner, context.requestId, costScopeHash(scope, null), env.STUDIO_DAILY_GENERATIONS, scope) }
    catch (error) { throw Object.assign(error, { preDispatch: true }) }
    if (!admission.reserved) return { status: admission.job.status, jobId: admission.job.id, package: admission.job.result }
    let job = admission.job; let dispatched = false
    try {
      job = await repository.studioJobUpdate(context.owner, job.id, { status: 'running' }, job.revision, 'reserved')
      const settings = settingsSchema.parse({ ...pack.settings, platform: context.profile.platform, outputs: ['platforms', 'website'] })
      const provider = demoGenerate(demoContext, { beforeAttempt: async () => { await checkConsent(context); await checkStrategy() } })
      const generate = async request => { dispatched = true; return provider(request) }
      const content = await write(pack.evidence, settings, { ...pack.researchContext, topicTitle: pack.title, strategyWorkflow: workflowGenerationContext(strategy?.context || {}), automationAccountId: context.profile.accountId, outputConstraint: writingConstraint, previousContent: quality ? pack.content : null, revisionInstruction: quality?.instruction || 'Write a fresh compact account-specific post and website article from the supplied source passages. Preserve attribution and scope; omit unsupported claims.', ...(automaticReviewFeedback ? { automaticReviewFeedback } : {}) }, generate, { beforeAttempt: async () => { await checkConsent(context); await checkStrategy() }, fallback: undefined, startWithFallback: false })
      const review = reviewContent(content, pack.evidence, settings, { automationAccountId: context.profile.accountId })
      if (review.issues.length) throw Object.assign(new Error('Demo writing did not pass evidence validation'), { code: 'EVIDENCE_VALIDATION', issues: review.issues, issueCount: review.issues.length })
      await checkConsent(context)
      await checkStrategy()
      await assertDemoAuthorization(demoContext)
      const current = await repository.studioGet(context.owner, 'package', pack.id)
      if (!current || current.revision !== pack.revision || contentHash(current) !== scope.contentHash) throw blocked('The saved draft changed during the demo operation.')
      const completed = { ...pack, content, settings, strategyAlignment: contentAlignment(content), jobId: job.id, status: 'completed', editorialStatus: 'needs_review', review, automaticReview: null, independentReview: null, approval: null, providerReceipt: generationReceipt(content) || null }
      if (authorization.authorization.sourceCampaignContinuation) completed.paidContinuation = { demoAuthorizationId: context.run.demoAuthorizationId, runId: context.run.id, sourceCampaignId: authorization.authorization.sourceCampaignContinuation.sourceCampaignId, method: 'one-off-paid-generation-and-review' }
      completed.assurance = buildAssurance(completed, { actorId: context.actorUid, runId: job.id, stage: 'generation' })
      const result = await repository.studioPut(context.owner, 'package', pack.id, completed, pack.revision)
      await repository.studioJobUpdate(context.owner, job.id, { status: 'completed', result }, job.revision, 'running')
      return { status: 'completed', jobId: job.id, package: result }
    } catch (error) {
      const diagnostics = safeJobFailure(error)
      const rejection = error.nonbillableRejection
      if (rejection?.httpStatus === 429 && rejection.actualMicros === 0 && rejection.policyUrl === 'https://cloud.google.com/model-garden/pricing') {
        const requestId = `demo:${job.id}:0`
        const cost = await repository.budgetGet(authorization.budgetOwner, requestId)
        if (cost?.status === 'settled' && cost.actualMicros === 0 && !cost.overage) await repository.studioPut(context.owner, 'provider_rejection', job.id, { version: 'vertex-http-rejection-v1', jobId: job.id, requestId, runId: context.run.id, packageId: pack.id, demoAuthorizationId: context.run.demoAuthorizationId, provider: 'vertex', projectId: authorization.projectId, model: authorization.model, httpStatus: 429, actualMicros: 0, noOutput: true, settledAt: new Date().toISOString(), evidenceHash: costScopeHash({ diagnostics, rejection, requestId, jobId: job.id, scope }, null), evidencePath: 'server-observed-provider-http-rejection', policyUrl: rejection.policyUrl }, 0)
      }
      const rejected = !dispatched || error.preDispatch === true || Boolean(rejection?.httpStatus === 429 && rejection.actualMicros === 0) || error.code === 'EVIDENCE_VALIDATION' || (error.transportStatus === 200 && ['MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code))
      const status = rejected ? 'failed' : 'dispatch_unknown'
      const current = await repository.studioJobGet(context.owner, job.id)
      if (current?.status === 'running') await repository.studioJobUpdate(context.owner, job.id, { status, error: `Paid demo writing did not complete; existing saved content preserved. Diagnostics: ${JSON.stringify(diagnostics)}` }, current.revision, 'running')
      return { status, jobId: job.id, diagnostics }
    }
  }
  return {
    async research(context) {
      const { owner, profile, slot, requestId, actorUid } = context
      const campaign = await assertFreeCampaign({ ...context, repository })
      if (campaign) {
        await checkConsent(context)
        const id = hash(['campaign-reference', campaign.id, profile.accountId, campaign.referenceUrl].join(':')).slice(0, 32)
        const prior = await repository.studioGet(owner, 'research', id)
        if (prior?.campaignHash === context.run.campaignHash && prior.evidence?.[0]?.url && Date.parse(prior.researchedAt) > Date.now() - 6 * 3600000 && Date.parse(prior.researchedAt) <= Date.now()) return normalizedResearch(prior, context)
        const source = { ...await fetchSource(campaign.referenceUrl), id: 'E1' }
        await checkConsent(context)
        if (!source.excerpt?.trim() || source.excerpt.trim().length < 100 || !source.title?.trim() || !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > Date.now()) throw blocked('The campaign reference did not provide a current readable publisher capture.')
        const report = await repository.studioPut(owner, 'research', id, { campaignId: campaign.id, campaignHash: context.run.campaignHash, requestedTopic: campaign.topic, researchedAt: new Date().toISOString(), evidence: [source], opportunities: [{ title: source.title.slice(0, 200), whatChanged: 'Source-led editorial opportunity from the frozen campaign reference; factual claims must be supported by the captured publisher passages.', eventDate: null, verification: 'reported', whyItMatters: 'Explain the selected publisher material for the saved account audience without claiming independent verification.', evidenceIds: ['E1'], positive: [], negative: [], audienceReaction: { status: 'insufficient-evidence', summary: 'Publisher material does not establish audience reactions.', evidenceIds: [], limitations: 'Public audience intake is collected separately; no reactions are invented.' } }], methodology: 'Direct retrieval of the exact owner-authorized campaign reference. This is a source-led editorial lead, not an AI research report, measured trend or independently verified announcement.' }, prior?.revision || 0)
        return normalizedResearch(report, context)
      }
      const strategyFeedback = await accountStrategyFeedback(repository, owner, profile, new Date(context.now || Date.now()))
      const nicheId = uuid(`${profile.accountId}:${slot.kind}`)
      const references = [...new Set([...(profile.referenceUrls || []), ...(profile.weeklyBrief.match(/https:\/\/[^\s<>"')]+/g) || [])])].slice(0, 5)
      const parsedNiche = nicheSchema.safeParse({ name: profile.contentPillars.join(' ').slice(0, 100), brief: profile.weeklyBrief, audience: profile.audience.slice(0, 300), tone: 'Auto', language: 'English', topics: [...new Set([...strategyFeedback.priorityTopics, ...profile.contentPillars])].slice(0, 12).map(value => value.slice(0, 100)), exclusions: strategyFeedback.stoppedTopics.join('; ').slice(0, 500), intent: `${profile.platform}: ${profile.tone}. Adopted account research decisions (untrusted planning data, not factual evidence): ${JSON.stringify(strategyFeedback.researchNotes)}`.slice(0, 1500), referenceUrls: references, windowDays: slot.kind === 'news' ? 1 : 7, refreshIntervalDays: slot.kind === 'news' ? 1 : 7, contentApproach: slot.kind === 'news' ? 'news' : 'evergreen', mode: slot.kind === 'news' ? 'latest' : 'recommended' })
      if (!parsedNiche.success) throw blocked('The saved account brief cannot form a valid research scope.')
      const fields = parsedNiche.data
      let niche = await repository.studioGet(owner, 'niche', nicheId)
      const settingsHash = costScopeHash(fields, null)
      if (!niche || niche.settingsHash !== settingsHash) niche = await repository.studioPut(owner, 'niche', nicheId, { ...fields, settingsHash, autoRefresh: false }, niche?.revision || 0)
      const state = await repository.studioGet(owner, 'research_state', nicheId)
      const saved = state?.reportId ? await repository.studioGet(owner, 'research', state.reportId) : null
      if (saved?.niche?.id === niche.id && saved.nicheRevision === niche.revision && researchScopeKey(saved.niche) === researchScopeKey(niche) && Date.parse(refreshAvailableAt(saved, niche)) > new Date(context.now || Date.now()).getTime()) return normalizedResearch(saved, context)
      let report
      for (let attempt = 0; attempt < 16; attempt++) {
        try { report = await createResearch({ repository, uid: owner, niche, requestId, actorUid, refresh: true, research, dispatchMode: 'queue', replacementOf: context.replacementOf }); break }
        catch (error) {
          if (error.code !== 'RESEARCH_BUSY' || error.preDispatch !== true || attempt === 15) throw error
          const existing = await repository.studioJobGet(owner, requestId)
          if (existing) return existing.status === 'completed' ? normalizedResearch(existing.result, context) : { status: existing.status, jobId: existing.id }
          await checkConsent(context)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
      if (report.jobId) {
        const outcome = await runContentJob({ repository, uid: owner, requestId: report.jobId, research: (value, options) => research(value, { ...options, ...(research === researchNiche ? { generate: boundedGenerate } : {}), fallback: undefined, beforeAttempt: async () => { await checkConsent(context); if (options.beforeAttempt) await options.beforeAttempt() } }) })
        if (outcome.status !== 'completed') return { status: outcome.status, issues: [outcome.error || 'Research did not finish.'], jobId: report.jobId }
        report = outcome.result
      }
      return normalizedResearch(report, context)
    },
    async generate(context) {
      const { owner, profile, requestId, actorUid, run } = context
      const id = run.demoAuthorizationId ? run.packageId : hash(`${run.id}:package`).slice(0, 32)
      let pack = id ? await repository.studioGet(owner, 'package', id) : null
      if (run.demoAuthorizationId) return generateDemo(context, pack)
      const quality = run.qualityRevision
      let automaticReviewFeedback
      if (pack?.content && (!quality || (pack.jobId === requestId && pack.status === 'completed'))) return pack
      if (quality) {
        await checkConsent(context)
        const previous = await repository.studioJobGet(owner, requestId)
        if (previous) {
          if (previous.scope?.packageId !== pack?.id || previous.scope?.actorUid !== actorUid || previous.scope?.qualityRevisionOf !== quality.reviewId || previous.scope?.instruction !== quality.instruction) throw blocked('The quality repair identifier belongs to different content or review feedback.')
          return { status: previous.status, jobId: requestId, package: previous.result }
        }
        const actualReview = pack?.automaticReview
        const repairable = (actualReview?.status === 'needs_revision' && actualReview.result) || (actualReview?.status === 'blocked' && actualReview.preflightIssues?.length > 0)
        if (!pack?.content || pack.status !== 'completed' || quality.version !== 1 || !quality.instruction || quality.contentHash !== contentHash(pack) || actualReview?.policyVersion !== automaticTextPolicyVersion || actualReview?.runId !== quality.reviewId || !repairable || actualReview?.contentHash !== contentHash(pack)) throw blocked('Quality repair requires the actual completed review of this exact saved content.')
        automaticReviewFeedback = recordedReviewFeedback(actualReview)
      }
      if (!pack) {
        const report = await repository.studioGet(owner, 'research', run.researchId)
        const topic = report?.opportunities[run.topic?.index]
        if (!topic || topic.title !== run.topic.title) throw blocked('The selected topic is unavailable.')
        const evidence = await Promise.all(report.evidence.filter(source => topic.evidenceIds.includes(source.id)).map(async source => {
          if (source.type !== 'news-feed-excerpt') return source
          try { return { ...await fetchSource(source.url), id: source.id } } catch { return source }
        }))
        if (!evidence.some(source => source.excerpt?.trim().length >= 100)) throw blocked('No readable evidence supports the selected topic.')
        const settings = settingsSchema.parse({ industry: profile.contentPillars[0].slice(0, 100), audience: profile.audience.slice(0, 300), tone: profile.tone.slice(0, 100), language: 'English', platform: profile.platform, duration: 18, outputs: ['platforms', 'website'] })
        pack = await repository.studioPut(owner, 'package', id, { title: topic.title, content: null, evidence, settings, createdBy: actorUid, contributorUids: [actorUid], sourceIds: [], researchId: report.id, opportunityIndex: run.topic.index, researchContext: { brief: profile.weeklyBrief, opportunity: topic, researchedAt: report.researchedAt, methodology: report.methodology, automationAccountId: profile.accountId, outputConstraint: writingConstraint }, status: 'draft', editorialStatus: 'draft', review: null }, 0)
      }
      if (!await repository.studioGet(owner, 'complete_context', pack.id)) {
        const template = await accountWorkflowTemplate(repository, owner, profile, pack.title, new Date(context.now || Date.now()))
        if (template) await repository.studioPut(owner, 'complete_context', pack.id, { packageId: pack.id, context: template.context, workflowSource: template.source, updatedBy: actorUid }, 0)
      }
      if (!quality && !context.replacementOf && (publicResearch !== enrichPackagePublicResearch || write === generateContent)) {
        await publicResearch({ repository, owner, profile, pack, actorUid, now: new Date(context.now || Date.now()), assertAuthorization: () => checkConsent(context) })
      }
      if (context.replacementOf) {
        await checkConsent(context)
        const prior = await freeTextReplacementJob(repository, owner, context.replacementOf, 'generation', actorUid)
        if (!prior || prior.scope.packageId !== pack.id || pack.jobId !== prior.id || pack.status !== 'dispatch_unknown' || pack.content) throw blocked('The previous generation cannot be replaced by a bounded free text operation.')
      }
      const scope = { operation: 'generation', packageId: pack.id, revision: pack.revision, instruction: quality?.instruction || '', actorUid, contentHash: contentHash(pack), generationProvider: 'free', llmModel: env.LLM_MODEL, ...(quality ? { qualityRevisionOf: quality.reviewId } : context.replacementOf ? { replacementOf: context.replacementOf } : {}) }
      let admission
      try { admission = await repository.studioJobReserve(owner, requestId, hash(JSON.stringify(scope)), env.STUDIO_DAILY_GENERATIONS, scope) }
      catch (error) { throw Object.assign(error, { preDispatch: true }) }
      if (!admission.reserved) return { status: admission.job.status, jobId: requestId, package: admission.job.result }
      let cost
      try {
        cost = await reserveFreeOperation(repository, owner, requestId, scope)
        pack = await repository.studioPut(owner, 'package', pack.id, { ...pack, status: 'generating', generatedBy: actorUid, jobId: requestId, automaticReview: null, independentReview: null, approval: null }, pack.revision)
        await repository.studioJobUpdate(owner, requestId, { status: 'reserved', ready: true }, admission.job.revision, 'reserved')
      } catch (error) {
        if (cost?.status === 'reserved') await repository.budgetTransition(owner, cost.id, cost.revision, 'cancel')
        const job = await repository.studioJobGet(owner, requestId)
        if (job?.status === 'reserved') await repository.studioJobUpdate(owner, requestId, { status: 'failed', error: 'Automatic generation admission was blocked before provider dispatch.' }, job.revision, 'reserved')
        throw Object.assign(error, { preDispatch: true })
      }
      const outcome = await runContentJob({ repository, uid: owner, requestId, generate: (evidence, settings, details, unused, options) => write(evidence, settings, { ...details, outputConstraint: writingConstraint, ...(automaticReviewFeedback ? { automaticReviewFeedback } : {}) }, write === generateContent ? boundedGenerate : unused, { ...options, fallback: undefined, startWithFallback: false, beforeAttempt: async () => { await checkConsent(context); if (options.beforeAttempt) await options.beforeAttempt() } }) })
      return { ...outcome, package: outcome.result }
    },
    async review(context) {
      await checkConsent(context)
      const pack = await savedPack(context)
      const demoContext = { ...context, repository, phase: 'review' }
      const demo = await assertDemoAuthorization(demoContext)
      if (demo && context.requestId !== demoStageRequestId(context.run, 'review')) throw blocked('The paid demo review identifier does not match this exact content.')
      const recorded = pack.automaticReview
      if (demo && !context.run.qualityRevision && !context.run.reviewFormatRetry && context.run.stages?.some(stage => stage.stage === 'review' && stage.requestId === context.requestId && ['needs_revision', 'blocked'].includes(stage.status)) && recorded?.policyVersion === automaticTextPolicyVersion && recorded.contentHash === contentHash(pack) && recorded.profileHash === costScopeHash(context.profile, null) && recorded.model === demo.model && (recorded.status === 'needs_revision' && recorded.result && !recorded.responseFailure || recorded.status === 'blocked' && !recorded.result && recorded.responseFailure?.code === 'MODEL_SCHEMA_INVALID' && recorded.responseFailure.outcome === 'invalid_response' && recorded.responseFailure.schemaIssues?.length)) return reviewOutcome(pack, context.profile)
      let formatFeedback
      if (demo && context.run.reviewFormatRetry && context.run.contentHash === context.run.reviewFormatRetry.contentHash) {
        if (recorded?.runId !== context.run.reviewFormatRetry.reviewId || recorded.contentHash !== context.run.reviewFormatRetry.contentHash || recorded.status !== 'blocked' || recorded.result || recorded.responseFailure?.code !== 'MODEL_SCHEMA_INVALID' || recorded.responseFailure.outcome !== 'invalid_response' || !recorded.responseFailure.schemaIssues?.length) throw blocked('The review format correction requires its actual saved schema failure.')
        formatFeedback = { reviewId: recorded.runId, contentHash: recorded.contentHash, schemaIssues: recorded.responseFailure.schemaIssues }
      }
      if (!(await repository.studioReserve(`${context.owner}:automatic-review`, context.requestId, env.STUDIO_DAILY_GENERATIONS)).reserved) throw blocked('The review attempt already exists or its allowance is exhausted.')
      const scope = { operation: 'generation', purpose: 'automatic-review', packageId: pack.id, contentHash: contentHash(pack), profileHash: costScopeHash(context.profile, null) }
      if (!demo) {
        const cost = await reserveFreeOperation(repository, context.owner, context.requestId, scope)
        if (cost.status !== 'reserved') throw blocked('The previous evaluator request requires reconciliation.')
        await repository.budgetTransition(context.owner, cost.id, cost.revision, 'dispatch')
      }
      const automaticReview = await evaluate(pack, context.profile, { actorId: context.actorUid, ...(formatFeedback ? { formatFeedback } : {}), ...(demo ? { generate: demoGenerate(demoContext, { beforeAttempt: () => checkConsent(context) }), model: demo.model } : evaluate === reviewAutomaticText ? { generate: boundedGenerate, model: env.LLM_MODEL } : {}) })
      if (demo) { await checkConsent(context); await assertDemoAuthorization(demoContext) }
      const saved = await repository.studioPut(context.owner, 'package', pack.id, { ...pack, automaticReview, automaticReviewRequestId: context.requestId }, pack.revision)
      return reviewOutcome(saved, context.profile)
    },
    async render(context) {
      await checkConsent(context)
      if (render === renderLocalMedia) assertCapability('media')
      const pack = await savedPack(context)
      const text = assessAutomaticText(pack, context.profile)
      if (!text.eligible) return text
      const kind = ['YouTube', 'Instagram'].includes(context.profile.platform) ? 'video' : 'image'
      const id = uuid(`${context.requestId}:${kind}`)
      const prior = await repository.studioGet(context.owner, 'asset', id)
      if (prior) {
        const inspection = inspectMediaBytes(prior, await readFile(prior.id))
        await recordAutomaticStrategyMedia(repository, context.owner, pack, context.profile, [prior], [inspection])
        return { assets: [prior] }
      }
      const result = await render(kind, pack)
      await checkConsent(context)
      await saveFile(id, result.bytes, result.mime)
      const candidate = { id, requestId: context.requestId, packageId: pack.id, packageRevision: pack.revision, packageContentHash: contentHash(pack), createdBy: context.actorUid, kind, prompt: pack.content.website?.title || pack.title, status: 'completed', mime: result.mime, bytes: result.bytes.length, sha256: hash(result.bytes), estimatedUsd: 0, provenance: result.provenance, technicalReport: result.technicalReport, captions: result.captions }
      const inspection = inspectMediaBytes(candidate, await readFile(id))
      const acceptance = assessAutomaticMedia(pack, [candidate], [inspection])
      const asset = await repository.studioPut(context.owner, 'asset', id, { ...candidate, verification: { status: acceptance.eligible ? 'passed' : 'blocked', issues: acceptance.issues } }, 0)
      if (!acceptance.eligible) return acceptance
      await recordAutomaticStrategyMedia(repository, context.owner, pack, context.profile, [asset], [inspection])
      return { assets: [asset], eligible: true }
    },
    async recoverPublication(context) {
      await checkConsent(context)
      const pack = await savedPack(context)
      if (!pack.paidContinuation || pack.paidContinuation.runId !== context.run.id || pack.paidContinuation.demoAuthorizationId !== context.run.demoAuthorizationId || contentHash(pack) !== context.run.contentHash) return { eligible: false, issues: ['The paid continuation content binding changed.'] }
      const assets = await Promise.all(context.run.assetIds.map(id => repository.studioGet(context.owner, 'asset', id)))
      return assessAutomationRelease({ repository, owner: context.owner, actorUid: context.actorUid, pack, assets, profile: context.profile, input: { automatic: true, accountId: context.profile.accountId, platform: context.profile.platform }, readFile })
    },
    async publish(context) {
      await checkConsent(context)
      const pack = await savedPack(context)
      const value = await publishing.publish({ owner: context.owner, actorUid: context.actorUid, packageId: pack.id, input: { requestId: context.requestId, revision: pack.revision, accountId: context.profile.accountId, platform: context.profile.platform, mode: 'now', caption: approvedCaption(pack, context.profile.platform), assetIds: context.run.assetIds, automatic: true, confirmed: true } })
      return value.receipt
    },
    async readback(context) { return publishing.refresh({ owner: context.owner, actorUid: context.actorUid || context.profile.automaticPolicy.consentedBy, id: context.run.publicationId }) },
    async reconcile(context) {
      if (['research', 'generate'].includes(context.phase)) {
        const job = await repository.studioJobGet(context.owner, context.requestId)
        if (job?.status === 'dispatch_unknown' && !context.run.qualityRevision && !context.run.replacements?.[context.phase]) {
          await checkConsent(context)
          const prior = await freeTextReplacementJob(repository, context.owner, context.requestId, context.phase === 'generate' ? 'generation' : 'research', context.actorUid)
          if (prior) return { status: 'free_text_replacement_available', replacementOf: prior.id }
        }
        if (!job || job.status !== 'completed') return { status: job?.status || 'dispatch_unknown', jobId: context.requestId }
        if (context.phase === 'generate') return { status: 'completed', package: job.result }
        const report = job.result
        return normalizedResearch(report, context)
      }
      if (context.phase === 'review') {
        const pack = await savedPack(context)
        if (context.run.reviewFormatRetry && pack.automaticReviewRequestId !== context.requestId) return { status: 'dispatch_unknown' }
        return pack.automaticReview ? reviewOutcome(pack, context.profile) : { status: 'dispatch_unknown' }
      }
      if (context.phase === 'render') {
        const assets = (await repository.studioList(context.owner, 'asset')).filter(asset => asset.requestId === context.requestId && asset.packageId === context.run.packageId && asset.status === 'completed')
        return assets.length ? { assets, eligible: assets.every(asset => asset.verification?.status === 'passed') } : { status: 'dispatch_unknown' }
      }
      const receipt = (await repository.studioList(context.owner, 'social_publication')).find(value => value.requestId === context.requestId)
      return receipt ? { receipt } : { status: 'dispatch_unknown' }
    },
  }
}

export async function runAutomationRequest({ repository, owner, requestId, services = createAutomationServices(repository), limit = 2 }) {
  const request = await repository.studioGet(owner, 'automation_request', requestId)
  if (!request || request.status !== 'queued') return { status: 'skipped' }
  let claimed
  try { claimed = await repository.studioPut(owner, 'automation_request', requestId, { ...request, status: 'running' }, request.revision) }
  catch (error) { if (error.code === 'STUDIO_CONFLICT') return { status: 'skipped' }; throw error }
  const profiles = (await repository.studioList(owner, 'account_profile')).filter(profile => request.accountIds.includes(profile.accountId))
  const outcomes = []
  try {
    for (const profile of profiles.slice(0, limit)) outcomes.push(await runAccountAutomation({ repository, owner, profile, services }))
    return await repository.studioPut(owner, 'automation_request', requestId, { ...claimed, status: 'completed', outcomes, deferredAccountIds: profiles.slice(limit).map(profile => profile.accountId) }, claimed.revision)
  } catch {
    return await repository.studioPut(owner, 'automation_request', requestId, { ...claimed, status: 'blocked', outcomes, error: 'Automatic execution stopped. Inspect the saved stage or receipt before retrying.' }, claimed.revision)
  }
}

export async function executeAccountAutomation({ repository, owner, profileId, requestId, services = createAutomationServices(repository) }) {
  const profile = await repository.studioGet(owner, 'account_profile', profileId)
  if (!profile) return { status: 'blocked', issues: ['The account automation profile is unavailable.'] }
  const outcome = await runAccountAutomation({ repository, owner, profile, services, maxStages: 1, maxSlots: 1 })
  if (requestId) {
    const request = await repository.studioGet(owner, 'automation_request', requestId)
    if (request?.accountIds.includes(profile.accountId)) {
      const id = hash(`${requestId}:${profileId}`).slice(0, 32)
      const previous = await repository.studioGet(owner, 'automation_request_result', id)
      await repository.studioPut(owner, 'automation_request_result', id, { requestId, profileId, accountId: profile.accountId, outcome }, previous?.revision || 0)
    }
  }
  return outcome
}
