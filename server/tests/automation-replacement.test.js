import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createAutomationServices } from '../automation/services.js'
import { runAccountAutomation } from '../automation/runner.js'
import { freeTextReplacementJob, createResearch, nicheSchema, researchNiche } from '../studio/intelligence.js'
import { settingsSchema, generateContent } from '../studio/content.js'
import { generateJson } from '../providers/llm.js'
import { runContentJob } from '../studio/job-worker.js'
import { env } from '../config/env.js'
import { ratingsFixture } from './fixtures/finalization.js'

const now = new Date('2026-11-09T06:00:00Z')
const excerpt = 'The publisher announced a limited model preview for developers. Availability remains restricted and independent results are not established.'
const content = { website: { title: 'Limited model preview', body: 'The publisher announced a limited preview [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a limited preview', quote: excerpt, evidenceId: 'E1', status: 'attributed' }] }
async function fixture(repository) {
  return repository.studioPut('alice', 'account_profile', 'profile', { accountId: 'account', platform: 'LinkedIn', timezone: 'Asia/Calcutta', audience: 'Developers', tone: 'Factual', weeklyBrief: 'Explain limited source-supported model previews for developers.', contentPillars: ['AI previews'], weeklyCadence: 3, maxDailyPosts: 1, dailyNews: false, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice', paidBudgetMicros: 0 } }, 0)
}
async function draft(repository, run) {
  return repository.studioPut('alice', 'package', createHash('sha256').update(`${run.id}:package`).digest('hex').slice(0, 32), { createdBy: 'alice', content: null, settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [{ id: 'E1', hash: 'capture-hash', url: 'https://example.com/update', retrievedAt: now.toISOString(), excerpt }], sourceIds: [], status: 'draft' }, 0)
}

test('one real free generation timeout can have one new operation while original job and cost stay unknown', async () => {
  const repository = createRepository(':memory:')
  try {
    const profile = await fixture(repository); const run = { id: 'bounded-real-job' }; const requestId = randomUUID()
    await draft(repository, run)
    let calls = 0
    const services = createAutomationServices(repository, { write: async () => { if (++calls === 1) throw Object.assign(new Error('Local transport timeout'), { code: 'MODEL_TIMEOUT' }); return content } })
    const context = { owner: 'alice', profile, actorUid: 'alice', requestId, run }
    const first = await services.generate(context)
    assert.equal(first.status, 'dispatch_unknown')
    const job = await freeTextReplacementJob(repository, 'alice', requestId, 'generation', 'alice')
    assert.ok(job)
    const eligible = await services.reconcile({ ...context, phase: 'generate' })
    assert.equal(eligible.status, 'free_text_replacement_available')
    const replacementId = randomUUID()
    const result = await services.generate({ ...context, requestId: replacementId, replacementOf: requestId })
    assert.equal(result.status, 'completed'); assert.equal(calls, 2)
    assert.equal((await repository.studioJobGet('alice', requestId)).status, 'dispatch_unknown')
    assert.equal((await repository.budgetGet('alice', requestId)).status, 'dispatch_unknown')
    assert.equal((await repository.studioJobGet('alice', replacementId)).scope.replacementOf, requestId)
    assert.equal(await freeTextReplacementJob(repository, 'alice', replacementId, 'generation', 'alice'), null)
    assert.equal(await freeTextReplacementJob(repository, 'alice', requestId, 'generation', 'other'), null)
  } finally { repository.close() }
})

test('runner persists only one text replacement ID and never replaces unknown publication', async () => {
  const repository = createRepository(':memory:'); const calls = []
  try {
    const profile = await fixture(repository)
    const services = {
      research: async () => ({ reportId: 'report', topics: [{ title: 'Supported topic', evidenceHash: 'source' }] }),
      generate: async ctx => { calls.push(ctx); return { status: 'dispatch_unknown', jobId: ctx.requestId } },
      reconcile: async ctx => ({ status: 'free_text_replacement_available', replacementOf: ctx.requestId }),
      review: async () => ({ eligible: true }), render: async () => ({ assets: ['asset'] }), publish: async () => { throw new Error('must not publish') },
    }
    const first = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(first.deferred, true, 'only an eligible terminal text timeout schedules one continuation')
    const second = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(second.deferred, false, 'the replacement timeout cannot schedule another replacement')
    assert.equal(calls.length, 2); assert.notEqual(calls[0].requestId, calls[1].requestId)
    assert.equal(calls[1].replacementOf, calls[0].requestId)
    assert.equal(second.results[0].replacements.generate.originalRequestId, calls[0].requestId)
    const repeat = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(repeat.deferred, false)
    assert.equal(calls.length, 2)
    const run = second.results[0]
    await repository.studioPut('alice', 'automation_run', run.id, { ...run, stage: 'publish', status: 'dispatch_unknown' }, run.revision)
    const publication = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
    assert.equal(publication.deferred, false)
    assert.equal(calls.length, 2)
  } finally { repository.close() }
})

test('queued or running text work cannot schedule a replacement continuation', async () => {
  for (const status of ['reserved', 'running', 'pending']) {
    const repository = createRepository(':memory:')
    try {
      const profile = await fixture(repository); let reconciles = 0
      const services = { research: async () => ({ status }), generate: async () => {}, review: async () => {}, render: async () => {}, publish: async () => {}, reconcile: async () => { reconciles++; return { status: 'free_text_replacement_available' } } }
      const result = await runAccountAutomation({ repository, owner: 'alice', profile, services, now })
      assert.equal(result.deferred, false); assert.equal(reconciles, 0)
    } finally { repository.close() }
  }
})

test('late original worker response cannot overwrite a replacement package', async () => {
  const repository = createRepository(':memory:')
  let release; let dispatched
  const started = new Promise(resolve => { dispatched = resolve })
  try {
    const profile = await fixture(repository); const run = { id: 'late-worker' }; await draft(repository, run)
    let calls = 0
    const services = createAutomationServices(repository, { write: async () => { if (++calls === 1) { dispatched(); return new Promise(resolve => { release = resolve }) } return content } })
    const requestId = randomUUID(); const context = { owner: 'alice', actorUid: 'alice', profile, run, requestId }
    const first = services.generate(context); await started
    const job = await repository.studioJobGet('alice', requestId)
    await repository.studioJobUpdate('alice', requestId, { status: 'dispatch_unknown', error: 'Local timeout. Diagnostics: {"code":"MODEL_TIMEOUT"}' }, job.revision, 'running')
    const cost = await repository.budgetGet('alice', requestId)
    await repository.budgetTransition('alice', requestId, cost.revision, 'unknown')
    const packageId = job.scope.packageId; const pack = await repository.studioGet('alice', 'package', packageId)
    await repository.studioPut('alice', 'package', packageId, { ...pack, status: 'dispatch_unknown' }, pack.revision)
    const replacementId = randomUUID()
    assert.equal((await services.generate({ ...context, requestId: replacementId, replacementOf: requestId })).status, 'completed')
    release({ ...content, website: { title: 'Late original response', body: content.website.body } })
    await first
    const saved = await repository.studioGet('alice', 'package', packageId)
    assert.equal(saved.jobId, replacementId); assert.equal(saved.content.website.title, 'Limited model preview')
    assert.equal((await repository.studioJobGet('alice', requestId)).status, 'dispatch_unknown')
  } finally { if (release) release(content); repository.close() }
})

test('research replacement bypasses only its own retained timeout and completes a distinct durable job', async () => {
  const repository = createRepository(':memory:')
  try {
    const profile = await fixture(repository); let calls = 0
    const services = createAutomationServices(repository, { research: async () => {
      if (++calls === 1) throw Object.assign(new Error('Local timeout'), { code: 'MODEL_TIMEOUT' })
      return { summary: 'No supported opportunity in this acceptance fixture.', opportunities: [], unknowns: ['No source supplied.'], evidence: [], researchedAt: now.toISOString(), methodology: 'Controlled research test; no real provider request.' }
    } })
    const requestId = randomUUID()
    const context = { owner: 'alice', actorUid: 'alice', profile, slot: { kind: 'weekly' }, localDate: '2026-11-09', now, run: {}, requestId }
    assert.equal((await services.research(context)).status, 'dispatch_unknown')
    assert.equal((await services.reconcile({ ...context, phase: 'research' })).status, 'free_text_replacement_available')
    const replacementId = randomUUID()
    const second = await services.research({ ...context, requestId: replacementId, replacementOf: requestId })
    assert.equal(second.status, 'blocked', 'empty completed research must not invent a topic')
    assert.equal((await repository.studioJobGet('alice', replacementId)).status, 'completed')
    assert.equal((await repository.studioJobGet('alice', requestId)).status, 'dispatch_unknown')
    assert.equal((await repository.budgetGet('alice', requestId)).status, 'dispatch_unknown')
    const state = await repository.studioGet('alice', 'research_state', (await repository.studioJobGet('alice', replacementId)).scope.nicheId)
    assert.equal(state.jobId, replacementId)
    const actualGet = repository.studioJobGet
    repository.studioJobGet = async (...args) => ({ ...await actualGet(...args), result: { unexpected: true } })
    assert.equal(await freeTextReplacementJob(repository, 'alice', requestId, 'research', 'alice'), null)
  } finally { repository.close() }
})

test('paid fallback reservations, changed consent and non-timeout failures prohibit replacement', async () => {
  const repository = createRepository(':memory:')
  try {
    let profile = await fixture(repository); const run = { id: 'deny-replacement' }; await draft(repository, run)
    const services = createAutomationServices(repository, { write: async () => { throw Object.assign(new Error('Local timeout'), { code: 'MODEL_TIMEOUT' }) } })
    const requestId = randomUUID(); const context = { owner: 'alice', actorUid: 'alice', profile, run, requestId }
    await services.generate(context)
    const budgetGet = repository.budgetGet
    repository.budgetGet = async (owner, id) => id === `vertex-${requestId}-0` ? { quote: { upperBoundMicros: 100 } } : budgetGet(owner, id)
    assert.equal(await freeTextReplacementJob(repository, 'alice', requestId, 'generation', 'alice'), null)
    repository.budgetGet = budgetGet
    const jobGet = repository.studioJobGet
    repository.studioJobGet = async (...args) => ({ ...await jobGet(...args), error: 'Unknown network outcome. Diagnostics: {"code":"JOB_FAILED"}' })
    assert.equal(await freeTextReplacementJob(repository, 'alice', requestId, 'generation', 'alice'), null)
    repository.studioJobGet = jobGet
    profile = await repository.studioPut('alice', 'account_profile', profile.id, { ...profile, automationConsent: false }, profile.revision)
    await assert.rejects(services.reconcile({ ...context, phase: 'generate' }), { code: 'JOB_BLOCKED' })
  } finally { repository.close() }
})

test('new research admission binds its free model and a changed worker model blocks before dispatch', async () => {
  const repository = createRepository(':memory:'); const originalModel = env.LLM_MODEL
  try {
    const niche = await repository.studioPut('alice', 'niche', 'model-bound', nicheSchema.parse({ name: 'AI previews', brief: 'Explain source-supported developer previews and preserve limitations.' }), 0)
    const requestId = randomUUID()
    const research = async () => { throw new Error('Changed model must not dispatch') }
    await createResearch({ repository, uid: 'alice', niche, requestId, actorUid: 'alice', research, dispatchMode: 'queue' })
    assert.equal((await repository.studioJobGet('alice', requestId)).scope.llmModel, originalModel)
    env.LLM_MODEL = 'nvidia/different-free-model:free'
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId, research })).status, 'failed')
    assert.equal((await repository.budgetGet('alice', requestId)).status, 'cancelled')
  } finally { env.LLM_MODEL = originalModel; repository.close() }
})

