import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRepository } from '../storage/repository.js'
import { collectPublicAiDiscussion, enrichPackagePublicResearch, fetchPublicResearchJson, scorePublicResearchCandidate } from '../automation/public-research-intake.js'
import { completeContextSchema } from '../studio/complete-package.js'
import { platforms } from '../studio/content.js'
import { settingsSchema } from '../studio/content.js'
import { createAutomationServices } from '../automation/services.js'
import { createHash } from 'node:crypto'
import { costScopeHash } from '../budget/policy.js'
import { freeCampaignVersion, freeCampaignHash, freeCampaignRunId } from '../automation/campaign.js'

const now = new Date('2026-11-13T08:00:00Z')
const iso = hours => new Date(now.getTime() + hours * 3600000).toISOString()
const epoch = hours => Math.floor(new Date(iso(hours)).getTime() / 1000)
const topic = 'Claude Fable 5.2 release'
const comment = 'How can we verify the stated limitations?'
const scoringConfig = { LLM_MODEL: 'nvidia/controlled-fixture:free', STUDIO_DAILY_GENERATIONS: 10 }
const ratings = request => ({ scores: { topicFit: 3, audienceUsefulness: 2, brandFit: 2, evidence: 3, timing: 2, effort: 2, risk: 2 }, reasons: Object.fromEntries(['topicFit', 'audienceUsefulness', 'brandFit', 'evidence', 'timing', 'effort', 'risk'].map(key => [key, 'Controlled fixture judgment; account demand is not established.'])), rationale: 'Controlled AI-scoring fixture; actual audience demand and future performance remain unmeasured.', researchIds: request.input.research.map(item => item.id), questionIds: [request.input.question.id] })
function requests(calls, mutate = value => value) {
  return async value => {
    calls.push(value); const url = new URL(value)
    if (url.hostname === 'hn.algolia.com') return url.searchParams.get('tags') === 'story' ? { hits: [{ objectID: '101', title: topic }] } : { hits: [201, 202, 203, 204, 205, 206].map(objectID => ({ objectID: String(objectID), story_id: 101, story_title: topic })) }
    const id = Number(url.pathname.match(/item\/(\d+)\.json/)[1])
    return mutate(id === 101 ? { id, type: 'story', title: topic, time: epoch(-2), score: 19, descendants: 4, by: 'must-not-be-stored' } : { id, type: 'comment', parent: 101, time: epoch(-1), by: 'must-not-be-stored', text: `<p>${comment}</p><p>Email someone@example.com, phone 1234567890.</p>` })
  }
}
function fixture(platform = 'Instagram') {
  const repository = createRepository(':memory:')
  const profile = repository.studioPut('alice', 'account_profile', 'profile', { accountId: `account-${platform}`, platform, audience: 'AI learners', tone: 'Clear', contentPillars: ['AI'], enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice', paidBudgetMicros: 0 } }, 0)
  const pack = repository.studioPut('alice', 'package', 'pack', { title: topic, settings: { platform, industry: 'AI', audience: 'AI learners' }, evidence: [{ id: 'E1', title: topic, url: 'https://example.com/real-announcement', excerpt: 'A captured publisher statement explains the actual release and its limitations. '.repeat(3), retrievedAt: iso(-1) }], content: null }, 0)
  repository.studioPut('alice', 'complete_context', pack.id, { packageId: pack.id, context: { brand: 'Saved brand direction', platformAccounts: [{ platform, accountId: profile.accountId }], workflow: { version: 'strategy-workflow-v1', destinations: [{ platform, accountId: profile.accountId, goal: { primary: 'reach', kpi: 'reach', targetAction: 'Understand limitations', reviewAfterHours: 24 }, audienceQuestions: [], researchLog: [], candidates: [], keywords: [], learnings: [] }] } } }, 0)
  return { repository, profile, pack }
}

test('public AI research confirms official story/comment IDs, minimizes data and never turns duplicate questions into repeated demand', async () => {
  const calls = []
  const result = await collectPublicAiDiscussion(topic, { now, requestJson: requests(calls) })
  assert.equal(result.status, 'available'); assert.equal(result.questions.length, 1)
  assert.equal(result.questions[0].question, comment); assert.equal(result.questions[0].occurrences, 1)
  assert.equal(result.peers[0].points, 19); assert.equal(result.peers[0].commentCount, 4)
  assert.equal(result.peers[0].url, 'https://news.ycombinator.com/item?id=101')
  assert.ok(calls.length <= 8)
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-stored|someone@example.com|1234567890/)
  assert.ok(result.limitations.some(value => /not.*social account audience/.test(value)))
})

test('deleted, future-dated, nested or mismatched official comments never become verified audience questions', async () => {
  for (const mutate of [item => item.type === 'comment' ? { ...item, deleted: true } : item, item => item.type === 'comment' ? { ...item, time: epoch(1) } : item, item => item.type === 'comment' ? { ...item, parent: 999 } : item, item => ({ ...item, id: item.id + 1 })]) {
    const result = await collectPublicAiDiscussion(topic, { now, requestJson: requests([], mutate) })
    assert.notEqual(result.status, 'available'); assert.equal(result.questions.length, 0)
  }
})

test('public API transport rejects unapproved endpoints, private DNS, redirects and oversized responses', async () => {
  for (const url of ['https://localhost/api/v1/search', 'https://hn.algolia.com/private', 'https://user:secret@hn.algolia.com/api/v1/search', 'https://hn.algolia.com:8443/api/v1/search', 'http://hn.algolia.com/api/v1/search']) await assert.rejects(fetchPublicResearchJson(url))
  await assert.rejects(fetchPublicResearchJson('https://hn.algolia.com/api/v1/search', { resolve: async () => [{ address: '127.0.0.1', family: 4 }] }), /public address/)
  for (const kind of ['redirect', 'oversize']) {
    let calls = 0
    const request = (_url, options, cb) => {
      calls++; assert.equal(typeof options.lookup, 'function')
      const outgoing = new EventEmitter()
      outgoing.destroy = error => { outgoing.emit('error', error); outgoing.emit('close') }
      outgoing.end = () => queueMicrotask(() => {
        const incoming = new PassThrough(); incoming.statusCode = kind === 'redirect' ? 302 : 200; incoming.headers = { 'content-type': 'application/json', location: 'https://private.invalid/' }
        cb(incoming); incoming.end(kind === 'oversize' ? 'x'.repeat(256 * 1024 + 1) : '{}'); outgoing.emit('close')
      })
      return outgoing
    }
    await assert.rejects(fetchPublicResearchJson('https://hn.algolia.com/api/v1/search', { resolve: async () => [{ address: '1.1.1.1', family: 4 }], request }), kind === 'redirect' ? /JSON/ : /256 KB/)
    assert.equal(calls, 1, 'No redirect or retry is followed')
  }
})

test('all five account workflows consume cached real public observations without inventing competitors, trends or human approval', async () => {
  for (const platform of platforms) {
    const { repository, profile, pack } = fixture(platform); const calls = []
    try {
      const options = { repository, owner: 'alice', profile, pack, actorUid: 'alice', now, requestJson: requests(calls), generate: async request => ratings(request), config: scoringConfig }
      const result = await enrichPackagePublicResearch(options)
      assert.equal(result.status, 'available', platform)
      const saved = repository.studioGet('alice', 'complete_context', pack.id)
      assert.equal(completeContextSchema.safeParse(saved.context).success, true)
      const dest = saved.context.workflow.destinations[0]
      assert.equal(dest.accountId, profile.accountId); assert.equal(dest.audienceQuestions[0].occurrences, 1)
      assert.ok(dest.researchLog.some(item => item.type === 'audience' && item.hypothesis && item.confidence === 'low'))
      assert.equal(dest.researchLog.some(item => ['competitor', 'trend'].includes(item.type)), false)
      assert.equal(dest.candidates[0].selected, true); assert.match(dest.candidates[0].rationale, /unmeasured/)
      assert.equal(dest.expertReview, undefined); assert.equal(dest.checklist, undefined)
      const requestCount = calls.length
      await enrichPackagePublicResearch(options)
      assert.equal(calls.length, requestCount); assert.equal(repository.studioGet('alice', 'complete_context', pack.id).revision, saved.revision, 'Cached intake is idempotent')
    } finally { repository.close() }
  }
})

test('public intake is consent-bound and owner-isolated, preserves concurrent edits, and does not infer non-tech audience fit', async () => {
  const { repository, profile, pack } = fixture(); const calls = []
  try {
    const options = { repository, owner: 'alice', profile, pack, actorUid: 'alice', now, requestJson: requests(calls), generate: async request => ratings(request), config: scoringConfig }
    await assert.rejects(enrichPackagePublicResearch({ ...options, owner: 'outsider', actorUid: 'outsider' }), /consent/)
    const nonTech = repository.studioPut('alice', 'account_profile', profile.id, { ...profile, contentPillars: ['Astrology'] }, profile.revision)
    assert.equal((await enrichPackagePublicResearch({ ...options, profile: nonTech })).status, 'unsupported'); assert.equal(calls.length, 0)
    const restored = repository.studioPut('alice', 'account_profile', profile.id, { ...nonTech, contentPillars: ['AI'] }, nonTech.revision)
    let changed = false
    const requestJson = async url => {
      if (!changed) { changed = true; const context = repository.studioGet('alice', 'complete_context', pack.id); repository.studioPut('alice', 'complete_context', pack.id, { ...context, context: { ...context.context, objective: 'Concurrent user edit' } }, context.revision) }
      return requests(calls)(url)
    }
    assert.equal((await enrichPackagePublicResearch({ ...options, profile: restored, requestJson })).status, 'changed')
    const context = repository.studioGet('alice', 'complete_context', pack.id)
    assert.equal(context.context.objective, 'Concurrent user edit'); assert.deepEqual(context.context.workflow.destinations[0].audienceQuestions, [])
  } finally { repository.close() }
})

test('public intake scores a bounded pool and selects the best supported candidate rather than the first question', async () => {
  const { repository, profile, pack } = fixture()
  let scored = 0
  try {
    const result = await enrichPackagePublicResearch({ repository, owner: 'alice', profile, pack, actorUid: 'alice', now,
      requestJson: requests([], item => item.type === 'comment' ? { ...item, text: `How can scenario ${item.id} verify the stated limitations?` } : item),
      generate: async request => { scored++; const r = ratings(request); r.scores.audienceUsefulness = scored === 2 ? 5 : 1; return r }, config: scoringConfig,
    })
    assert.equal(result.status, 'available')
    const candidates = repository.studioGet('alice','complete_context',pack.id).context.workflow.destinations[0].candidates
    assert.equal(scored, 3)
    assert.equal(candidates.length, 3)
    assert.equal(candidates.filter(item=>item.selected).length, 1)
    assert.equal(candidates.find(item=>item.selected).scores.audienceUsefulness, 5)
    assert.equal(candidates.find(item=>item.selected).questionIds[0], 'public-hn-q-202')
  } finally { repository.close() }
})

test('a revoked owner consent during the first public query prevents all persistence and any later official fetch', async () => {
  const { repository, profile, pack } = fixture(); const calls = []
  try {
    let revoked = false
    const requestJson = async url => {
      if (!revoked) { revoked = true; repository.studioPut('alice', 'account_profile', profile.id, { ...profile, automationConsent: false }, profile.revision) }
      return requests(calls)(url)
    }
    await assert.rejects(enrichPackagePublicResearch({ repository, owner: 'alice', profile, pack, actorUid: 'alice', now, requestJson }), /consent/)
    assert.equal(repository.studioList('alice', 'public_research_intake').length, 0)
    assert.equal(repository.studioGet('alice', 'complete_context', pack.id).revision, 1)
    assert.ok(calls.length <= 2)
  } finally { repository.close() }
})

test('revoked campaign authorization is rechecked within public intake before later HTTP or AI operations', async () => {
  const { repository, profile, pack } = fixture(); let active = true; let requestsSent = 0; let scores = 0
  try {
    const assertAuthorization = async () => { if (!active) throw new Error('Campaign authorization was revoked') }
    await assert.rejects(enrichPackagePublicResearch({ repository, owner: 'alice', profile, pack, actorUid: 'alice', now, assertAuthorization, requestJson: async () => { requestsSent++; active = false; return { hits: [] } }, generate: async request => { scores++; return ratings(request) }, config: scoringConfig }), /revoked/)
    assert.ok(requestsSent <= 2); assert.equal(scores, 0)
    assert.equal(repository.studioList('alice', 'public_research_intake').length, 0)
  } finally { repository.close() }
})

test('actual automatic generation consumes public intake in its saved workflow before invoking the model adapter', async () => {
  const { repository, profile, pack } = fixture(); const calls = []
  try {
    const id = createHash('sha256').update('run:package').digest('hex').slice(0, 32)
    const source = pack.evidence[0]
    repository.studioPut('alice', 'package', id, { ...pack, settings: settingsSchema.parse({ platform: profile.platform, outputs: ['script'] }), status: 'draft' }, 0)
    const context = repository.studioGet('alice', 'complete_context', pack.id)
    repository.studioPut('alice', 'complete_context', id, { packageId: id, context: context.context }, 0)
    let writes = 0
    const services = createAutomationServices(repository, {
      publicResearch: options => enrichPackagePublicResearch({ ...options, requestJson: requests(calls), generate: async request => ratings(request), config: scoringConfig }),
      write: async (_evidence, _settings, details) => {
        writes++
        assert.equal(details.strategyWorkflow.destinations[0].audienceQuestions[0].question, comment)
        const quote = source.excerpt.split('. ')[0] + '.'
        return { hooks: ['The release has limitations [C1]'], script: 'A captured publisher statement explains the actual release and its limitations [C1].', claims: [{ id: 'C1', text: 'A captured publisher statement explains the actual release and its limitations', evidenceId: 'E1', quote, status: 'attributed' }] }
      },
    })
    const result = await services.generate({ repository, owner: 'alice', profile, requestId: 'public-intake-generation', actorUid: 'alice', now, run: { id: 'run' } })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(writes, 1); assert.ok(calls.length > 0)
  } finally { repository.close() }
})

test('missing public questions yield a zero-occurrence editorial hypothesis tied to an actual captured publisher source, not fabricated audience demand', async () => {
  const { repository, profile, pack } = fixture()
  try {
    const result = await enrichPackagePublicResearch({ repository, owner: 'alice', profile, pack, actorUid: 'alice', now, requestJson: async () => ({ hits: [] }), generate: async request => ratings(request), config: scoringConfig })
    assert.equal(result.observedQuestionCount, 0); assert.equal(result.inferredQuestionCount, 1)
    const context = repository.studioGet('alice', 'complete_context', pack.id).context
    const question = context.workflow.destinations[0].audienceQuestions[0]
    assert.equal(question.source, 'editorial-hypothesis'); assert.equal(question.occurrences, 0); assert.equal(question.hypothesis, true)
    assert.match(question.basisNote, /No matching public or account audience question was observed/)
    assert.equal(question.sourceUrl, pack.evidence[0].url)
    assert.equal(completeContextSchema.safeParse(context).success, true)
    question.source = 'community'
    assert.equal(completeContextSchema.safeParse(context).success, false, 'A zero-count hypothesis cannot masquerade as an observed public question')
  } finally { repository.close() }
})

test('dynamic candidate scoring preserves unknown requests, rejects fabricated references and cannot substitute static ratings after provider failure', async () => {
  for (const failure of ['unknown', 'fabricated']) {
    const { repository, profile, pack } = fixture()
    try {
      let calls = 0
      let scoringId
      const observedRepository = { ...repository, studioJobReserve: (...args) => { scoringId = args[1]; return repository.studioJobReserve(...args) } }
      const question = { id: 'q', question: comment, occurrences: 0, source: 'editorial-hypothesis' }
      const research = [{ id: 'fact', type: 'fact', observation: 'A captured publisher statement', url: pack.evidence[0].url }]
      const generate = async request => { calls++; if (failure === 'unknown') throw Object.assign(new Error('Controlled timeout'), { code: 'MODEL_TIMEOUT' }); return { ...ratings(request), researchIds: ['invented'] } }
      const options = { repository: observedRepository, owner: 'alice', profile, pack, actorUid: 'alice', contextRevision: 1, question, research, assertConsent: async () => {}, generate, config: scoringConfig }
      await assert.rejects(scorePublicResearchCandidate(options), /unavailable/)
      await assert.rejects(scorePublicResearchCandidate(options), /prior candidate scoring/)
      assert.equal(calls, 1)
      const job = repository.studioJobGet('alice', scoringId)
      assert.equal(job.status, failure === 'unknown' ? 'dispatch_unknown' : 'failed')
      assert.equal(repository.studioGet('alice', 'complete_context', pack.id).context.workflow.destinations[0].candidates.length, 0)
    } finally { repository.close() }
  }
})

test('actual campaign research fetches only its frozen reference and reuses the captured source-led opportunity without ordinary RSS or fake AI research', async () => {
  const { repository, profile: initial, pack } = fixture()
  const priorAccounts = process.env.POSTIZ_ACCOUNTS_JSON
  try {
    const profile = repository.studioPut('alice', 'account_profile', initial.id, { ...initial, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice', paidBudgetMicros: 0 } }, initial.revision)
    process.env.POSTIZ_ACCOUNTS_JSON = JSON.stringify([{ ownerScope: 'alice', accountId: profile.accountId, platform: profile.platform, provider: 'controlled-provider', name: 'Controlled account' }])
    const campaign = { id: 'campaign-reference', version: freeCampaignVersion, status: 'active', actorUid: 'alice', createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), referenceUrl: 'https://example.com/frozen-reference', topic: 'A proposed explanation', accountIds: [profile.accountId], profileBindings: [{ profileId: profile.id, accountId: profile.accountId, profileHash: costScopeHash(profile, null) }], freeOnly: true, paidBudgetMicros: 0, maxRuns: 5 }
    const recorded = repository.studioPut('alice', 'automation_campaign', campaign.id, campaign, 0)
    campaign.createdAt = recorded.createdAt
    const run = { id: freeCampaignRunId('alice', campaign.id, profile.accountId), campaignId: campaign.id, campaignHash: freeCampaignHash(campaign), campaignReferenceUrl: campaign.referenceUrl, campaignTopic: campaign.topic, paidBudgetMicros: 0 }
    let fetched = 0
    const services = createAutomationServices(repository, { research: async () => { throw Error('Unrelated general research cannot run for a frozen campaign') }, fetchSource: async url => { fetched++; assert.equal(url, campaign.referenceUrl); return { ...pack.evidence[0], url, title: 'The actual publisher title', retrievedAt: new Date().toISOString() } } })
    const options = { repository, owner: 'alice', profile, actorUid: 'alice', slot: { kind: 'campaign', index: 0 }, requestId: 'campaign-research', run }
    const result = await services.research(options)
    assert.equal(result.status, 'completed'); assert.equal(result.topics[0].title, 'The actual publisher title')
    const report = repository.studioGet('alice', 'research', result.reportId)
    assert.match(report.methodology, /not an AI research report/)
    assert.equal(report.requestedTopic, campaign.topic); assert.equal(report.evidence.length, 1)
    await services.research(options); assert.equal(fetched, 1)
    repository.studioPut('alice', 'account_profile', profile.id, { ...profile, automationConsent: false }, profile.revision)
    await assert.rejects(services.research(options), /consent/)
    assert.equal(fetched, 1)
  } finally { if (priorAccounts === undefined) delete process.env.POSTIZ_ACCOUNTS_JSON; else process.env.POSTIZ_ACCOUNTS_JSON = priorAccounts; repository.close() }
})

test('public trend intake runs before candidate scoring and preserves an explicit evergreen decision', async () => {
  for (const explicitEvergreen of [false, true]) {
    const { repository, profile, pack } = fixture(); const events = []
    try {
      if (explicitEvergreen) {
        const current = repository.studioGet('alice', 'complete_context', pack.id)
        current.context.workflow.destinations[0].trendDecision = { mode: 'not_relevant', reason: 'Owner selected an evergreen educational explanation.' }
        repository.studioPut('alice', 'complete_context', pack.id, current, current.revision)
      }
      const trendIntake = async ({ assertAuthorization }) => { await assertAuthorization(); events.push('trend'); return { status: 'available', intakeId: 'official-trend', workflowPatch: { trendDecision: { mode: 'use_signal', reason: 'A matching official public RSS query snapshot; intent and growth remain unknown.' }, researchRecord: { id: 'official-trend', type: 'trend', url: 'https://trends.google.com/trending/rss?geo=IN', observedAt: now.toISOString(), observation: 'A matching public query snapshot was captured.', interpretation: 'Relevance is a hypothesis, not a growth measurement.', response: 'Consider the topic fit and recheck before publishing.', confidence: 'low', hypothesis: true, questionIds: [], trend: { query: 'Claude', region: 'IN', periodStart: iso(-2), periodEnd: now.toISOString(), recheckAt: iso(1) } } } } }
      const result = await enrichPackagePublicResearch({ repository, owner: 'alice', profile, pack, actorUid: 'alice', now, requestJson: requests([]), trendIntake, config: scoringConfig, generate: async request => { events.push('score'); assert.equal(request.input.research.some(item => item.type === 'trend'), !explicitEvergreen); return ratings(request) } })
      assert.equal(result.trendStatus, 'available'); assert.deepEqual(events, ['trend', 'score'])
      const destination = repository.studioGet('alice', 'complete_context', pack.id).context.workflow.destinations[0]
      assert.equal(destination.trendDecision.mode, explicitEvergreen ? 'not_relevant' : 'use_signal')
      assert.ok(destination.researchLog.some(item => item.id === 'official-trend'))
      if (explicitEvergreen) assert.equal(destination.candidates[0].researchIds.includes('official-trend'), false)
    } finally { repository.close() }
  }
})
