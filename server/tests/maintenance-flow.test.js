import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { automationRegistryOwner } from '../automation/runner.js'
import { runScheduledMaintenance, refreshPolicyReferences } from '../automation/maintenance.js'
import { buildCompletePackage } from '../studio/complete-package.js'
import { contentHash } from '../studio/approval.js'
import { policyReferenceOwner, policyReferences } from '../studio/package-rules.js'

test('daily maintenance refreshes five-platform receipts and policy provenance, preserving saved analysis but marking changed inputs stale', async () => {
  const repository = createRepository(':memory:'); const owner = 'alice'; const now = new Date('2026-11-12T12:00:00Z')
  const platforms = ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']; let reads = 0
  try {
    repository.studioPut(automationRegistryOwner, 'automation_owner', owner, { ownerScope: owner, enabled: true })
    const pack = repository.studioPut(owner, 'package', 'pack', { settings: { platform: platforms.join(',') }, content: { script: 'Saved text' }, evidence: [] })
    const accounts = platforms.map(platform => ({ platform, accountId: `account-${platform}`, ownerScope: owner }))
    repository.studioPut(owner, 'complete_context', pack.id, { context: { platformAccounts: accounts.map(({ platform, accountId }) => ({ platform, accountId })) } })
    for (const account of accounts) {
      repository.studioPut(owner, 'account_profile', account.accountId, { ...account, enabled: true, automationConsent: true })
      repository.studioPut(owner, 'social_publication', account.accountId, { ...account, packageId: pack.id, status: 'published', providerState: 'PUBLISHED', providerPostId: `post-${account.platform}`, releaseUrl: `https://example.com/${account.platform}`, contentHash: contentHash(pack) })
    }
    const provider = { postAnalytics: async () => { reads++; return [{ label: 'Views', data: [{ date: '2026-11-11', total: 42 }, { date: '2026-11-12', total: null }] }] }, create: () => assert.fail('No posts'), upload: () => assert.fail('No media') }
    const fetchReference = async source => ({ contentHash: createHash('sha256').update(source.url).digest('hex'), excerpt: 'Retrieved official reference', bytes: 500 })
    const outcome = await runScheduledMaintenance({ repository, now, provider, config: () => ({ enabled: true, accounts }), fetchReference })
    assert.equal(outcome.analytics.results.length, 5); assert.equal(reads, 5)
    assert.equal(outcome.policies.results.length, policyReferences.length)
    const complete = await buildCompletePackage(repository, owner, pack, now)
    assert.equal(complete.analytics.providerSnapshots.length, 5); assert.equal(complete.analytics.refreshes.length, 5)
    assert.ok(complete.rules.every(rule => rule.policyStatus === 'dated_reference' && rule.status === 'needs_review'))
    repository.studioPut(owner, 'complete_analysis', pack.id, { status: 'completed', inputHash: complete.inputHash, result: { decisions: [] } })
    assert.equal((await buildCompletePackage(repository, owner, pack, now)).analysis.stale, false)
    await refreshPolicyReferences({ repository, now: new Date(+now + 86400001), fetchReference: async source => ({ ...await fetchReference(source), contentHash: 'f'.repeat(64) }) })
    const changed = await buildCompletePackage(repository, owner, pack, new Date(+now + 86400001))
    assert.equal(changed.analysis.stale, true)
    assert.equal(repository.studioGet(owner, 'complete_analysis', pack.id).status, 'completed')
    assert.ok(repository.studioList(policyReferenceOwner, 'policy_reference').every(item => item.contentChanged))
  } finally { repository.close() }
})
