import { z } from 'zod'
import { contentHash } from './approval.js'
import { platforms, selectedPlatforms } from './content.js'
import { calculateObservationMetrics, summarizeComparablePerformance } from './package-analytics.js'
import { currentAutomaticStrategyMedia } from '../media/strategy-evidence.js'
import { seoGenerationContext } from './seo-workflow.js'

export const strategyWorkflowVersion = 'strategy-workflow-v1'
const text = (max = 1000) => z.string().trim().min(1).max(max)
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/)
const date = z.string().datetime()
const https = z.string().url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password })
const refs = z.array(id).max(20).default([])
const hours = z.number().int().min(1).max(2160)
const score = z.number().int().min(0).max(5)
export const workflowDestinationSchema = z.object({
  platform: z.enum(platforms), accountId: text(200),
  goal: z.object({ primary: z.enum(['reach', 'trust', 'engagement', 'traffic', 'conversion']), kpi: text(200), targetAction: text(500), reviewAfterHours: hours, reviewDueAt: date.optional() }).strict().optional(),
  audienceQuestions: z.array(z.object({ id, question: text(500), source: z.enum(['comment', 'dm', 'faq', 'poll', 'search', 'consultation', 'community', 'editorial-hypothesis']), occurrences: z.number().int().min(0).max(1000000), hypothesis: z.boolean().optional(), basisNote: text().optional(), audience: text(300), observedAt: date, sourceUrl: https.optional(), anonymized: z.literal(true) }).strict()).max(30).default([]),
  researchLog: z.array(z.object({ id, type: z.enum(['audience', 'competitor', 'trend', 'fact', 'poll']), url: https, observedAt: date, observation: text(), interpretation: text(), response: text(), confidence: z.enum(['low', 'medium', 'high']), hypothesis: z.boolean(), questionIds: refs, trend: z.object({ query: text(200), region: text(100), periodStart: date, periodEnd: date, recheckAt: date }).strict().optional() }).strict()).max(30).default([]),
  candidates: z.array(z.object({ id, topic: text(300), angle: text(500), rationale: text(), researchIds: refs, questionIds: refs, selected: z.boolean(), scores: z.object({ topicFit: score, audienceUsefulness: score, brandFit: score, evidence: score, timing: score, effort: score, risk: score }).strict() }).strict()).max(20).default([]),
  keywords: z.array(z.object({ phrase: text(150), placements: z.array(z.enum(['spoken', 'on-screen', 'caption', 'title'])).min(1).max(4), rationale: text(500), researchIds: refs }).strict()).max(20).default([]),
  trendDecision: z.object({ mode: z.enum(['use_signal', 'not_relevant']), reason: text() }).strict().optional(),
  expertReview: z.object({ required: z.boolean(), status: z.enum(['not_required', 'pending', 'approved', 'rejected']), reviewer: text(200).optional(), reviewedAt: date.optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), note: text().optional() }).strict().optional(),
  community: z.object({ owner: text(200), responseGuidance: text(), escalationOwner: text(200), escalationRules: text(), cases: z.array(z.object({ id, kind: z.enum(['question', 'spam', 'abuse', 'booking', 'sensitive']), summary: text(500), status: z.enum(['open', 'answered', 'escalated', 'closed']), owner: text(200), note: text(), anonymized: z.literal(true) }).strict()).max(30).default([]) }).strict().optional(),
  checklist: z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), originalityChecked: z.boolean(), hookFulfilled: z.boolean(), phonePreviewChecked: z.boolean(), soundOffChecked: z.boolean(), linksChecked: z.boolean(), livePostInspected: z.boolean(), sensitiveEventCheckedAt: date.optional(), liveUrl: https.optional() }).strict().optional(),
  learnings: z.array(z.object({ id, action: z.enum(['repeat', 'change', 'stop', 'test', 'investigate']), topic: text(300), observation: text(), nextAction: text(), variable: text(300).optional(), metricIds: refs, reviewedAt: date, reviewer: text(200), status: z.enum(['proposed', 'adopted']), basis: z.enum(['hypothesis', 'measured']), reviewWindowHours: hours }).strict()).max(30).default([]),
}).strict().superRefine((value, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message })
  for (const key of ['audienceQuestions', 'researchLog', 'candidates', 'learnings']) {
    if (new Set(value[key].map(item => item.id)).size !== value[key].length) issue([key], 'Record identifiers must be unique')
  }
  const questions = new Set(value.audienceQuestions.map(item => item.id)); const research = new Set(value.researchLog.map(item => item.id))
  const privateIdentifier = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\s().-]*){8,}/i
  for (const [index, item] of value.audienceQuestions.entries()) {
    if (item.source === 'editorial-hypothesis' ? item.occurrences !== 0 || item.hypothesis !== true || !item.basisNote || !item.sourceUrl : item.occurrences < 1) issue(['audienceQuestions', index], 'Editorial hypotheses need zero observed occurrences, an explicit hypothesis label, source and basis; observed questions require at least one occurrence')
  }
  for (const [index, item] of value.audienceQuestions.entries()) if (privateIdentifier.test(`${item.question} ${item.audience}`)) issue(['audienceQuestions', index], 'Remove contact identifiers from audience summaries')
  for (const [index, item] of (value.community?.cases || []).entries()) if (privateIdentifier.test(`${item.summary} ${item.note}`)) issue(['community', 'cases', index], 'Remove contact identifiers from community summaries')
  for (const [index, entry] of value.researchLog.entries()) {
    if (entry.questionIds.some(ref => !questions.has(ref))) issue(['researchLog', index, 'questionIds'], 'Question reference is unavailable in this destination')
    if (entry.type === 'trend' && !entry.trend) issue(['researchLog', index, 'trend'], 'Trend records need query, region, measurement window and recheck time')
    if (entry.trend && (Date.parse(entry.trend.periodStart) >= Date.parse(entry.trend.periodEnd) || Date.parse(entry.trend.periodEnd) > Date.parse(entry.observedAt) || Date.parse(entry.trend.recheckAt) < Date.parse(entry.observedAt))) issue(['researchLog', index, 'trend'], 'Use an observed trend window and a recheck time at or after capture')
    if (entry.hypothesis && entry.confidence === 'high') issue(['researchLog', index, 'confidence'], 'An untested hypothesis cannot have high confidence')
  }
  for (const [index, entry] of value.candidates.entries()) {
    if (entry.researchIds.some(ref => !research.has(ref)) || entry.questionIds.some(ref => !questions.has(ref))) issue(['candidates', index], 'Candidate references must belong to this destination')
  }
  if (value.candidates.filter(item => item.selected).length > 1) issue(['candidates'], 'Select one primary idea for this destination')
  for (const [index, entry] of value.keywords.entries()) if (entry.researchIds.some(ref => !research.has(ref))) issue(['keywords', index], 'Keyword research must belong to this destination')
  if (value.expertReview?.required && value.expertReview.status === 'not_required') issue(['expertReview'], 'A required review cannot be marked not required')
  if (value.expertReview?.status === 'approved' && (!value.expertReview.reviewer || !value.expertReview.reviewedAt || !value.expertReview.contentHash)) issue(['expertReview'], 'Reported approval needs reviewer, date and exact content hash')
  for (const [index, entry] of value.learnings.entries()) {
    if (entry.action === 'test' && !entry.variable) issue(['learnings', index, 'variable'], 'Name one test variable')
    if (entry.basis === 'measured' && !entry.metricIds.length) issue(['learnings', index, 'metricIds'], 'Measured learning requires observations')
  }
})
export const strategyWorkflowSchema = z.object({ version: z.literal(strategyWorkflowVersion), destinations: z.array(workflowDestinationSchema).max(5) }).strict().superRefine((value, ctx) => {
  if (new Set(value.destinations.map(item => item.platform)).size !== value.destinations.length) ctx.addIssue({ code: 'custom', path: ['destinations'], message: 'Use one workflow per selected platform/account' })
})

