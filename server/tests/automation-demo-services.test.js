import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createAutomationServices } from '../automation/services.js'
import { demoOwner, demoBudgetOwner, demoStageRequestId } from '../automation/demo.js'
import { contentHash } from '../studio/approval.js'
import { costScopeHash } from '../budget/policy.js'
import { settingsSchema } from '../studio/content.js'

for (const provider of ['vertex', 'openrouter']) for (const baseline of ['saved-draft', 'empty']) test(`${provider} scoped demo accepts ${baseline} baselines and preserves actual provider/model provenance`, async () => {
  const repository = createRepository(':memory:'); const owner = demoOwner
  const runId = 'a'.repeat(32); const packageId = createHash('sha256').update(`${runId}:package`).digest('hex').slice(0, 32)
  const excerpt = 'The publisher announced a limited developer preview. Availability remains restricted and independent deployment results have not been established.'
  const body = 'The publisher announced a limited developer preview [C1].'
  const content = { website: { title: 'Developer preview', body }, claims: [{ id: 'C1', text: 'The publisher announced a limited developer preview', evidenceId: 'E1', quote: excerpt, status: 'attributed' }], strategy: { angle: 'Limited preview', audience: 'Developers', whyNow: 'A preview', factCheck: 'Check scope', language: 'English', languageReason: 'Requested', voice: 'Female', voiceReason: 'Requested', delivery: 'Clear', keywords: ['AI'], platforms: [{ platform: 'X', headline: 'Developer preview [C1]', hook: 'A preview [C1]', body, cta: 'Read the source', hashtags: [], thumbnail: 'Original diagram', format: 'Post', retentionPlan: 'Clear scope', alternativeHook: 'Developer preview [C1]', testPlan: 'Observe clicks' }], experiments: [{ variable: 'Hook', variantA: 'A', variantB: 'B', metric: 'Clicks', decisionRule: 'Comparable views' }] } }
  let paidCalls = 0; let writes = 0
  const services = createAutomationServices(repository, { demoGenerate: () => async () => { paidCalls++; return { controlled: true } }, write: async (_evidence, settings, details, generate) => { writes++; assert.equal(details.previousContent, null); assert.deepEqual(settings.outputs, ['platforms', 'website']); await generate({ input: {}, schema: {} }); return content } })
  try {
    const profile = repository.studioPut(owner, 'account_profile', 'profile-a', { accountId: 'account-a', platform: 'X', enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: owner, consentedAt: new Date(Date.now() - 60000).toISOString(), paidBudgetMicros: 0 } }, 0)
    const oldContent = baseline === 'empty' ? null : { ...content, website: { title: 'Previous saved title', body } }
    const pack = repository.studioPut(owner, 'package', packageId, { settings: settingsSchema.parse({ outputs: ['website'] }), content: oldContent, evidence: [{ id: 'E1', hash: 'source-hash', url: 'https://example.com/update', excerpt, retrievedAt: new Date().toISOString() }], status: 'completed', createdBy: owner, jobId: 'original-unknown' }, 0)
    const old = repository.studioJobReserve(owner, 'original-unknown', 'a'.repeat(64), 20, { operation: 'generation', packageId })
    const running = repository.studioJobUpdate(owner, old.job.id, { status: 'running' }, old.job.revision, 'reserved')
    repository.studioJobUpdate(owner, old.job.id, { status: 'dispatch_unknown' }, running.revision, 'running')
    let run = repository.studioPut(owner, 'automation_run', runId, { packageId, accountId: profile.accountId, profileHash: costScopeHash(profile, null), demoAuthorizationId: 'controlled-demo', demoSourceContentHash: contentHash(pack), contentHash: contentHash(pack), status: 'generate_running', stage: 'generate' }, 0)
    const binding = { runId, accountId: profile.accountId, profileId: profile.id, profileHash: costScopeHash(profile, null), packageId, sourceContentHash: contentHash(pack) }
    const model = provider === 'openrouter' ? 'google/gemini-3.8-flash' : 'gemini-3.8-flash'
    repository.studioPut(owner, 'automation_demo', run.demoAuthorizationId, { version: 'five-account-paid-demo-v1', status: 'active', owner, actorUid: owner, currency: 'USD', totalLimitMicros: 5000000, projectId: provider === 'vertex' ? 'cs-project-bvfzp2zn' : 'ai-vertical-495712', ...(provider === 'openrouter' ? { provider, priceExpiresAt: new Date(Date.now() + 1800000).toISOString() } : {}), model, authorizedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), allowedStages: ['generate', 'review'], runs: [binding, ...['b', 'c', 'd', 'e'].map(key => ({ ...binding, runId: key.repeat(32), accountId: `account-${key}` }))] }, 0)
    repository.budgetConfigure('USD', demoBudgetOwner(owner, run.demoAuthorizationId), 5000000, 5000000)
    const context = { owner, actorUid: owner, profile, run, requestId: demoStageRequestId(run, 'generate') }
    const result = await services.generate(context)
    assert.equal(result.status, 'completed'); assert.equal(writes, 1); assert.equal(paidCalls, 1)
    assert.equal(result.package.content.website.title, 'Developer preview')
    assert.notEqual(result.jobId, old.job.id)
    assert.equal(repository.studioJobGet(owner, old.job.id).status, 'dispatch_unknown')
    assert.equal(repository.studioJobGet(owner, result.jobId).scope.generationProvider, `${provider}-demo`)
    assert.equal(repository.studioJobGet(owner, result.jobId).scope.model, model)
    assert.equal(repository.budgetGet(owner, result.jobId), null, 'paid writing has no misleading free-only monetary reservation')
    run = repository.studioPut(owner, 'automation_run', run.id, { ...run, contentHash: contentHash(result.package), status: 'review_running', stage: 'review' }, run.revision)
    const reviewed = await services.review({ ...context, run, requestId: demoStageRequestId(run, 'review') })
    assert.equal(reviewed.status, 'blocked', 'the controlled invalid evaluator payload never approves release')
    assert.equal(repository.studioGet(owner, 'package', packageId).automaticReview.model, model)
    repository.studioPut(owner, 'account_profile', profile.id, { ...profile, tone: 'Changed after authorization' }, profile.revision)
    await assert.rejects(services.review({ ...context, run, requestId: demoStageRequestId(run, 'review') }), error => error.preDispatch === true)
    assert.equal(paidCalls, 2)
  } finally { repository.close() }
})
