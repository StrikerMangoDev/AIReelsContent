import { createHash } from 'node:crypto'
import { demoOwner, demoBudgetOwner } from '../../automation/demo.js'
import { costScopeHash } from '../../budget/policy.js'
import { contentHash } from '../../studio/approval.js'
import { settingsSchema } from '../../studio/content.js'

const id = text => createHash('sha256').update(text).digest('hex').slice(0, 32)
export async function createDemoFixture(repository) {
  const owner = demoOwner; const demoId = 'controlled-five-account-demo'; const now = Date.now()
  const contexts = []; const runs = []
  for (let index = 0; index < 5; index++) {
    const profile = await repository.studioPut(owner, 'account_profile', `profile-${index}`, { accountId: `account-${index}`, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: owner, consentedAt: new Date(now - 1000).toISOString(), paidBudgetMicros: 0 } }, 0)
    const runId = id(`run-${index}`)
    const pack = await repository.studioPut(owner, 'package', createHash('sha256').update(`${runId}:package`).digest('hex').slice(0, 32), { content: null, settings: settingsSchema.parse({ outputs: ['website'] }), evidence: [{ id: 'E1', hash: 'source-hash', url: 'https://example.com/preview', retrievedAt: new Date(now).toISOString(), excerpt: 'The publisher announced a limited developer preview. Availability remains restricted and independent results have not been established.' }] }, 0)
    const binding = { runId, accountId: profile.accountId, profileId: profile.id, profileHash: costScopeHash(profile, null), packageId: pack.id, sourceContentHash: contentHash(pack) }
    const run = await repository.studioPut(owner, 'automation_run', runId, { accountId: profile.accountId, profileHash: binding.profileHash, packageId: pack.id, contentHash: binding.sourceContentHash, demoAuthorizationId: demoId, demoSourceContentHash: binding.sourceContentHash, stage: 'generate', status: 'generate_running' }, 0)
    runs.push(binding); contexts.push({ repository, owner, actorUid: owner, run, profile, phase: 'generate' })
  }
  const authorization = await repository.studioPut(owner, 'automation_demo', demoId, { version: 'five-account-paid-demo-v1', status: 'active', owner, actorUid: owner, currency: 'USD', totalLimitMicros: 5000000, projectId: 'cs-project-bvfzp2zn', model: 'gemini-3.8-flash', authorizedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), allowedStages: ['generate', 'review'], runs }, 0)
  repository.budgetConfigure('USD', demoBudgetOwner(owner, demoId), 5000000, 5000000)
  return { owner, demoId, authorization, contexts }
}