export function validateWorkflowContext(context, ctx) {
  for (const [index, destination] of (context.workflow?.destinations || []).entries()) {
    const account = context.platformAccounts?.find(item => item.platform === destination.platform)?.accountId || context.accountId
    if (destination.accountId !== account) ctx.addIssue({ code: 'custom', path: ['workflow', 'destinations', index, 'accountId'], message: 'Workflow must match the selected destination account' })
    for (const learning of destination.learnings) for (const ref of learning.metricIds) {
      if (!(context.metrics || []).some(item => item.observationId === ref && item.accountId === destination.accountId && item.platform === destination.platform)) ctx.addIssue({ code: 'custom', path: ['workflow', 'destinations', index, 'learnings'], message: 'Learning metrics must belong to this destination' })
    }
  }
}

export function scoreWorkflowCandidate(candidate) {
  const s = candidate.scores
  return { ...candidate, score: s.topicFit + s.audienceUsefulness + s.brandFit + s.evidence + s.timing + (5 - s.effort) + (5 - s.risk), maxScore: 35, formula: 'topicFit + audienceUsefulness + brandFit + evidence + timing + (5 - effort) + (5 - risk)', provenance: 'Editorial 0–5 ratings; not measured demand or a performance prediction.' }
}

const kpiAliases = { 'watch time': 'averageWatchSeconds', 'average watch time': 'averageWatchSeconds', 'share rate': 'shareRate', 'save rate': 'saveRate', 'click through rate': 'clickThroughRate', 'conversion rate': 'conversionRateByClick', 'engagement rate': 'engagementRateByReach', 'average percentage viewed': 'averagePercentageViewed' }
const goalKpis = { reach: ['reach', 'impressions', 'views', 'shares', 'shareRate', 'averageWatchSeconds', 'averagePercentageViewed'], trust: ['saves', 'saveRate', 'comments'], engagement: ['likes', 'comments', 'shares', 'saves', 'engagementRateByReach', 'shareRate', 'saveRate'], traffic: ['clicks', 'clickThroughRate'], conversion: ['conversions', 'conversionRateByClick'] }
const canonicalKpi = kpi => kpiAliases[String(kpi).trim().toLowerCase()] || Object.values(goalKpis).flat().find(key => key.toLowerCase() === String(kpi).trim().toLowerCase()) || kpi
export const workflowGoalKpiMatches = goal => Boolean(goal && goalKpis[goal.primary]?.includes(canonicalKpi(goal.kpi)))
export function workflowKpiValue(observation, kpi = '') {
  const key = canonicalKpi(kpi)
  if (Object.hasOwn(observation.metrics, key)) return observation.metrics[key] ?? null
  return calculateObservationMetrics(observation).metrics[key]?.value ?? null
}

