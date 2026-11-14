import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { createRepository } from '../storage/repository.js'
import { createCompletePackageRouter } from '../studio/complete-package-router.js'
import { decisionParameters } from '../studio/complete-package.js'
import { platforms } from '../studio/content.js'
import { assessWorkflowLearning, accountStrategyFeedback, accountWorkflowTemplate } from '../studio/strategy-workflow.js'
import { metricObservationSchema } from '../studio/package-analytics.js'
import { contentHash } from '../studio/approval.js'

const iso = hours => new Date(Date.now() + hours * 3600000).toISOString()
const account = platform => `audit-${platform}`
const destination = platform => ({
  platform, accountId: account(platform),
  goal: { primary: 'reach', kpi: 'reach', targetAction: 'Understand the announcement limitations', reviewAfterHours: 24 },
  audienceQuestions: [{ id: 'q-one', question: 'What is actually available?', source: 'faq', occurrences: 3, audience: 'AI learners', observedAt: iso(-2), anonymized: true }],
  researchLog: [
    { id: 'r-fact', type: 'fact', url: 'https://example.com/announcement', observedAt: iso(-1), observation: 'The publisher describes limited availability.', interpretation: 'Explain that limitation.', response: 'A practical explainer', confidence: 'medium', hypothesis: false, questionIds: ['q-one'] },
    { id: 'r-competitor', type: 'competitor', url: 'https://example.com/peer', observedAt: iso(-1), observation: 'A peer uses a comparison format.', interpretation: 'A comparison is one possible format.', response: 'Test original wording.', confidence: 'low', hypothesis: true, questionIds: [] },
    { id: 'r-trend', type: 'trend', url: 'https://example.com/search', observedAt: iso(-1), observation: 'Reported search observation, not verified demand.', interpretation: 'Potential audience interest.', response: 'Recheck before scheduling.', confidence: 'low', hypothesis: true, questionIds: [], trend: { query: 'AI preview', region: 'India', periodStart: iso(-48), periodEnd: iso(-2), recheckAt: iso(24) } },
  ],
  trendDecision: { mode: 'use_signal', reason: 'Check the supplied search signal before using it.' },
  candidates: [{ id: 'candidate-one', topic: `${platform} preview limits`, angle: 'Explain limited availability', rationale: 'Answer repeated questions with attributed evidence.', researchIds: ['r-fact'], questionIds: ['q-one'], selected: true, scores: { topicFit: 5, audienceUsefulness: 4, brandFit: 5, evidence: 4, timing: 3, effort: 2, risk: 1 } }],
  keywords: [{ phrase: 'limited preview', placements: ['caption', 'title'], rationale: 'Matches the announcement and the repeated question.', researchIds: ['r-fact'] }],
  expertReview: { required: false, status: 'not_required' },
  community: { owner: 'Community desk', responseGuidance: 'Answer normal questions from cited sources.', escalationOwner: 'Subject desk', escalationRules: 'Escalate sensitive or individualized advice.', cases: [] },
  checklist: { originalityChecked: true, hookFulfilled: true, phonePreviewChecked: false, soundOffChecked: false, linksChecked: false, livePostInspected: false },
  learnings: [],
})

