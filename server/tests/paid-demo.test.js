import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { assertDemoAuthorization, createDemoGenerator, demoBudgetOwner, demoStageRequestId } from '../automation/demo.js'
import { generateVertexJson, vertexFallbackAllowed, vertexDemoCallUpperBoundMicros, vertexWifAudience, vertexWifServiceAccount } from '../providers/vertex-fallback.js'
import { contentHash } from '../studio/approval.js'
import { createDemoFixture } from './fixtures/demo.js'

const config = { CONTENT_VERTEX_FALLBACK: 'false', VERTEX_WIF_AUDIENCE: vertexWifAudience, VERTEX_WIF_SERVICE_ACCOUNT: vertexWifServiceAccount }
const input = { system: 'Return controlled test JSON.', input: {}, schema: { type: 'object' }, maxTokens: 1000 }
const success = async () => ({ text: '{"ok":true}', candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, thoughtsTokenCount: 0 } })

test('paid demo is exact-owner, five-run, current-profile bound with stable generation/review IDs', async () => {
  const repository = createRepository(':memory:')
  try {
    const fixture = await createDemoFixture(repository); const context = fixture.contexts[0]
    const admitted = await assertDemoAuthorization(context)
    assert.equal(admitted.budgetOwner, demoBudgetOwner(fixture.owner, fixture.demoId)); assert.equal(admitted.requiredQuoteMicros, 1277952)
    assert.equal(await assertDemoAuthorization({ ...context, run: {} }), null)
    for (const patch of [{ owner: 'another-owner' }, { actorUid: 'another-actor' }, { phase: 'publish' }, { run: { ...context.run, demoAuthorizationId: '' } }, { run: { ...context.run, id: '0'.repeat(32) } }]) await assert.rejects(assertDemoAuthorization({ ...context, ...patch }), { code: 'BUDGET_BLOCKED', preDispatch: true })
    const firstId = demoStageRequestId(context.run, 'generate')
    assert.equal(demoStageRequestId({ ...context.run, contentHash: 'changed-new-content' }, 'generate'), firstId)
    assert.notEqual(demoStageRequestId(context.run, 'review'), demoStageRequestId({ ...context.run, contentHash: 'changed-new-content' }, 'review'))
    const pack = await repository.studioGet(context.owner, 'package', context.run.packageId)
    const changed = await repository.studioPut(context.owner, 'package', pack.id, { ...pack, content: { controlled: 'new output' } }, pack.revision)
    await assert.rejects(assertDemoAuthorization(context), { code: 'BUDGET_BLOCKED' })
    const run = await repository.studioPut(context.owner, 'automation_run', context.run.id, { ...context.run, stage: 'review', status: 'review_running', contentHash: contentHash(changed) }, context.run.revision)
    assert.ok(await assertDemoAuthorization({ ...context, run, phase: 'review' }))
    const profile = await repository.studioPut(context.owner, 'account_profile', context.profile.id, { ...context.profile, automationConsent: false }, context.profile.revision)
    await assert.rejects(assertDemoAuthorization({ ...context, run, profile, phase: 'review' }), { code: 'BUDGET_BLOCKED' })
  } finally { repository.close() }
})

test('paid demo preserves recurring zero budget, settles actual usage, blocks duplicate and unsettled correction', async () => {
  const repository = createRepository(':memory:')
  try {
    const { contexts, owner, demoId } = await createDemoFixture(repository); let calls = 0
    const generator = createDemoGenerator(contexts[0], { config, request: async (...args) => { calls++; assert.equal(args[3], 110000); return success(...args) } })
    assert.deepEqual(await generator(input), { ok: true })
    assert.equal(repository.budgetSummary(demoBudgetOwner(owner, demoId)).settledMicros, 825)
    assert.equal(repository.budgetSummary(owner).limitMicros, 0)
    assert.equal(vertexFallbackAllowed(config), false)
    await assert.rejects(createDemoGenerator(contexts[0], { config, request: success })(input), /already exists/)
    assert.equal(calls, 1)
    const uncertain = createDemoGenerator(contexts[1], { config, request: async () => { throw new Error('private transport details') } })
    await assert.rejects(uncertain(input), { code: 'VERTEX_REQUEST_FAILED' })
    await assert.rejects(uncertain(input), /unsettled usage/)
    assert.equal(repository.budgetGet(demoBudgetOwner(owner, demoId), `demo:${demoStageRequestId(contexts[1].run, 'generate')}:0`).status, 'dispatch_unknown')
  } finally { repository.close() }
})