export function assessWorkflowLearning(learning, destination, metrics, now = new Date()) {
  const fail = reason => ({ ...learning, eligibleForAutomation: false, reason })
  if (learning.status !== 'adopted') return fail('Learning is a proposal, not an adopted decision.')
  if (learning.basis !== 'measured') return fail('Qualitative hypotheses remain visible but do not automatically change the account plan.')
  if (!workflowGoalKpiMatches(destination.goal)) return fail('The declared KPI does not match the primary goal or has no supported measurement mapping.')
  if (Date.parse(learning.reviewedAt) > now.getTime() || now.getTime() - Date.parse(learning.reviewedAt) > 90 * 86400000) return fail('Learning review is future-dated or older than 90 days.')
  const rows = metrics.filter(item => learning.metricIds.includes(item.observationId) && item.accountId === destination.accountId && item.platform === destination.platform)
  if (rows.length !== learning.metricIds.length || rows.length < 3) return fail('At least three comparable measured posts are required; one post cannot change the plan.')
  if (!destination.goal || rows.some(item => workflowKpiValue(item, destination.goal.kpi) === null)) return fail('Every learning observation must include the declared goal KPI or its calculable rate.')
  const last = rows.toSorted((a, b) => a.measuredAt.localeCompare(b.measuredAt)).at(-1)
  if (rows.some(item => Date.parse(item.measuredAt) > Date.parse(learning.reviewedAt))) return fail('Review must follow the referenced measurements.')
  if (rows.some(item => Math.abs((Date.parse(item.measuredAt) - Date.parse(item.publishedAt)) / 3600000 - learning.reviewWindowHours) > 2)) return fail('Measurements must match the declared review window within two hours.')
  const cohort = summarizeComparablePerformance(rows, { accountId: destination.accountId, platform: destination.platform, format: last.format, distribution: last.distribution, definitionVersion: last.definitionVersion, sourceKind: last.source.kind, sourceLabel: last.source.label, windowKind: last.windowKind, ...(last.periodStart ? { periodHours: (Date.parse(last.periodEnd) - Date.parse(last.periodStart)) / 3600000 } : {}), targetAgeHours: learning.reviewWindowHours, ageToleranceHours: 2, minimumSample: 3, now })
  if (cohort.status !== 'available' || !learning.metricIds.every(ref => cohort.observationIds.includes(ref))) return fail('Learning lacks a current comparable cohort of distinct posts.')
  return { ...learning, eligibleForAutomation: true, reason: 'Adopted account decision backed by at least three comparable reported observations; descriptive, not causal proof.' }
}

