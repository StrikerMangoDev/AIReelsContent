import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { runAccountAutomation } from '../automation/runner.js'
import { accountWorkflowTemplate, buildStrategyWorkflow, strategyWorkflowSchema, workflowPrepublicationIssues, workflowGoalKpiMatches, workflowKpiValue } from '../studio/strategy-workflow.js'
import { platforms } from '../studio/content.js'
import { contentHash } from '../studio/approval.js'
import { runContentJob } from '../studio/job-worker.js'
import { costScopeHash } from '../budget/policy.js'
import { reserveFreeOperation } from '../budget/free-operation.js'
import { metricObservationSchema } from '../studio/package-analytics.js'
import { completeInputHash } from '../studio/complete-package.js'

const now = new Date('2026-11-12T12:00:00Z')
test('display KPI labels resolve case-insensitively to supported canonical metrics', () => {
  for (const kpi of ['Reach', 'reach', 'Impressions', 'Views', 'Average watch time', 'AVERAGEWATCHSECONDS']) assert.equal(workflowGoalKpiMatches({ primary: 'reach', kpi }), true, kpi)
  assert.equal(workflowGoalKpiMatches({ primary: 'trust', kpi: 'Views' }), false)
  assert.equal(workflowGoalKpiMatches({ primary: 'reach', kpi: 'Unmeasured virality' }), false)
  const observation = { metrics: { reach: 120, averageWatchSeconds: 12 } }
  assert.equal(workflowKpiValue(observation, 'Reach'), 120)
  assert.equal(workflowKpiValue(observation, 'Average watch time'), 12)
  assert.equal(workflowKpiValue(observation, 'AVERAGEWATCHSECONDS'), 12)
})
const at = hours => new Date(now.getTime() + hours * 3600000).toISOString()
const account = platform => `account-${platform}`
const destination = platform => ({ platform, accountId: account(platform), goal: { primary: 'reach', kpi: 'reach', targetAction: 'Understand the limitations', reviewAfterHours: 24 }, audienceQuestions: [], researchLog: [], candidates: [], keywords: [], learnings: [] })
const observations = platform => Array.from({ length: 3 }, (_, index) => metricObservationSchema.parse({ observationId: `${platform}-${index}`, accountId: account(platform), postId: `post-${index}`, platform, format: 'post', distribution: 'organic', publishedAt: at(-72 - index * 24), measuredAt: at(-48 - index * 24), source: { kind: 'manual', label: 'Controlled comparable observations' }, metrics: { reach: 100 + index } }))
const learning = (platform, topic, action) => ({ id: topic.replaceAll(' ', '-'), action, topic, observation: 'Comparable reported reach was reviewed.', nextAction: 'Apply this account-specific editorial decision.', metricIds: observations(platform).map(item => item.observationId), reviewedAt: at(-1), reviewer: 'Account owner', status: 'adopted', basis: 'measured', reviewWindowHours: 24 })