async function fixture(run) {
  const repository = createRepository(':memory:')
  const body = 'The publisher announced a limited preview [C1].'
  const pack = repository.studioPut('alice', 'package', 'audit-workflow', {
    title: 'Audited preview workflow', status: 'completed', settings: { platform: platforms.join(','), industry: 'AI', audience: 'AI learners', tone: 'Clear', language: 'English', duration: 30, outputs: ['platforms'] },
    evidence: [{ id: 'E1', title: 'Controlled announcement', url: 'https://example.com/announcement', excerpt: 'The publisher announced a limited preview.', retrievedAt: iso(-1), type: 'retrieved-source' }], review: { issues: [] },
    content: { claims: [{ id: 'C1', text: 'The publisher announced a limited preview', evidenceId: 'E1', quote: 'The publisher announced a limited preview.', status: 'attributed' }], strategy: { angle: 'Explain limitations', platforms: platforms.map(platform => ({ platform, headline: body, hook: body, body, cta: 'Read the source', format: 'post', thumbnail: 'Illustrative diagram' })) } },
  }, 0)
  for (const platform of platforms) repository.studioPut('alice', 'account_profile', platform, { platform, accountId: account(platform), audience: 'AI learners', tone: 'Clear' }, 0)
  let generated = 0
  const app = express(); app.use(express.json())
  app.use('/api/studio', createCompletePackageRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice' }; next() }, assessDownload: async () => ({ eligible: true }), config: { STUDIO_DAILY_GENERATIONS: 10, LLM_MODEL: 'nvidia/audit:free' }, generate: async request => {
    generated++
    return { summary: 'Controlled editorial hypotheses.', decisions: request.input.selectedPlatforms.flatMap(platform => decisionParameters.map(parameter => ({ id: `${platform}-${parameter}`, platform, parameter, value: 'Editorial hypothesis', method: 'hypothesis', evidenceIds: [], metricIds: [], rationale: 'Controlled fixture; no measured performance claim.', alternatives: [], confidence: 'low', missing: ['No performance proof.'] }))) }
  } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (suffix = '', method = 'GET', body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/api/studio/packages/${pack.id}/complete-package${suffix}`, { method, headers: { Authorization: actor, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const context = () => ({ brand: 'Approved editorial identity', platformAccounts: platforms.map(platform => ({ platform, accountId: account(platform) })), workflow: { version: 'strategy-workflow-v1', destinations: platforms.map(destination) } })
  try { await run({ repository, pack, call, context, generated: () => generated }) } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
}

test('workflow HTTP save, five-platform decisions, export and revision invalidation preserve destination strategy', () => fixture(async ({ call, context, generated }) => {
  const original = context()
  let response = await call('/context', 'PUT', { expectedRevision: 0, context: original })
  assert.equal(response.status, 200, await response.clone().text())
  let result = await response.json()
  assert.equal(result.context.workflow.destinations.length, 5)
  for (const platform of platforms) {
    const saved = result.context.workflow.destinations.find(item => item.platform === platform)
    assert.equal(saved.accountId, account(platform))
    assert.equal(saved.candidates[0].topic, `${platform} preview limits`)
    assert.equal(saved.researchLog[2].hypothesis, true)
  }
  response = await call('/analyze', 'POST', { requestId: randomUUID(), contentHash: result.contentHash, contextRevision: result.contextRevision })
  assert.equal(response.status, 200, await response.clone().text())
  result = await response.json()
  assert.equal(result.analysis.status, 'completed'); assert.equal(generated(), 1)
  response = await call('/download')
  assert.equal(response.status, 200, await response.clone().text())
  const exported = await response.json()
  assert.equal(exported.completePackage.context.workflow.destinations.length, 5)
  assert.equal(exported.manifest.scope, 'internal-complete-package')
  original.workflow.destinations[0].goal.targetAction = 'A revised audience action'
  response = await call('/context', 'PUT', { expectedRevision: result.contextRevision, context: original })
  assert.equal(response.status, 200)
  result = await response.json(); assert.equal(result.analysis.status, 'stale')
  response = await call('/context', 'PUT', { expectedRevision: 0, context: original })
  assert.equal(response.status, 409)
  assert.equal(generated(), 1, 'Context saving and export do not dispatch extra generation')
}))

test('workflow HTTP rejects cross-destination references, raw private-message fields and non-owner access on every platform', () => fixture(async ({ call, context }) => {
  assert.equal((await call('', 'GET', undefined, 'outsider')).status, 404)
  for (const platform of platforms) {
    for (const mutate of [
      item => { item.accountId = 'another-account' },
      item => { item.candidates[0].researchIds = ['another-destination-research'] },
      item => { item.learnings = [{ id: 'learning', action: 'repeat', topic: 'Preview', observation: 'Reported observation', nextAction: 'Try another explainer', metricIds: ['foreign-metric'], reviewedAt: iso(-1), reviewer: 'Owner', status: 'adopted', basis: 'measured', reviewWindowHours: 24 }] },
      item => { item.audienceQuestions[0].anonymized = false },
      item => { item.audienceQuestions[0].rawDm = 'Do not retain private message content' },
      item => { item.researchLog[2].trend.periodEnd = iso(10) },
    ]) {
      const input = context(); mutate(input.workflow.destinations.find(item => item.platform === platform))
      const response = await call('/context', 'PUT', { expectedRevision: 0, context: input })
      assert.ok([400, 422].includes(response.status), `${platform}: ${response.status} ${await response.text()}`)
    }
  }
  const response = await call(); assert.equal((await response.json()).contextRevision, 0, 'Rejected inputs never write a partial context')
}))

test('five-platform readiness keeps stale research, rejected reviews and mismatched KPI data unresolved', () => fixture(async ({ call, context }) => {
  const input = context()
  input.metrics = platforms.map(platform => ({ observationId: `likes-${platform}`, accountId: account(platform), platform, postId: `post-${platform}`, format: 'post', distribution: 'organic', publishedAt: iso(-49), measuredAt: iso(-25), source: { kind: 'manual', label: 'Controlled audit dataset' }, metrics: { likes: 10 } }))
  for (const item of input.workflow.destinations) {
    item.goal.kpi = 'qualified bookings'
    item.expertReview = { required: false, status: 'rejected', note: 'Subject owner rejected the wording.' }
    item.researchLog[2].trend.recheckAt = iso(-0.5)
  }
  const response = await call('/context', 'PUT', { expectedRevision: 0, context: input })
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  for (const platform of platforms) {
    const report = result.workflow.destinations.find(item => item.platform === platform)
    assert.equal(report.steps.length, 16)
    for (const step of ['measurement', 'review', 'trends', 'publication', 'learning']) assert.equal(report.steps.find(item => item.id === step).status, 'needs_attention', `${platform} ${step} must remain unresolved`)
    assert.equal(report.candidates[0].score, 28)
    assert.equal(report.candidates[0].maxScore, 35)
    assert.match(report.candidates[0].provenance, /not measured demand/)
  }
}))

test('next-cycle decisions require matching, current, distinct-post evidence and stay isolated by owner and destination', async () => {
  const repository = createRepository(':memory:')
  const now = new Date()
  try {
    for (const platform of platforms) {
      const target = destination(platform)
      const metrics = [0, 1, 2].map(index => metricObservationSchema.parse({ observationId: `${platform}-${index}`, accountId: account(platform), platform, postId: `${platform}-post-${index}`, format: 'post', distribution: 'organic', publishedAt: iso(-72 - index * 24), measuredAt: iso(-48 - index * 24), source: { kind: 'manual', label: 'Controlled native report' }, metrics: { reach: 100 + index * 20 } }))
      const learning = { id: 'learning-one', action: 'repeat', topic: `${platform} practical explainers`, observation: 'Three comparable reach observations; no causal conclusion.', nextAction: 'Prioritize another practical explainer.', metricIds: metrics.map(item => item.observationId), reviewedAt: iso(-1), reviewer: 'Owner', status: 'adopted', basis: 'measured', reviewWindowHours: 24 }
      assert.equal(assessWorkflowLearning(learning, target, metrics, now).eligibleForAutomation, true, `${platform} can learn from its declared raw reach KPI without unrelated rate denominators`)
      for (const [changedLearning, changedMetrics] of [
        [{ ...learning, status: 'proposed' }, metrics],
        [{ ...learning, basis: 'hypothesis' }, metrics],
        [{ ...learning, reviewedAt: iso(1) }, metrics],
        [{ ...learning, reviewWindowHours: 72 }, metrics],
        [learning, metrics.map(item => ({ ...item, postId: 'same-post' }))],
        [learning, metrics.map(item => ({ ...item, accountId: 'other-account' }))],
        [learning, metrics.map(item => ({ ...item, metrics: { likes: 10 } }))],
      ]) assert.equal(assessWorkflowLearning(changedLearning, target, changedMetrics, now).eligibleForAutomation, false, `${platform} rejects insufficient or mismatched learning evidence`)
      target.learnings = [learning]
      repository.studioPut('alice', 'complete_context', platform, { packageId: platform, context: { workflow: { version: 'strategy-workflow-v1', destinations: [target] }, metrics } }, 0)
    }
    for (const platform of platforms) {
      const profile = { platform, accountId: account(platform) }
      const feedback = await accountStrategyFeedback(repository, 'alice', profile, now)
      assert.deepEqual(feedback.priorityTopics, [`${platform} practical explainers`])
      assert.equal((await accountStrategyFeedback(repository, 'outsider', profile, now)).decisions.length, 0)
      assert.equal((await accountStrategyFeedback(repository, 'alice', { ...profile, accountId: 'unconnected' }, now)).decisions.length, 0)
    }
  } finally { repository.close() }
})

test('writing changes invalidate previously reported originality, hook and media preview checks', () => fixture(async ({ call, context, repository, pack }) => {
  const input = context()
  input.attestations = { rightsConfirmed: true, accessibilityReviewed: true }
  for (const item of input.workflow.destinations) item.checklist = { originalityChecked: true, hookFulfilled: true, phonePreviewChecked: true, soundOffChecked: true, linksChecked: true, livePostInspected: false, contentHash: contentHash(pack) }
  let response = await call('/context', 'PUT', { expectedRevision: 0, context: input })
  assert.equal(response.status, 200, await response.clone().text())
  let result = await response.json()
  for (const report of result.workflow.destinations) for (const step of ['writing', 'creative', 'review']) assert.equal(report.steps.find(item => item.id === step).status, 'ready', step)
  repository.studioPut('alice', 'package', pack.id, { ...pack, content: { ...pack.content, strategy: { ...pack.content.strategy, platforms: pack.content.strategy.platforms.map(post => ({ ...post, body: 'Changed wording requires another preview [C1].' })) } } }, pack.revision)
  response = await call(); assert.equal(response.status, 200)
  result = await response.json()
  for (const report of result.workflow.destinations) for (const step of ['writing', 'creative', 'review']) assert.equal(report.steps.find(item => item.id === step).status, 'needs_attention', `${report.platform} ${step} must be checked for the changed content`)
}))

test('next automatic package inherits only its own account direction and cannot reuse old approvals or live inspections', () => fixture(async ({ context, repository, pack }) => {
  const input = context()
  for (const item of input.workflow.destinations) {
    item.goal.reviewDueAt = iso(1)
    item.expertReview = { required: true, status: 'approved', reviewer: 'Subject owner', reviewedAt: iso(-1), contentHash: contentHash(pack) }
    item.checklist = { originalityChecked: true, hookFulfilled: true, phonePreviewChecked: true, soundOffChecked: true, linksChecked: true, livePostInspected: true, liveUrl: 'https://example.com/old-post', contentHash: contentHash(pack), sensitiveEventCheckedAt: iso(-1) }
    item.community.cases = [{ id: 'old-case', kind: 'question', summary: 'An anonymized question', status: 'closed', owner: 'Community desk', note: 'Handled on previous post.', anonymized: true }]
  }
  repository.studioPut('alice', 'complete_context', pack.id, { packageId: pack.id, context: input }, 0)
  for (const platform of platforms) {
    const template = await accountWorkflowTemplate(repository, 'alice', { platform, accountId: account(platform) }, 'A newly researched topic')
    assert.equal(template.context.workflow.destinations.length, 1)
    const inherited = template.context.workflow.destinations[0]
    assert.equal(inherited.platform, platform); assert.equal(inherited.accountId, account(platform))
    assert.equal(inherited.goal.reviewDueAt, undefined)
    assert.equal(inherited.expertReview.status, 'pending'); assert.equal(inherited.expertReview.contentHash, undefined)
    assert.equal(inherited.checklist.contentHash, undefined); assert.equal(inherited.checklist.liveUrl, undefined)
    assert.ok(Object.values(inherited.checklist).every(item => item === false))
    assert.ok(inherited.candidates.every(item => item.selected === false))
    assert.equal(inherited.community.cases.length, 0); assert.equal(inherited.learnings.length, 0)
    assert.equal((await accountWorkflowTemplate(repository, 'outsider', { platform, accountId: account(platform) }, 'Topic')), null)
  }
  assert.equal(repository.studioGet('alice', 'complete_context', pack.id).context.workflow.destinations[0].expertReview.status, 'approved', 'Copying a template does not mutate its source records')
}))