export function buildStrategyWorkflow(pack, context, now = new Date(), publications = [], machineEvidence = []) {
  const workflow = context.workflow
  if (!workflow) return { version: strategyWorkflowVersion, status: 'not_started', destinations: [], limitations: ['Strategy workflow has not been configured. Existing content and release controls are preserved.'] }
  const destinations = workflow.destinations.map(destination => {
    const { goal, researchLog, audienceQuestions, checklist, expertReview } = destination
    const selected = destination.candidates.find(item => item.selected)
    const post = pack.content?.strategy?.platforms?.find(item => item.platform === destination.platform)
    const hash = contentHash(pack)
    const checksCurrent = checklist?.contentHash === hash
    const machineAssessment = machineEvidence.map(({ record, profile, assets }) => currentAutomaticStrategyMedia(record, pack, profile, assets, { now: now.getTime() })).find(record => record?.platform === destination.platform && record?.accountId === destination.accountId) || null
    const currentResearch = researchLog.filter(item => Date.parse(item.observedAt) <= now.getTime() && now.getTime() - Date.parse(item.observedAt) <= 90 * 86400000)
    const usedTrends = researchLog.filter(item => item.type === 'trend' && (destination.trendDecision?.mode === 'use_signal' || selected?.researchIds.includes(item.id)))
    const staleTrends = usedTrends.filter(item => !item.trend || Date.parse(item.trend.recheckAt) <= now.getTime())
    const learnings = destination.learnings.map(item => assessWorkflowLearning(item, destination, context.metrics || [], now))
    const receipt = publications.find(item => item.accountId === destination.accountId && item.platform === destination.platform && item.status === 'published' && item.releaseUrl && item.contentHash === hash)
    const steps = []
    const step = (id, title, ready, detail, applicable = true) => steps.push({ id, title, status: applicable ? ready ? 'ready' : 'needs_attention' : 'not_applicable', detail })
    step('goal', '01 · Business goal', workflowGoalKpiMatches(goal), 'Choose one primary objective, matching KPI, audience action and review window. Proxy metrics do not prove trust or business outcomes.')
    step('brand', '02 · Brand brief', Boolean(context.brand && pack.settings?.audience && pack.settings?.tone), 'Use the saved brand, audience and tone; do not invent account facts.')
    const editorialHypothesis = audienceQuestions.some(item => item.source === 'editorial-hypothesis' && item.occurrences === 0 && item.hypothesis === true && item.basisNote)
    const audienceReady = audienceQuestions.some(item => Date.parse(item.observedAt) <= now.getTime() && now.getTime() - Date.parse(item.observedAt) <= 90 * 86400000 && (item.occurrences > 1 || item.sourceUrl && (item.source !== 'editorial-hypothesis' || item.occurrences === 0 && item.hypothesis === true && item.basisNote) && selected?.questionIds.includes(item.id) && currentResearch.some(research => research.type === 'audience' && research.hypothesis && research.confidence === 'low' && research.questionIds.includes(item.id) && selected.researchIds.includes(research.id))))
    step('audience', '03 · Audience listening', audienceReady, editorialHypothesis ? 'A source-backed editorial question is an explicit low-confidence test with zero observed occurrences. No actual audience question, repeated need or account demand was observed.' : 'Use current repeated anonymized needs or a dated public question linked to an explicitly low-confidence test hypothesis. A single public question is not repeated demand or proof about this account’s followers.')
    const observedPublicPeer = currentResearch.some(item => item.type === 'audience' && item.hypothesis && item.questionIds.some(ref => audienceQuestions.some(question => question.id === ref && question.sourceUrl && ['community', 'search'].includes(question.source))) && selected?.researchIds.includes(item.id))
    const editorialResearch = editorialHypothesis && currentResearch.some(item => item.type === 'audience' && item.hypothesis && item.confidence === 'low' && selected?.researchIds.includes(item.id) && item.questionIds.some(ref => audienceQuestions.some(question => question.id === ref && question.source === 'editorial-hypothesis' && question.sourceUrl && selected.questionIds.includes(question.id))))
    step('research', '04 · Market and source research', Boolean((currentResearch.some(item => item.type === 'competitor') || observedPublicPeer || editorialResearch) && currentResearch.some(item => item.type === 'fact') && pack.evidence?.length), editorialResearch ? 'Captured factual sources support an editorial test only. No audience or competitor-account research was observed; those data remain unavailable.' : observedPublicPeer ? 'Dated public peer discussion and captured factual sources are available. This is not a competitor-account performance audit; its interpretation remains a test hypothesis.' : 'Record dated competitor observations and factual sources, separately from interpretations.')
    step('trends', '05 · Trends and timing', !staleTrends.length && (destination.trendDecision?.mode === 'not_relevant' || destination.trendDecision?.mode === 'use_signal' && usedTrends.length > 0), staleTrends.length ? 'Recheck expired trend signals before scheduling.' : 'Record a current signal or explain why trends are not relevant to this evergreen idea. Signals do not guarantee reach.')
    step('selection', '06 · Idea prioritization', Boolean(selected && selected.researchIds.length && selected.questionIds.length && selected.researchIds.every(ref => currentResearch.some(item => item.id === ref)) && selected.questionIds.every(ref => audienceQuestions.some(item => item.id === ref && Date.parse(item.observedAt) <= now.getTime() && now.getTime() - Date.parse(item.observedAt) <= 90 * 86400000)) && selected.scores.evidence > 0 && selected.scores.risk < 5), 'Choose a supported primary idea with current research and audience references using the transparent editorial score; higher effort/risk reduces priority.')
    step('format', '07 · Goal and format fit', Boolean(goal && post?.format && post?.cta), 'Explain format and audience action against the primary goal; no universal best format is claimed.')
    step('brief', '08 · Brief and story', Boolean(pack.content?.strategy?.angle && (pack.content?.script || post?.body)), 'Save an original angle, one takeaway and the story or post body.')
    step('writing', '09 · Hook, script and caption', Boolean(post?.hook && post?.body && (checksCurrent && checklist?.hookFulfilled || machineAssessment?.checks.editorialReview)), machineAssessment ? 'The separate automated editorial evaluator checked the exact saved opening and body; not a human sign-off.' : 'Confirm the opening promise is delivered by the current body; a writing edit invalidates prior preview checks.')
    step('keywords', '10 · Intent-based keywords', destination.keywords.length > 0 && destination.keywords.every(item => item.researchIds.length > 0), 'Record phrases, placement and observed audience/search rationale; no invented search volumes.')
    step('creative', '11 · Creative and accessibility', Boolean(checksCurrent && checklist?.phonePreviewChecked && checklist?.soundOffChecked && context.attestations?.rightsConfirmed && context.attestations?.accessibilityReviewed || machineAssessment?.checks.boundedLayout && machineAssessment?.checks.soundOffText && machineAssessment?.checks.originalAssetRights), machineAssessment ? 'Machine alternative: original server-rendered text/vector assets, bounded layout and complete silent captions match the exact inspected bytes. Actual phone playback and subjective accessibility approval were not performed.' : 'Report phone and sound-off previews and rights/accessibility checks for current content; planning prompts are not finished media.')
    step('review', '12 · Accuracy and accountable review', Boolean(pack.review?.issues?.length === 0 && (checksCurrent && checklist?.originalityChecked || machineAssessment?.checks.originalLayout && machineAssessment?.checks.editorialReview) && expertReview?.status !== 'rejected' && (!expertReview?.required || expertReview.status === 'approved' && expertReview.contentHash === hash && Date.parse(expertReview.reviewedAt) <= now.getTime())), expertReview?.required ? 'Required reported expert approval must cover this exact content hash; machine checks never replace a required subject expert.' : machineAssessment ? 'Separate automated editorial and original-layout checks passed for this content and asset manifest. No human or specialist approval is claimed.' : 'No specialist approval is invented. Use existing source and safety checks; declare specialist review if required.')
    step('publication', '13 · Schedule and inspect live post', Boolean(receipt && checksCurrent && checklist?.linksChecked && checklist?.livePostInspected && checklist.liveUrl === receipt.releaseUrl && checklist.sensitiveEventCheckedAt && Date.parse(checklist.sensitiveEventCheckedAt) <= now.getTime() && now.getTime() - Date.parse(checklist.sensitiveEventCheckedAt) <= 24 * 3600000), 'Match inspection URL to the current published receipt, check links and recheck sensitive events within 24 hours.')
    step('community', '14 · Community and escalation', Boolean(destination.community && !destination.community.cases.some(item => item.kind === 'sensitive' && item.status === 'answered')), 'Assign reply and escalation owners. Sensitive cases require escalation; this workflow does not send replies.')
    step('measurement', '15 · Measure against goal', Boolean(workflowGoalKpiMatches(goal) && (context.metrics || []).some(item => item.accountId === destination.accountId && item.platform === destination.platform && publications.some(publication => publication.accountId === item.accountId && publication.platform === item.platform && publication.providerPostId === item.postId && publication.status === 'published') && workflowKpiValue(item, goal.kpi) !== null && Date.parse(item.measuredAt) <= now.getTime() && (Date.parse(item.measuredAt) - Date.parse(item.publishedAt)) / 3600000 >= goal.reviewAfterHours)), 'Use the declared goal KPI on this published package after its review window. Unmapped business KPIs remain unavailable; compare like formats/windows.')
    step('learning', '16 · Next-cycle learning', learnings.some(item => item.eligibleForAutomation), 'Record repeat/change/stop/test/investigate and one variable. Only adopted, sufficiently comparable measured learning influences automation.')
    if (!selectedPlatforms(pack.settings).includes(destination.platform)) steps.forEach(item => { item.status = 'not_applicable' })
    const issues = steps.filter(item => item.status === 'needs_attention').map(item => item.title)
    return { platform: destination.platform, accountId: destination.accountId, status: !selectedPlatforms(pack.settings).includes(destination.platform) ? 'not_applicable' : issues.length ? 'needs_attention' : 'ready', steps, candidates: destination.candidates.map(scoreWorkflowCandidate).sort((a, b) => b.score - a.score), learnings, issues, machineAssessment }
  })
  return { version: strategyWorkflowVersion, status: destinations.length && destinations.every(item => item.status === 'ready') ? 'ready' : 'needs_attention', destinations, limitations: ['Audience/research, ratings, reviews and community notes are workspace-reported, not independently verified.', 'No private messages are imported or replies sent. Store anonymized summaries only.', 'Trend capture is supplied research; no connected Google Trends/search-demand measurement is claimed.', 'Readiness describes recorded workflow steps, not guaranteed performance or legal compliance.'] }
}