test('demo revocation, expiry, expanded scope or changed package binding block before provider admission', async () => {
  const repository = createRepository(':memory:')
  try {
    const { contexts, owner, demoId, authorization } = await createDemoFixture(repository)
    for (const patch of [{ status: 'revoked' }, { expiresAt: '2000-01-01T00:00:00.000Z' }, { authorizedAt: new Date(Date.now() + 60000).toISOString() }, { expiresAt: new Date(Date.now() + 172800000).toISOString() }, { runs: authorization.runs.slice(0, 4) }, { projectId: 'wrong-project' }, { totalLimitMicros: 5000001 }, { allowedStages: ['generate', 'publish'] }]) {
      const current = await repository.studioGet(owner, 'automation_demo', demoId)
      await repository.studioPut(owner, 'automation_demo', demoId, { ...authorization, ...patch }, current.revision)
      await assert.rejects(assertDemoAuthorization(contexts[0]), { code: 'BUDGET_BLOCKED', preDispatch: true })
    }
    const current = await repository.studioGet(owner, 'automation_demo', demoId)
    await repository.studioPut(owner, 'automation_demo', demoId, authorization, current.revision)
    await assert.rejects(assertDemoAuthorization({ ...contexts[0], run: { ...contexts[0].run, packageId: contexts[1].run.packageId } }), { code: 'BUDGET_BLOCKED' })
    assert.equal(repository.budgetSummary(demoBudgetOwner(owner, demoId)).heldMicros, 0)
  } finally { repository.close() }
})

test('paid demo lifetime shared cap protects all simultaneous worst-case calls and rechecks consent at dispatch', async () => {
  const repository = createRepository(':memory:')
  try {
    const { contexts, owner, demoId } = await createDemoFixture(repository)
    const releases = []; let signalled
    const threeStarted = new Promise(resolve => { signalled = resolve })
    const work = contexts.map(context => createDemoGenerator(context, { config, request: async () => { await new Promise(resolve => { releases.push(resolve); if (releases.length === 3) signalled() }); return success() } })(input))
    const settled = Promise.allSettled(work)
    await threeStarted
    const summary = repository.budgetSummary(demoBudgetOwner(owner, demoId))
    assert.equal(summary.heldMicros, vertexDemoCallUpperBoundMicros * 3); assert.ok(summary.heldMicros <= 5000000)
    releases.forEach(resolve => resolve())
    const results = await settled
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 3)
    assert.equal(results.filter(result => result.status === 'rejected').length, 2)
    const target = contexts[4]; let calls = 0
    await assert.rejects(createDemoGenerator(target, { config, beforeAttempt: async () => {
      const current = await repository.studioGet(owner, 'account_profile', target.profile.id)
      await repository.studioPut(owner, 'account_profile', current.id, { ...current, enabled: false }, current.revision)
      await assertDemoAuthorization(target)
    }, request: async () => { calls++; return success() } })(input), { code: 'BUDGET_BLOCKED' })
    assert.equal(calls, 0)
  } finally { repository.close() }
})

test('provider access rejection blocks the entire demo; JSON credentials reject wrong type or project before reservation', async () => {
  const repository = createRepository(':memory:')
  try {
    const { contexts, owner, demoId } = await createDemoFixture(repository); let calls = 0
    await assert.rejects(createDemoGenerator(contexts[0], { config, request: async () => { calls++; throw Object.assign(new Error('private provider response'), { status: 403 }) } })(input), { code: 'VERTEX_REQUEST_FAILED' })
    assert.equal((await repository.studioGet(owner, 'automation_demo', demoId)).status, 'blocked')
    await assert.rejects(createDemoGenerator(contexts[1], { config, request: async () => { calls++; return success() } })(input), { code: 'BUDGET_BLOCKED' })
    assert.equal(calls, 1)
    for (const credentials of ['null', '[]', 'not-json', JSON.stringify({ type: 'authorized_user', project_id: 'ai-vertical-495712', client_email: 'fake', private_key: 'fake' }), JSON.stringify({ type: 'service_account', project_id: 'wrong-project', client_email: 'fake', private_key: 'fake' })]) {
      await assert.rejects(generateVertexJson(input, { repository, owner, requestId: 'credential-preflight', config: { CONTENT_VERTEX_FALLBACK: 'true', VERTEX_FALLBACK_PROJECT: 'ai-vertical-495712', VERTEX_FALLBACK_MODEL: 'gemini-3.8-flash', VERTEX_FALLBACK_APPROVED_UNTIL: new Date(Date.now() + 3600000).toISOString(), GOOGLE_SERVICE_ACCOUNT_JSON: credentials } }), error => error.code === 'BUDGET_BLOCKED' && error.preDispatch === true && error.configurationFailure === true && !error.message.includes('fake'))
      assert.equal(repository.budgetGet(owner, 'credential-preflight'), null)
    }
  } finally { repository.close() }
})
