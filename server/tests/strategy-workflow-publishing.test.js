import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createPublishingService, approvedCaption } from '../publishing/router.js'
import { contentHash } from '../studio/approval.js'
import { platforms } from '../studio/content.js'

const iso = hours => new Date(Date.now() + hours * 3600000).toISOString()

function fixture(platform, { mutateAt = 0 } = {}) {
  const repository = createRepository(':memory:')
  const accountId = `workflow-${platform}`
  const bytes = Buffer.from('Controlled workflow publishing bytes; not real media.')
  const body = 'The publisher announced a limited preview [C1].'
  const pack = repository.studioPut('alice', 'package', 'workflow-publish', {
    title: 'Limited preview', status: 'completed', settings: { platform, audience: 'AI learners', tone: 'Clear' }, review: { issues: [] },
    evidence: [{ id: 'E1', url: 'https://example.com/announcement', excerpt: 'The publisher announced a limited preview.' }],
    content: { claims: [{ id: 'C1', evidenceId: 'E1', text: 'The publisher announced a limited preview', quote: 'The publisher announced a limited preview.', status: 'attributed' }], strategy: { angle: 'Explain availability', platforms: [{ platform, headline: body, hook: body, body, cta: 'Read the source', format: platform === 'YouTube' ? 'video' : 'post' }] } },
  }, 0)
  const destination = {
    platform, accountId, goal: { primary: 'reach', kpi: 'reach', targetAction: 'Understand availability', reviewAfterHours: 24 },
    audienceQuestions: [{ id: 'question', question: 'Who can use the preview?', source: 'faq', occurrences: 3, audience: 'AI learners', observedAt: iso(-1), anonymized: true }],
    researchLog: ['fact', 'competitor'].map(type => ({ id: type, type, url: `https://example.com/${type}`, observedAt: iso(-1), observation: 'Controlled cited observation.', interpretation: 'Useful framing hypothesis.', response: 'Explain scope.', confidence: 'medium', hypothesis: false, questionIds: [] })),
    trendDecision: { mode: 'not_relevant', reason: 'Evergreen availability explanation; a trend is unnecessary.' },
    candidates: [{ id: 'idea', topic: 'Limited preview', angle: 'Availability', rationale: 'Answers a repeated question.', researchIds: ['fact'], questionIds: ['question'], selected: true, scores: { topicFit: 5, audienceUsefulness: 5, brandFit: 5, evidence: 5, timing: 4, effort: 1, risk: 1 } }],
    keywords: [{ phrase: 'limited preview', placements: ['caption'], rationale: 'Accurately describes the topic.', researchIds: ['fact'] }],
    expertReview: { required: true, status: 'approved', reviewer: 'Controlled reported subject owner', reviewedAt: iso(-0.5), contentHash: contentHash(pack) },
    community: { owner: 'Community desk', responseGuidance: 'Answer with cited resources.', escalationOwner: 'Subject desk', escalationRules: 'Escalate sensitive or individualized requests.', cases: [] },
    checklist: { contentHash: contentHash(pack), originalityChecked: true, hookFulfilled: true, phonePreviewChecked: true, soundOffChecked: true, linksChecked: true, livePostInspected: false, sensitiveEventCheckedAt: iso(-0.5) }, learnings: [],
  }
  const context = { brand: 'Approved editorial identity', accountId, platformAccounts: [{ platform, accountId }], attestations: { rightsConfirmed: true, accessibilityReviewed: true }, workflow: { version: 'strategy-workflow-v1', destinations: [destination] } }
  repository.studioPut('alice', 'complete_context', pack.id, { packageId: pack.id, context }, 0)
  const video = platform === 'YouTube'
  const asset = repository.studioPut('alice', 'asset', 'workflow-asset', { packageId: pack.id, kind: video ? 'video' : 'image', mime: video ? 'video/mp4' : 'image/png', status: 'completed', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 0)
  let creates = 0; let uploads = 0; let checks = 0
  const config = () => ({ enabled: true, accounts: [{ accountId, ownerScope: 'alice', platform, provider: ({ X: 'x', Instagram: 'instagram-standalone', YouTube: 'youtube', Facebook: 'facebook', LinkedIn: 'linkedin' })[platform], ...(video ? { settings: { type: 'public', selfDeclaredMadeForKids: 'no' } } : {}) }] })
  const service = createPublishingService({ repository, config, readFile: async () => bytes, assessReady: async () => {
    checks++
    if (checks === mutateAt) {
      const saved = repository.studioGet('alice', 'complete_context', pack.id)
      const next = { ...saved.context }; delete next.workflow
      repository.studioPut('alice', 'complete_context', pack.id, { ...saved, context: next }, saved.revision)
    }
    return { eligible: true, issues: [], method: 'Controlled readiness fixture, not live media acceptance' }
  }, provider: { upload: async () => { uploads++; return { id: 'uploaded', path: 'https://uploads.postiz.com/controlled.png' } }, create: async () => { creates++; return { postId: 'controlled-post', integration: accountId } } } })
  const input = { requestId: randomUUID(), revision: pack.revision, accountId, platform, mode: 'now', caption: approvedCaption(pack, platform), assetIds: [asset.id], confirmed: true }
  return { repository, context, destination, input, service, pack, publish: () => service.publish({ owner: 'alice', actorUid: 'alice', packageId: pack.id, input }), get creates() { return creates }, get uploads() { return uploads } }
}

test('shared publishing service reaches each controlled platform exactly once with a current complete workflow', async () => {
  for (const platform of platforms) {
    const h = fixture(platform)
    try {
      const result = await h.publish(); assert.equal(result.status, 201, platform)
      assert.equal(h.creates, 1); assert.equal(h.uploads, 1)
      assert.equal((await h.publish()).status, 200); assert.equal(h.creates, 1)
    } finally { h.repository.close() }
  }
})

test('shared publishing service blocks rejected reviews, stale checks and stale used trends before all five provider uploads', async () => {
  for (const platform of platforms) for (const defect of ['rejected', 'stale-checklist', 'stale-trend']) {
    const h = fixture(platform)
    try {
      if (defect === 'rejected') h.destination.expertReview.status = 'rejected'
      if (defect === 'stale-checklist') h.destination.checklist.contentHash = '0'.repeat(64)
      if (defect === 'stale-trend') {
        h.destination.trendDecision.mode = 'use_signal'
        h.destination.researchLog.push({ id: 'trend', type: 'trend', url: 'https://example.com/trend', observedAt: iso(-2), observation: 'Reported search signal.', interpretation: 'Untested idea.', response: 'Recheck before scheduling.', confidence: 'low', hypothesis: true, questionIds: [], trend: { query: 'AI preview', region: 'India', periodStart: iso(-48), periodEnd: iso(-3), recheckAt: iso(-1) } })
      }
      const prior = h.repository.studioGet('alice', 'complete_context', h.pack.id)
      h.repository.studioPut('alice', 'complete_context', h.pack.id, { ...prior, context: h.context }, prior.revision)
      await assert.rejects(h.publish(), error => error.status === 422 && error.preDispatch === true, `${platform} ${defect}`)
      assert.equal(h.creates, 0); assert.equal(h.uploads, 0)
    } finally { h.repository.close() }
  }
})

test('removing strategy during either asynchronous readiness check cannot dispatch a post on any platform', async () => {
  for (const platform of platforms) for (const mutateAt of [1, 2]) {
    const h = fixture(platform, { mutateAt })
    try {
      let result
      try { result = await h.publish() } catch (error) { assert.equal(error.preDispatch, true); assert.ok([409, 422].includes(error.status)) }
      if (result) { assert.equal(result.status, 502, `${platform} check ${mutateAt} must block`); assert.equal(result.receipt.status, 'blocked') }
      assert.equal(h.creates, 0, `${platform} check ${mutateAt} cannot create a provider post`)
      assert.equal(h.uploads, mutateAt === 1 ? 0 : 1, 'Initial check changes must block before upload; final recheck occurs after upload')
    } finally { h.repository.close() }
  }
})