export function workflowPrepublicationIssues(pack, context, platform, accountId, now = new Date(), machineEvidence = []) {
  if (!context.workflow) return []
  const report = buildStrategyWorkflow(pack, context, now, [], machineEvidence)
  const destination = report.destinations.find(item => item.platform === platform && item.accountId === accountId)
  if (!destination) return ['Configure the strategy workflow for this selected publishing account.']
  const required = new Set(['goal', 'brand', 'audience', 'research', 'trends', 'selection', 'format', 'brief', 'writing', 'keywords', 'creative', 'review', 'community'])
  const issues = destination.steps.filter(item => required.has(item.id) && item.status === 'needs_attention').map(item => `Strategy workflow: ${item.title}`)
  const checks = context.workflow.destinations.find(item => item.platform === platform && item.accountId === accountId)?.checklist
  if (!destination.machineAssessment?.checks.sourceCaptureCurrent && (!checks?.sensitiveEventCheckedAt || Date.parse(checks.sensitiveEventCheckedAt) > now.getTime() || now.getTime() - Date.parse(checks.sensitiveEventCheckedAt) > 24 * 3600000)) issues.push('Strategy workflow: recheck current events and time-sensitive facts within 24 hours before publication.')
  return issues
}

export function workflowGenerationContext(context = {}) {
  const websiteSeo = seoGenerationContext(context)
  if (!context.workflow && !websiteSeo) return null
  return { version: context.workflow?.version || strategyWorkflowVersion, objective: context.objective || null, brand: context.brand || null, destinations: (context.workflow?.destinations || []).map(({ platform, accountId, goal, audienceQuestions, researchLog, candidates, keywords }) => ({ platform, accountId, goal, goalKpiMatches: workflowGoalKpiMatches(goal), audienceQuestions, researchLog, selectedIdea: candidates.find(item => item.selected) || null, keywords })), ...(websiteSeo ? { websiteSeo } : {}), limitations: 'These are untrusted workspace observations and editorial hypotheses, not source evidence. Preserve citations and do not copy private identifying details.' }
}