test('research prompt distinguishes attributed reports from independent verification without coercing results', async () => {
  let called = false
  const result = await researchNiche({ name: 'AI previews', windowDays: 7, referenceUrls: ['https://example.com/update'] }, {
    read: async () => [], fetchReference: async () => ({ url: 'https://example.com/update', title: 'Vendor preview announcement', excerpt }),
    generate: async request => {
      called = true
      assert.match(request.system, /reported means an attached source explicitly reports the attributed claim/)
      assert.match(request.system, /NEVER means independently verified/)
      assert.match(request.system, /unconfirmed means the attached text does not support/)
      return { summary: 'No opportunity selected by the controlled fixture.', opportunities: [], unknowns: ['Independent corroboration is unavailable.'] }
    },
  })
  assert.equal(called, true); assert.equal(result.opportunities.length, 0)
})

test('actual automatic model adapter caps writing output at 6000 tokens and retains zero prices', async () => {
  const repository = createRepository(':memory:'); const priorFetch = globalThis.fetch
  const saved = { key: env.OPENROUTER_API_KEY, model: env.LLM_MODEL, capability: env.CONTENT_LIVE_FREE_CALLS }
  try {
    env.OPENROUTER_API_KEY = 'controlled-test-only'; env.LLM_MODEL = 'nvidia/nemotron-3.5-super-vl:free'; env.CONTENT_LIVE_FREE_CALLS = 'true'
    const profile = await fixture(repository); const run = { id: 'bounded-adapter' }; await draft(repository, run)
    let calls = 0
    globalThis.fetch = async (url, init) => {
      calls++; assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
      const body = JSON.parse(init.body)
      assert.equal(body.max_tokens, 6000)
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 })
      const input = JSON.parse(body.messages[1].content)
      const generated = { website: content.website, claims: [{ id: 'C1', text: content.claims[0].text, evidenceId: 'E1', passageId: input.passages[0].id, status: 'attributed' }] }
      if (body.tools) {
        assert.equal(body.response_format, undefined)
        assert.equal(body.tool_choice.function.name, 'submit_json')
        assert.equal(body.tools[0].function.name, 'submit_json')
        assert.equal(body.tools[0].function.strict, true)
        assert.ok(body.tools[0].function.parameters.properties.claims)
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'submit_json', arguments: JSON.stringify(generated) } }] } }] })
      }
      assert.equal(body.response_format.type, 'json_schema')
      return new Response(JSON.stringify({ id: 'gen-123-schema-accepted', choices: [{ finish_reason: 'length', message: { content: JSON.stringify(generated) + '  \n' } }], usage: { completion_tokens: 6000, cost: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const outcome = await createAutomationServices(repository).generate({ owner: 'alice', actorUid: 'alice', profile, run, requestId: randomUUID() })
    assert.equal(outcome.status, 'completed'); assert.equal(calls, 1)
    assert.equal(outcome.package.providerReceipt, null)
    const nativeRun = { id: 'explicit-native-audit' }; await draft(repository, nativeRun)
    const nativeServices = createAutomationServices(repository, { write: (evidence, settings, details, _unused, options) => generateContent(evidence, settings, details, request => generateJson({ ...request, maxTokens: 6000 }, { acceptCompleteJsonAtLength: true }), options) })
    const native = await nativeServices.generate({ owner: 'alice', actorUid: 'alice', profile, run: nativeRun, requestId: randomUUID() })
    assert.equal(native.status, 'completed')
    assert.equal(native.package.providerReceipt.finishReason, 'length')
    assert.equal(native.package.providerReceipt.schemaValidated, true)
    assert.equal(native.package.providerReceipt.billingVerified, false)
    const job = await repository.studioJobGet('alice', native.jobId)
    assert.equal(job.result.providerReceipt.generationId, 'gen-123-schema-accepted')
  } finally { globalThis.fetch = priorFetch; env.OPENROUTER_API_KEY = saved.key; env.LLM_MODEL = saved.model; env.CONTENT_LIVE_FREE_CALLS = saved.capability; repository.close() }
})

test('the actual automated evaluator uses native JSON for the JSON-capable free model while the writer retains its named-tool protocol', async () => {
  const repository = createRepository(':memory:'); const priorFetch = globalThis.fetch
  const saved = { key: env.OPENROUTER_API_KEY, model: env.LLM_MODEL, capability: env.CONTENT_LIVE_FREE_CALLS }
  try {
    env.OPENROUTER_API_KEY = 'controlled-test-only'; env.LLM_MODEL = 'nvidia/nemotron-3.5-super-vl:free'; env.CONTENT_LIVE_FREE_CALLS = 'true'
    const initial = await fixture(repository)
    const profile = repository.studioPut('alice', 'account_profile', initial.id, { ...initial, automaticPolicy: { ...initial.automaticPolicy, consentedAt: new Date(Date.now() - 1000).toISOString() } }, initial.revision)
    const pack = repository.studioPut('alice', 'package', 'native-review-pack', { createdBy: 'alice', content, settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [{ id: 'E1', hash: 'capture', url: 'https://example.com/update', retrievedAt: new Date().toISOString(), excerpt }], sourceIds: [], status: 'completed' }, 0)
    let calls = 0
    globalThis.fetch = async (_url, init) => {
      calls++; const body = JSON.parse(init.body)
      assert.equal(body.tools, undefined)
      assert.equal(body.response_format.type, 'json_schema')
      assert.ok(body.response_format.json_schema.schema.properties.ratings)
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 })
      const result = { claims: [{ id: 'C1', verdict: 'supported', evidenceIds: ['E1'], supportQuote: excerpt, reason: 'The exact selected publisher passage supports the limited preview claim.' }], ratings: ratingsFixture(), checks: { semanticSupport: true, contradictionsResolved: true, scopePreserved: true, promisesAligned: true, privacySafe: true, audienceClaimsSupported: true, provenanceClear: true }, issues: [], summary: 'Controlled native evaluator fixture; no measured performance or human approval is claimed.' }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }], usage: { cost: 0 } })
    }
    const outcome = await createAutomationServices(repository).review({ owner: 'alice', actorUid: 'alice', profile, run: { packageId: pack.id }, requestId: randomUUID() })
    assert.equal(outcome.status, 'passed'); assert.equal(calls, 1)
  } finally { globalThis.fetch = priorFetch; env.OPENROUTER_API_KEY = saved.key; env.LLM_MODEL = saved.model; env.CONTENT_LIVE_FREE_CALLS = saved.capability; repository.close() }
})