test('actual account runner uses adopted comparable learning to skip stopped subjects and prioritize the next research topic on all five platforms', async () => {
  for (const platform of platforms) {
    const repository = createRepository(':memory:')
    try {
      const profile = repository.studioPut('alice', 'account_profile', account(platform), { platform, accountId: account(platform), timezone: 'UTC', audience: 'AI learners', tone: 'Clear', weeklyBrief: 'Explain evidence-backed AI capabilities.', contentPillars: ['AI'], weeklyCadence: 0, maxDailyPosts: 1, dailyNews: true, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice', paidBudgetMicros: 0 } }, 0)
      const dest = destination(platform); dest.learnings = [learning(platform, 'Stopped subject', 'stop'), learning(platform, 'Preferred subject', 'repeat')]
      repository.studioPut('alice', 'complete_context', 'prior', { packageId: 'prior', context: { platformAccounts: [{ platform, accountId: account(platform) }], metrics: observations(platform), workflow: { version: 'strategy-workflow-v1', destinations: [dest] } } }, 0)
      const stages = { research: async () => ({ reportId: 'report', topics: ['Stopped subject', 'Other subject', 'Preferred subject'].map((title, index) => ({ title, index, evidenceIds: ['E1'], evidenceHash: 'captured' })) }), generate: async () => { throw Error('Only one stage was requested') }, review: async () => ({}), render: async () => ({}), publish: async () => ({}) }
      const result = await runAccountAutomation({ repository, owner: 'alice', profile, services: stages, now, maxStages: 1 })
      assert.equal(result.results[0].topic.title, 'Preferred subject', platform)
      const plan = repository.studioList('alice', 'automation_plan')[0]
      assert.deepEqual(plan.strategyFeedback.stoppedTopics, ['Stopped subject'])
      assert.deepEqual(plan.strategyFeedback.priorityTopics, ['Preferred subject'])
      assert.equal(plan.days.flatMap(item => item.slots).length, 7, 'Learning does not invent cadence or exceed the daily cap')
    } finally { repository.close() }
  }
})

test('automatic account templates preserve strategy inputs but never reuse old approvals, checklists, community cases or outcomes', async () => {
  const repository = createRepository(':memory:')
  try {
    const dest = destination('Instagram')
    dest.goal.reviewDueAt = at(24)
    dest.expertReview = { required: true, status: 'approved', reviewer: 'Subject reviewer', reviewedAt: at(-1), contentHash: 'a'.repeat(64) }
    dest.checklist = { contentHash: 'a'.repeat(64), originalityChecked: true, hookFulfilled: true, phonePreviewChecked: true, soundOffChecked: true, linksChecked: true, livePostInspected: true }
    dest.learnings = [learning('Instagram', 'Prior topic', 'repeat')]
    dest.community = { owner: 'Community desk', responseGuidance: 'Use cited resources', escalationOwner: 'Subject desk', escalationRules: 'Escalate sensitive questions', cases: [{ id: 'case', kind: 'question', summary: 'A recurring question', note: 'Answered', owner: 'Desk', status: 'answered', anonymized: true }] }
    repository.studioPut('alice', 'complete_context', 'prior', { packageId: 'prior', context: { brand: 'Approved brand', workflow: { version: 'strategy-workflow-v1', destinations: [dest] } } }, 0)
    const template = await accountWorkflowTemplate(repository, 'alice', { accountId: account('Instagram'), platform: 'Instagram' }, 'A new topic', now)
    const fresh = strategyWorkflowSchema.parse(template.context.workflow).destinations[0]
    assert.equal(fresh.expertReview.status, 'pending'); assert.equal(fresh.expertReview.reviewer, undefined)
    assert.equal(fresh.checklist.contentHash, undefined); assert.equal(fresh.checklist.hookFulfilled, false)
    assert.deepEqual(fresh.learnings, []); assert.deepEqual(fresh.community.cases, [])
    assert.equal(fresh.goal.reviewDueAt, undefined); assert.equal(template.source.packageId, 'prior')
    assert.equal(await accountWorkflowTemplate(repository, 'outsider', { accountId: account('Instagram'), platform: 'Instagram' }, 'New', now), null)
  } finally { repository.close() }
})

test('configured prepublication checks block stale strategy without requiring post-publication results before first release', () => {
  for (const platform of platforms) {
    const pack = { id: 'pack', settings: { platform, audience: 'AI learners', tone: 'Clear' }, evidence: [{ id: 'E1' }], review: { issues: [] }, content: { script: 'An attributed explanation', strategy: { angle: 'Explain limitations', platforms: [{ platform, format: 'post', cta: 'Read', hook: 'An honest opening', body: 'The promised explanation' }] } } }
    const dest = destination(platform)
    dest.audienceQuestions = [{ id: 'q', question: 'What is available?', source: 'faq', occurrences: 3, audience: 'Beginners', observedAt: at(-2), anonymized: true }]
    dest.researchLog = ['fact', 'competitor'].map(type => ({ id: type, type, url: `https://example.com/${type}`, observedAt: at(-1), observation: 'An observed limitation', interpretation: 'A possible explanation', response: 'Use original wording', confidence: 'medium', hypothesis: false, questionIds: [] }))
    dest.trendDecision = { mode: 'not_relevant', reason: 'Evergreen explanation of a recurring audience question' }
    dest.candidates = [{ id: 'idea', topic: 'Availability', angle: 'Explain', rationale: 'Recurring need', researchIds: ['fact'], questionIds: ['q'], selected: true, scores: { topicFit: 5, audienceUsefulness: 5, brandFit: 5, evidence: 4, timing: 4, effort: 1, risk: 1 } }]
    dest.keywords = [{ phrase: 'availability', placements: ['caption'], rationale: 'Audience wording', researchIds: ['fact'] }]
    dest.community = { owner: 'Desk', responseGuidance: 'Use cited resources', escalationOwner: 'Expert', escalationRules: 'Escalate sensitive questions', cases: [] }
    dest.checklist = { contentHash: contentHash(pack), originalityChecked: true, hookFulfilled: true, phonePreviewChecked: true, soundOffChecked: true, linksChecked: false, livePostInspected: false, sensitiveEventCheckedAt: at(-1) }
    const context = { brand: 'Approved identity', attestations: { rightsConfirmed: true, accessibilityReviewed: true }, workflow: { version: 'strategy-workflow-v1', destinations: [dest] } }
    assert.deepEqual(workflowPrepublicationIssues(pack, context, platform, account(platform), now), [], platform)
    const report = buildStrategyWorkflow(pack, context, now).destinations[0]
    assert.equal(report.steps.find(item => item.id === 'publication').status, 'needs_attention')
    dest.expertReview = { required: true, status: 'pending' }
    assert.ok(workflowPrepublicationIssues(pack, context, platform, account(platform), now).some(item => item.includes('review')))
  }
})

test('initial generation consumes saved strategy and rejects a workflow revision race on every platform', async () => {
  for (const platform of platforms) for (const race of [false, true]) {
    const repository = createRepository(':memory:')
    try {
      const settings = { platform, outputs: ['script'] }
      const evidence = [{ id: 'E1', excerpt: 'The publisher announced a preview today.' }]
      let pack = repository.studioPut('alice', 'package', 'pack', { title: 'Preview', status: 'draft', settings, evidence, content: null }, 0)
      const context = { workflow: { version: 'strategy-workflow-v1', destinations: [destination(platform)] } }
      repository.studioPut('alice', 'complete_context', pack.id, { context }, 0)
      const scope = { operation: 'generation', packageId: pack.id, revision: pack.revision, contentHash: contentHash(pack), actorUid: 'alice' }
      const requestId = 'workflow-generation'
      const reservation = repository.studioJobReserve('alice', requestId, costScopeHash(scope, null), 10, scope)
      await reserveFreeOperation(repository, 'alice', requestId, scope)
      repository.studioJobUpdate('alice', requestId, { status: 'reserved', ready: true }, reservation.job.revision, 'reserved')
      pack = repository.studioPut('alice', 'package', pack.id, { ...pack, status: 'generating', jobId: requestId }, pack.revision)
      const result = await runContentJob({ repository, uid: 'alice', requestId, prepareCompletePackage: async () => ({}), generate: async (_evidence, _settings, details) => {
        assert.equal(details.strategyWorkflow.destinations[0].goal.kpi, 'reach')
        assert.equal(details.strategyWorkflow.destinations[0].platform, platform)
        if (race) repository.studioPut('alice', 'complete_context', pack.id, { context: { ...context, objective: 'Changed during generation' } }, 1)
        return { script: 'The publisher announced a preview [C1].', hooks: ['A preview [C1]'], claims: [{ id: 'C1', text: 'The publisher announced a preview', evidenceId: 'E1', quote: 'The publisher announced a preview today.', status: 'attributed' }] }
      } })
      assert.equal(result.status, race ? 'dispatch_unknown' : 'completed', `${platform}: ${result.error || ''}`)
      if (race) assert.equal(repository.studioGet('alice', 'package', pack.id).content, null)
    } finally { repository.close() }
  }
})

test('trend recheck expiry invalidates existing production analysis without any content mutation', () => {
  const pack = { id: 'pack', settings: { platform: 'Instagram' }, content: null, evidence: [] }
  const dest = destination('Instagram')
  dest.trendDecision = { mode: 'use_signal', reason: 'A reported timely search signal' }
  dest.researchLog = [{ id: 'trend', type: 'trend', url: 'https://example.com/trend', observedAt: at(-1), observation: 'A supplied signal', interpretation: 'Possible relevance', response: 'Test a useful explanation', confidence: 'low', hypothesis: true, questionIds: [], trend: { query: 'AI', region: 'India', periodStart: at(-48), periodEnd: at(-2), recheckAt: at(1) } }]
  const context = { workflow: { version: 'strategy-workflow-v1', destinations: [dest] } }
  assert.notEqual(completeInputHash(pack, context, [], now), completeInputHash(pack, context, [], new Date(at(2))))
})