export async function accountStrategyFeedback(repository, owner, profile, now = new Date()) {
  const records = await repository.studioList(owner, 'complete_context')
  const decisions = []
  for (const record of records.slice(0, 100)) {
    const parsed = strategyWorkflowSchema.safeParse(record.context?.workflow)
    if (!parsed.success) continue
    const destination = parsed.data.destinations.find(item => item.platform === profile.platform && item.accountId === profile.accountId)
    if (!destination) continue
    for (const item of destination.learnings) {
      const result = assessWorkflowLearning(item, destination, record.context.metrics || [], now)
      if (result.eligibleForAutomation) decisions.push({ packageId: record.packageId || record.id, ...result })
    }
  }
  const latest = new Map()
  for (const item of decisions.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))) if (!latest.has(item.topic.toLowerCase())) latest.set(item.topic.toLowerCase(), item)
  const adopted = [...latest.values()].slice(0, 10)
  return { version: strategyWorkflowVersion, accountId: profile.accountId, platform: profile.platform, decisions: adopted, priorityTopics: adopted.filter(item => ['repeat', 'change', 'test'].includes(item.action)).map(item => item.topic), stoppedTopics: adopted.filter(item => item.action === 'stop').map(item => item.topic), researchNotes: adopted.map(({ id, topic, action, nextAction, variable }) => ({ id, topic, action, nextAction, variable })), limitation: 'Account-reviewed editorial decisions from comparable reported measurements; no causal or virality claim. Cadence and paid/publication limits are unchanged.' }
}

