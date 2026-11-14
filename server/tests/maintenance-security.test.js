import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { contentHash } from '../studio/approval.js'
import { automationRegistryOwner } from '../automation/runner.js'
import { policyReferences, policyReferenceOwner, getPackageRules } from '../studio/package-rules.js'
import { refreshRegisteredMetrics, refreshPolicyReferences, fetchPolicyReference } from '../automation/maintenance.js'
import { buildCompletePackage, completeInputHash, decisionParameters } from '../studio/complete-package.js'

const now = new Date('2026-11-12T12:00:00.000Z')
function fixture() {
  const repository = createRepository(':memory:'); const owner = 'alice'
  repository.studioPut(automationRegistryOwner, 'automation_owner', owner, { ownerScope: owner, enabled: true }, 0)
  const profile = repository.studioPut(owner, 'account_profile', 'profile', { enabled: true, automationConsent: true, accountId: 'own-account', platform: 'X' }, 0)
  const pack = repository.studioPut(owner, 'package', 'own-pack', { content: { script: 'Saved text.' }, settings: { platform: 'X' }, evidence: [] }, 0)
  const publication = repository.studioPut(owner, 'social_publication', 'own-receipt', { packageId: pack.id, accountId: profile.accountId, platform: 'X', providerPostId: 'native-post', status: 'published', providerState: 'PUBLISHED', releaseUrl: 'https://example.com/post', contentHash: contentHash(pack) }, 0)
  const config = () => ({ enabled: true, accounts: [{ ownerScope: owner, accountId: profile.accountId, platform: 'X' }] })
  return { repository, owner, profile, pack, publication, config }
}
const series = [{ label: 'Views', data: [{ date: '2026-11-11', total: null }] }]

