import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { assertDemoAuthorization, createDemoGenerator, demoBudgetOwner, demoOwner } from '../automation/demo.js'
import { contentHash } from '../studio/approval.js'
import { costScopeHash } from '../budget/policy.js'

async function fixture() {
  const repository = createRepository(':memory:'); const demoId = 'independent-qa'; const contexts = []; const bindings = []
  for (let index = 0; index < 5; index++) {
    const id = String(index + 1).repeat(32); const packageId = String(index + 5).repeat(32)
    const profile = await repository.studioPut(demoOwner, 'account_profile', `profile-${index}`, { accountId: `account-${index}`, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: demoOwner, consentedAt: new Date(Date.now() - 60000).toISOString(), paidBudgetMicros: 0 } }, 0)
    const pack = await repository.studioPut(demoOwner, 'package', packageId, { content: { website: { title: 'QA fixture', body: 'No provider call' }, claims: [] }, evidence: [], settings: {} }, 0)
    const sourceContentHash = contentHash(pack); const profileHash = costScopeHash(profile, null)
    const run = await repository.studioPut(demoOwner, 'automation_run', id, { demoAuthorizationId: demoId, demoSourceContentHash: sourceContentHash, packageId, accountId: profile.accountId, profileHash, status: 'generate_running', stage: 'generate' }, 0)
    bindings.push({ runId: id, accountId: profile.accountId, profileId: profile.id, profileHash, packageId, sourceContentHash })
    contexts.push({ repository, owner: demoOwner, actorUid: demoOwner, run, profile, phase: 'generate' })
  }
  const now = Date.now()
  await repository.studioPut(demoOwner, 'automation_demo', demoId, { version: 'five-account-paid-demo-v1', status: 'active', owner: demoOwner, actorUid: demoOwner, currency: 'USD', totalLimitMicros: 5000000, projectId: 'ai-vertical-495712', model: 'gemini-3.8-flash', authorizedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), allowedStages: ['generate', 'review'], runs: bindings }, 0)
  const budgetOwner = demoBudgetOwner(demoOwner, demoId)
  repository.budgetConfigure('USD', budgetOwner, 5000000, 5000000)
  return { repository, contexts, budgetOwner, demoId }
}
const input = { system: 'Return JSON', input: { text: 'QA fixture' }, schema: { type: 'object' }, maxTokens: 10 }
const config = { GOOGLE_SERVICE_ACCOUNT_JSON: '{}' }

test('independent paid demo QA rejects owner, actor, phase, run, profile, expiry and revoked authorization changes', async () => {
  const { repository, contexts, demoId } = await fixture(); const context = contexts[0]
  try {
    assert.ok(await assertDemoAuthorization(context))
    for (const patch of [{ owner: 'other' }, { actorUid: 'other' }, { phase: 'publish' }, { run: { ...context.run, id: 'f'.repeat(32) } }, { profile: { ...context.profile, accountId: 'changed' } }]) await assert.rejects(() => assertDemoAuthorization({ ...context, ...patch }), error => error.code === 'BUDGET_BLOCKED' && error.preDispatch === true)
    let authorization = await repository.studioGet(demoOwner, 'automation_demo', demoId)
    authorization = await repository.studioPut(demoOwner, 'automation_demo', demoId, { ...authorization, expiresAt: new Date(Date.now() - 500).toISOString() }, authorization.revision)
    await assert.rejects(() => assertDemoAuthorization(context), /inactive or expired/)
    await repository.studioPut(demoOwner, 'automation_demo', demoId, { ...authorization, status: 'revoked', expiresAt: new Date(Date.now() + 3600000).toISOString() }, authorization.revision)
    await assert.rejects(() => assertDemoAuthorization(context), /inactive or expired/)
  } finally { repository.close() }
})

test('independent paid demo QA keeps unknown charges held across accounts and refuses duplicate or over-cap dispatch', async () => {
  const { repository, contexts, budgetOwner } = await fixture(); let dispatches = 0
  const request = async () => { dispatches++; throw new Error('Transport unknown') }
  try {
    const first = createDemoGenerator(contexts[0], { config, request })
    await assert.rejects(() => first(input), error => error.code === 'VERTEX_REQUEST_FAILED')
    await assert.rejects(() => first(input), error => error.code === 'BUDGET_BLOCKED')
    assert.equal(dispatches, 1)
    for (let index = 1; index < 3; index++) await assert.rejects(() => createDemoGenerator(contexts[index], { config, request })(input), error => error.code === 'VERTEX_REQUEST_FAILED')
    assert.equal(dispatches, 3)
    const expectedBound = Math.ceil(1048576 * 0.75 + 65536 * 2 * 3.75)
    assert.equal(repository.budgetSummary(budgetOwner).heldMicros, expectedBound * 3)
    await assert.rejects(() => createDemoGenerator(contexts[3], { config, request })(input), /budget exhausted/)
    await assert.rejects(() => createDemoGenerator(contexts[0], { config, request })(input), /already exists/)
    assert.equal(dispatches, 3); assert.ok(repository.budgetSummary(budgetOwner).heldMicros <= 5000000)
  } finally { repository.close() }
})

test('independent paid demo QA blocks the whole authorization after a confirmed provider permission rejection', async () => {
  const { repository, contexts, demoId } = await fixture(); let dispatches = 0
  const request = async () => { dispatches++; throw Object.assign(new Error('Permission denied'), { status: 403 }) }
  try {
    await assert.rejects(() => createDemoGenerator(contexts[0], { config, request })(input), error => error.status === 403)
    assert.equal((await repository.studioGet(demoOwner, 'automation_demo', demoId)).status, 'blocked')
    await assert.rejects(() => createDemoGenerator(contexts[1], { config, request })(input), /inactive or expired/)
    assert.equal(dispatches, 1)
  } finally { repository.close() }
})

test('independent paid demo QA rechecks authorization between reservation and provider dispatch', async () => {
  const { repository, contexts, demoId, budgetOwner } = await fixture(); let dispatches = 0
  try {
    const generator = createDemoGenerator(contexts[0], { config, request: async () => { dispatches++; return {} }, beforeAttempt: async () => {
      const authorization = await repository.studioGet(demoOwner, 'automation_demo', demoId)
      await repository.studioPut(demoOwner, 'automation_demo', demoId, { ...authorization, status: 'revoked' }, authorization.revision)
      await assertDemoAuthorization(contexts[0])
    } })
    await assert.rejects(() => generator(input), /inactive or expired/)
    assert.equal(dispatches, 0); assert.equal(repository.budgetSummary(budgetOwner).heldMicros, 0)
  } finally { repository.close() }
})

test('independent paid demo QA concurrent accounts cannot reserve more than the shared lifetime cap', async () => {
  const { repository, contexts, budgetOwner } = await fixture(); let dispatches = 0
  try {
    const request = async () => { dispatches++; throw new Error('Transport unknown') }
    const results = await Promise.allSettled(contexts.map(context => createDemoGenerator(context, { config, request })(input)))
    assert.ok(results.every(result => result.status === 'rejected'))
    assert.equal(dispatches, 3)
    assert.equal(repository.budgetSummary(budgetOwner).heldMicros, Math.ceil(1048576 * 0.75 + 65536 * 2 * 3.75) * 3)
  } finally { repository.close() }
})