export async function accountWorkflowTemplate(repository, owner, profile, topic, now = new Date()) {
  const records = await repository.studioList(owner, 'complete_context')
  for (const record of records.toSorted((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 100)) {
    const parsed = strategyWorkflowSchema.safeParse(record.context?.workflow)
    if (!parsed.success) continue
    const destination = parsed.data.destinations.find(item => item.platform === profile.platform && item.accountId === profile.accountId)
    if (!destination) continue
    const goal = destination.goal ? { ...destination.goal } : undefined
    if (goal) delete goal.reviewDueAt
    const current = { ...destination, ...(goal ? { goal } : {}), candidates: destination.candidates.map(item => ({ ...item, selected: item.selected && item.topic.toLowerCase().trim() === topic.toLowerCase().trim() })), expertReview: destination.expertReview ? { required: destination.expertReview.required, status: destination.expertReview.required ? 'pending' : 'not_required', note: 'New content requires its own review; prior approval was not reused.' } : undefined, community: destination.community ? { ...destination.community, cases: [] } : undefined, checklist: { originalityChecked: false, hookFulfilled: false, phonePreviewChecked: false, soundOffChecked: false, linksChecked: false, livePostInspected: false }, learnings: [] }
    return { context: { objective: record.context.objective, brand: record.context.brand, rightsNote: record.context.rightsNote, productionTools: record.context.productionTools, accountId: profile.accountId, platformAccounts: [{ platform: profile.platform, accountId: profile.accountId }], workflow: { version: strategyWorkflowVersion, destinations: [current] } }, source: { packageId: record.packageId || record.id, contextRevision: record.revision, copiedAt: now.toISOString(), note: 'Account workflow settings copied; prior publication, media previews, expert approvals and learning outcomes were reset.' } }
  }
  return null
}
