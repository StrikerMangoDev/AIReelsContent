import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { intelligenceRouter, nicheSchema } from '../studio/intelligence.js'
import { auditDecision, canonicalTopic } from '../studio/idea-intake.js'

async function fixture(run, generate = async () => { throw new Error('Unexpected model call') }, decorate = value => value) {
  const repository = createRepository(':memory:')
  const app = express(); app.use(express.json())
  const auth = (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice' }; next() }
  app.use('/intelligence', intelligenceRouter({ repository: decorate(repository), auth, assist: generate }))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path, body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/intelligence${path}`, { method: 'POST', headers: { authorization: actor, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try { await run(repository, call) } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
}

test('exhausted assistance returns a useful limit and comparison falls back without creating', async () => fixture(async (repository, call) => {
  repository.studioPut('alice', 'niche', randomUUID(), nicheSchema.parse({ name: 'AI', brief: 'Specialist research for software builders.' }), 0)
  const help = await call('/ideas/help', { input: { topic: 'Astrology' }, requestId: randomUUID() })
  assert.equal(help.status, 429); assert.match((await help.json()).error, /AI help and comparison allowance/)
  const check = await call('/ideas/check', { input: { topic: 'Astrology' }, requestId: randomUUID() })
  assert.equal(check.status, 200)
  const audit = await check.json(); assert.equal(audit.action, 'clarify'); assert.match(audit.reason, /allowance/)
  assert.equal((await call('/ideas/create', { auditId: audit.id, confirmed: true })).status, 403)
}, undefined, repository => new Proxy(repository, { get(target, key) {
  if (key === 'studioJobReserve') return () => { throw Object.assign(new Error('Job allowance reached'), { code: 'STUDIO_QUOTA' }) }
  return target[key]
} })))

test('eight reuses, nine creates, and uncertainty explains its actual constraint', () => {
  assert.equal(auditDecision([{ id: 'a', difference: 8, certain: true, reason: 'Compatible scope' }]).action, 'reuse')
  assert.equal(auditDecision([{ id: 'a', difference: 9, certain: true, reason: 'Different scope' }]).action, 'new')
  const unsure = auditDecision([{ id: 'a', difference: 0, certain: false, reason: 'Apple may mean the fruit or company.' }])
  assert.equal(unsure.action, 'clarify'); assert.match(unsure.reason, /fruit or company/)
  assert.equal(canonicalTopic('jyotish'), 'astrology'); assert.equal(canonicalTopic('jyotishman'), 'jyotishman')
  assert.notEqual(canonicalTopic('AI news'), canonicalTopic('news'))
})

test('new creation requires an audit, ambiguous subjects do not create, and exact reuse needs no model', async () => fixture(async (repository, call) => {
  assert.equal((await call('/niches', { niche: { name: 'AI', brief: 'Explain AI for curious readers.' } })).status, 422)
  const uncertain = await (await call('/ideas/check', { input: { topic: 'Apple' }, requestId: randomUUID() })).json()
  assert.equal(uncertain.action, 'clarify')
  assert.equal((await call('/ideas/create', { auditId: uncertain.id, confirmed: true })).status, 403)
  const command = { input: { topic: 'AI content' }, requestId: randomUUID() }
  const audit = await (await call('/ideas/check', command)).json()
  const created = await call('/ideas/create', { auditId: audit.id, confirmed: true }); assert.equal(created.status, 201)
  const niche = await created.json()
  const reused = await (await call('/ideas/check', { input: { topic: 'trending AI' }, requestId: randomUUID() })).json()
  assert.equal(reused.action, 'reuse'); assert.equal(reused.matchedId, niche.id)
  assert.equal((await call('/ideas/create', { auditId: audit.id, confirmed: true }, 'bob')).status, 403)
  assert.equal(repository.studioList('alice', 'niche').length, 1)
}))

test('concurrent deterministic audit requests are idempotent', async () => fixture(async (repository, call) => {
  const command = { input: { topic: 'Fitness' }, requestId: randomUUID() }
  const responses = await Promise.all([call('/ideas/check', command), call('/ideas/check', command)])
  assert.deepEqual(responses.map(value => value.status), [200, 200])
  const audits = await Promise.all(responses.map(value => value.json()))
  assert.equal(audits[0].id, audits[1].id); assert.equal(repository.studioList('alice', 'idea_audit').length, 1)
  assert.equal((await call('/ideas/check', { ...command, input: { topic: 'Cinema' } })).status, 409)
}))

test('partial category creation recovers without duplicate or adopting unrelated identifiers', async () => {
  let failAuditUpdate = true
  await fixture(async (repository, call) => {
    const audit = await (await call('/ideas/check', { input: { topic: 'Fitness' }, requestId: randomUUID() })).json()
    const command = { auditId: audit.id, confirmed: true }
    assert.equal((await call('/ideas/create', command)).status, 500)
    assert.equal(repository.studioList('alice', 'niche').length, 1)
    const recovered = await call('/ideas/create', command); assert.equal(recovered.status, 200)
    assert.equal((await recovered.json()).id, audit.id)
    assert.equal(repository.studioList('alice', 'niche').length, 1)
  }, undefined, repository => new Proxy(repository, { get(target, key) {
    if (key === 'studioPut') return (uid, kind, id, value, revision) => {
      if (kind === 'idea_audit' && value.createdId && failAuditUpdate) { failAuditUpdate = false; throw new Error('Injected persistence failure') }
      return target.studioPut(uid, kind, id, value, revision)
    }
    return target[key]
  } }))
  await fixture(async (repository, call) => {
    const id = randomUUID()
    const audit = await (await call('/ideas/check', { input: { topic: 'Fitness' }, requestId: id })).json()
    repository.studioPut('alice', 'niche', id, nicheSchema.parse({ name: 'Finance', brief: 'An unrelated existing finance category.' }), 0)
    assert.equal((await call('/ideas/create', { auditId: audit.id, confirmed: true })).status, 409)
  })
})

test('semantic scores are validated against the complete workspace library before creation', async () => {
  let calls = 0
  await fixture(async (repository, call) => {
    repository.studioPut('alice', 'niche', randomUUID(), nicheSchema.parse({ name: 'Science', brief: 'Scientific research announcements.' }), 0)
    const result = await (await call('/ideas/check', { input: { topic: 'Quantum computing', brief: 'Hardware for researchers.' }, requestId: randomUUID() })).json()
    assert.equal(result.action, 'clarify'); assert.equal(calls, 1)
    assert.equal((await call('/ideas/create', { auditId: result.id, confirmed: true })).status, 403)
  }, async () => { calls++; return { comparisons: [{ id: 'fabricated-id', difference: 10, certain: true, reason: 'Different subject' }] } })
})

test('an explicit brief permits an ambiguous subject in an empty library without unnecessary model comparison', async () => {
  let calls = 0
  await fixture(async (_repository, call) => {
    const command = { input: { topic: 'Apple', brief: 'Recipes using apples, the fruit; not the technology company.' }, requestId: randomUUID() }
    const first = await (await call('/ideas/check', command)).json()
    assert.equal(first.action, 'new'); assert.equal(first.method, 'normalized-subject-v1')
    assert.equal((await (await call('/ideas/check', command)).json()).id, first.id)
    assert.equal(calls, 0)
    assert.equal((await call('/ideas/create', { auditId: first.id, confirmed: true })).status, 201)
  }, async () => { calls++; return { certain: true, reason: 'The brief explicitly selects the fruit.' } })
})

for (const score of [8, 9]) test(`semantic route score ${score} ${score === 8 ? 'reuses' : 'creates'} while preserving specialist constraints`, async () => {
  let expectedId; let calls = 0
  const input = { topic: 'AI oncology', brief: 'Evaluate oncology-specific AI research with source limitations.', audience: 'Oncologists', region: 'India', referenceUrls: ['https://example.com/oncology'] }
  await fixture(async (repository, call) => {
    const existing = repository.studioPut('alice', 'niche', randomUUID(), nicheSchema.parse({ name: 'AI clinical research', brief: 'Interpret clinical AI research for practicing specialists.', audience: 'Clinicians', region: 'Global', referenceUrls: ['https://example.com/clinical'] }), 0)
    expectedId = existing.id
    const checked = await call('/ideas/check', { input, requestId: randomUUID() })
    assert.equal(checked.status, 200)
    const audit = await checked.json()
    assert.equal(audit.difference, score); assert.equal(audit.action, score === 8 ? 'reuse' : 'new'); assert.equal(audit.matchedId, existing.id)
    assert.equal(audit.method, 'configured-model-semantic-v1'); assert.equal(calls, 1)
    const response = await call('/ideas/create', { auditId: audit.id, confirmed: true })
    if (score === 8) {
      assert.equal(response.status, 403); assert.equal(repository.studioList('alice', 'niche').length, 1)
    } else {
      assert.equal(response.status, 201)
      const created = await response.json()
      assert.equal(created.brief, input.brief); assert.equal(created.audience, input.audience)
      assert.equal(created.region, input.region); assert.deepEqual(created.referenceUrls, input.referenceUrls)
      assert.equal(repository.studioList('alice', 'niche').length, 2)
    }
  }, async ({ input: supplied }) => {
    calls++; assert.deepEqual(Object.fromEntries(Object.keys(input).map(key => [key, supplied.requested[key]])), input)
    assert.equal(supplied.categories.length, 1); assert.equal(supplied.categories[0].id, expectedId)
    assert.equal(supplied.categories[0].audience, 'Clinicians'); assert.deepEqual(supplied.categories[0].referenceUrls, ['https://example.com/clinical'])
    return { comparisons: [{ id: expectedId, difference: score, certain: true, reason: score === 8 ? 'Existing research includes this specialist scope.' : 'Oncology-only audience and reference constraints require separate research.' }] }
  })
})

test('new-category audit cannot create against a library changed after comparison', async () => fixture(async (repository, call) => {
  const response = await call('/ideas/check', { input: { topic: 'Fitness' }, requestId: randomUUID() })
  assert.equal(response.status, 200)
  const audit = await response.json(); assert.equal(audit.action, 'new')
  repository.studioPut('alice', 'niche', randomUUID(), nicheSchema.parse({ name: 'Health', brief: 'Health research added by another editor.' }), 0)
  const created = await call('/ideas/create', { auditId: audit.id, confirmed: true })
  assert.equal(created.status, 409); assert.match((await created.json()).error, /library changed/i)
  assert.equal(repository.studioList('alice', 'niche').length, 1)
  assert.equal(repository.studioGet('alice', 'niche', audit.id), null)
}))

test('provider authentication failure is a useful unavailable response, never permission to create', async () => fixture(async (repository, call) => {
  repository.studioPut('alice', 'niche', randomUUID(), nicheSchema.parse({ name: 'AI', brief: 'Specialist software research.' }), 0)
  const help = await call('/ideas/help', { input: { topic: 'Astrology' }, requestId: randomUUID() })
  assert.equal(help.status, 503); assert.match((await help.json()).error, /AI assistance is unavailable/)
  const response = await call('/ideas/check', { input: { topic: 'Astrology' }, requestId: randomUUID() })
  assert.equal(response.status, 200)
  const audit = await response.json(); assert.equal(audit.action, 'clarify')
  assert.equal((await call('/ideas/create', { auditId: audit.id, confirmed: true })).status, 403)
  const sameTopic = await (await call('/ideas/check', { input: { topic: 'AI' }, requestId: randomUUID() })).json()
  assert.equal(sameTopic.action, 'clarify'); assert.equal(sameTopic.suggestions.length, 1); assert.equal(sameTopic.suggestions[0].name, 'AI')
  assert.equal(repository.studioList('alice', 'niche').length, 1)
}, async () => { throw Object.assign(new Error('Provider rejected key'), { code: 'MODEL_HTTP_ERROR', status: 401 }) }))


test('category setup survives AI help, audit and creation with explicit free-only refresh consent', async () => fixture(async (repository, call) => {
  const input = { topic: 'AI news', coverage: 'both', country: 'India', topics: ['AI tools', 'Policy'], intent: 'Explain practical AI news for small businesses.', exclusions: 'Rumours', autoRefresh: true, refreshIntervalDays: 7, windowDays: 30, language: 'English' }
  const helped = await call('/ideas/help', { input, requestId: randomUUID() })
  assert.equal(helped.status, 200); assert.deepEqual((await helped.json()).topics, input.topics)
  const checked = await call('/ideas/check', { input, requestId: randomUUID() }); assert.equal(checked.status, 200)
  const audit = await checked.json()
  const created = await (await call('/ideas/create', { auditId: audit.id, confirmed: true })).json()
  for (const key of ['coverage', 'country', 'topics', 'intent', 'exclusions', 'autoRefresh', 'refreshIntervalDays', 'windowDays', 'language']) assert.deepEqual(created[key], input[key])
  assert.equal(created.autoRefreshConsent, 1); assert.equal(created.autoRefreshActor, 'alice')
  assert.equal(repository.studioList('alice', 'research').length, 0)
  assert.equal((await call('/ideas/check', { input: { topic: 'News', coverage: 'national' }, requestId: randomUUID() })).status, 400)
}, async ({ input }) => ({ brief: 'Explain sourced AI developments with context and limitations.', topics: input.topics, intent: input.intent })))