test('scheduled analytics requires current consent and provider mapping, serializes runs and never publishes', async () => {
  const value = fixture(); let reads = 0; let release; let started
  const startedPromise = new Promise(resolve => { started = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const provider = { async postAnalytics(postId, days) { reads++; assert.equal(postId, 'native-post'); assert.equal(days, 7); started(); await blocked; return series }, create() { assert.fail('maintenance must never publish') }, upload() { assert.fail('maintenance must never generate or upload media') } }
  try {
    const running = refreshRegisteredMetrics({ ...value, now, provider })
    await startedPromise
    assert.equal((await refreshRegisteredMetrics({ ...value, now, provider })).status, 'busy')
    release(); assert.equal((await running).status, 'completed'); assert.equal(reads, 1)
    assert.equal((await refreshRegisteredMetrics({ ...value, now, provider })).results.length, 0, '24-hour scheduling prevents repeated reads')
    const snapshot = value.repository.studioList(value.owner, 'complete_provider_metrics')[0]
    assert.equal(snapshot.normalization, 'raw_series_only'); assert.equal(snapshot.series[0].data[0].total, null)
    value.repository.studioPut(value.owner, 'account_profile', value.profile.id, { ...value.profile, automationConsent: false }, value.profile.revision)
    assert.equal((await refreshRegisteredMetrics({ ...value, now: new Date(+now + 86400001), provider })).results.length, 0)
    assert.equal(reads, 1)
  } finally { value.repository.close() }
})

test('scheduled analytics discards a result if account consent or receipt changes during the provider read', async () => {
  for (const change of ['consent', 'receipt']) {
    const value = fixture()
    try {
      const provider = { async postAnalytics() {
        if (change === 'consent') value.repository.studioPut(value.owner, 'account_profile', value.profile.id, { ...value.profile, automationConsent: false }, value.profile.revision)
        else value.repository.studioPut(value.owner, 'social_publication', value.publication.id, { ...value.publication, providerPostId: 'changed-native-post' }, value.publication.revision)
        return series
      } }
      const result = await refreshRegisteredMetrics({ ...value, now, provider })
      assert.equal(result.results[0].status, 'unavailable')
      assert.equal(value.repository.studioList(value.owner, 'complete_provider_metrics').length, 0)
      const retry = value.repository.studioList(value.owner, 'complete_metrics_refresh')[0]
      assert.equal(retry.failures, 1); assert.equal(retry.nextAttemptAt, new Date(+now + 86400000).toISOString())
    } finally { value.repository.close() }
  }
})

test('scheduled reference retrieval remains unreviewed and failures back off without inventing policy approval', async () => {
  const repository = createRepository(':memory:'); let reads = 0
  try {
    const fetchReference = async reference => { reads++; assert.ok(policyReferences.some(value => value.id === reference.id && value.url === reference.url)); return { contentHash: 'a'.repeat(64), excerpt: 'Official reference capture', bytes: 1000 } }
    await refreshPolicyReferences({ repository, now, fetchReference })
    assert.equal(reads, policyReferences.length)
    const snapshots = repository.studioList(policyReferenceOwner, 'policy_reference')
    assert.ok(snapshots.every(value => value.retrievalStatus === 'retrieved_unreviewed'))
    assert.equal(getPackageRules({ platform: 'X', now, policySnapshots: snapshots }).policyStatus, 'dated_reference', 'A first capture preserves the dated guidance deadline; automated text is still unreviewed')
    await refreshPolicyReferences({ repository, now, fetchReference }); assert.equal(reads, policyReferences.length)
    await refreshPolicyReferences({ repository, now: new Date(+now + 86400001), fetchReference: async () => { throw new Error('private provider diagnostics') } })
    const failed = repository.studioList(policyReferenceOwner, 'policy_reference')
    assert.ok(failed.every(value => value.retrievalStatus === 'unavailable' && value.contentHash === 'a'.repeat(64) && value.failures === 1))
    assert.equal(JSON.stringify(failed).includes('private provider diagnostics'), false)
  } finally { repository.close() }
})

test('policy fetch rejects caller-supplied URLs before network access', async () => {
  for (const url of ['https://127.0.0.1/private', 'http://help.x.com/policy', 'https://attacker.example/policy']) {
    await assert.rejects(fetchPolicyReference({ id: policyReferences[0].id, url }), /Unapproved policy reference/)
  }
})

test('first or unchanged policy capture permits current production analysis but known changes block prompts even after analysis refresh', async () => {
  const repository = createRepository(':memory:'); const owner = 'policy-flow-owner'
  const pack = repository.studioPut(owner, 'package', 'policy-flow', { title: 'A preview', settings: { platform: 'X', language: 'English', duration: 30 }, evidence: [{ id: 'E1', title: 'Source', url: 'https://example.com/preview', excerpt: 'A preview was announced.' }], content: { script: 'A preview was announced [C1].', claims: [{ id: 'C1', text: 'A preview was announced.', evidenceId: 'E1' }], strategy: { language: 'English', platforms: [{ platform: 'X', headline: 'A preview', body: 'A preview was announced [C1].', format: 'image' }] } } }, 0)
  const context = { objective: 'Explain the announcement.', brand: 'Approved editorial identity.', rightsNote: 'Use original artwork.', productionTools: { graphics: 'Approved graphics tool', editor: 'Approved editor' } }
  repository.studioPut(owner, 'complete_context', pack.id, { context }, 0)
  const values = { format: 'image', language: 'English', tone: 'Clear', duration: '30 seconds', aspectRatio: '1:1', visualStyle: 'Original illustration', audioApproach: 'Silent', coverApproach: 'Readable title', cta: 'Read source', postingSlot: 'Unavailable', successMetric: 'Link clicks', testVariable: 'Opening wording' }
  const result = { summary: 'Production hypotheses only.', decisions: decisionParameters.map(parameter => ({ id: `x-${parameter}`, platform: 'X', parameter, value: values[parameter], method: 'hypothesis', evidenceIds: [], metricIds: [], rationale: 'A hypothesis, not established performance.', alternatives: [], confidence: 'low', missing: [] })) }
  const saveAnalysis = time => repository.studioPut(owner, 'complete_analysis', pack.id, { status: 'completed', result, inputHash: completeInputHash(pack, context, [], time, [], repository.studioList(policyReferenceOwner, 'policy_reference')) })
  try {
    const fetchReference = async () => ({ contentHash: 'a'.repeat(64), excerpt: 'Official capture', bytes: 1000 })
    await refreshPolicyReferences({ repository, now, fetchReference }); saveAnalysis(now)
    let complete = await buildCompletePackage(repository, owner, pack, now)
    assert.equal(complete.analysis.status, 'completed')
    assert.equal(complete.prompts.find(prompt => prompt.kind === 'main-image').status, 'ready')
    const nextDay = new Date(+now + 86400001)
    await refreshPolicyReferences({ repository, now: nextDay, fetchReference })
    complete = await buildCompletePackage(repository, owner, pack, nextDay)
    assert.equal(complete.analysis.status, 'completed', 'Unchanged capture timestamps cannot churn otherwise-current decisions')
    assert.equal(complete.prompts.find(prompt => prompt.kind === 'main-image').status, 'ready')
    const changedDay = new Date(+now + 172800002)
    await refreshPolicyReferences({ repository, now: changedDay, fetchReference: async () => ({ contentHash: 'b'.repeat(64), excerpt: 'Changed official capture', bytes: 1000 }) })
    complete = await buildCompletePackage(repository, owner, pack, changedDay)
    assert.equal(complete.analysis.status, 'stale')
    saveAnalysis(changedDay)
    complete = await buildCompletePackage(repository, owner, pack, changedDay)
    assert.equal(complete.analysis.status, 'completed')
    assert.equal(complete.rules[0].policyStatus, 'review_due')
    assert.notEqual(complete.prompts.find(prompt => prompt.kind === 'main-image').status, 'ready', 'Fresh AI choices cannot bypass a known policy change requiring review')
  } finally { repository.close() }
})
