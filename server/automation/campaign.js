import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { workspaceRole } from '../studio/workspaces.js'
import { publicAddress } from '../studio/evidence.js'
import { costScopeHash } from '../budget/policy.js'
import { publishingConfig } from '../publishing/provider.js'

export const freeCampaignVersion = 'free-one-off-campaign-v1'
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/)
const text = max => z.string().trim().min(1).max(max)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const publicUrl = z.string().url().max(2000).refine(value => {
  const url = new URL(value); const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return url.protocol === 'https:' && !url.username && !url.password && !['localhost', 'local', 'internal'].some(part => host === part || host.endsWith(`.${part}`)) && (!isIP(host) || publicAddress(host))
}, 'Use a public HTTPS reference without credentials; retrieval still validates DNS and source evidence')
export const freeCampaignSchema = z.object({
  id, version: z.literal(freeCampaignVersion), status: z.enum(['active', 'revoked', 'completed']), actorUid: text(128),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), referenceUrl: publicUrl, topic: text(300),
  accountIds: z.array(text(200)).min(1).max(5), profileBindings: z.array(z.object({ profileId: id, accountId: text(200), profileHash: hash }).strict()).min(1).max(5),
  freeOnly: z.literal(true), paidBudgetMicros: z.literal(0), maxRuns: z.literal(5),
  completedAt: z.string().datetime().optional(), completion: z.enum(['all_published', 'finished_with_blocks']).optional(),
  supersedesCampaignId: id.optional(),
}).strict().superRefine((value, ctx) => {
  const issue = message => ctx.addIssue({ code: 'custom', message })
  const duration = Date.parse(value.expiresAt) - Date.parse(value.createdAt)
  if (duration <= 0 || duration > 24 * 3600000) issue('Campaign expiry must be within 24 hours of creation')
  if (new Set(value.accountIds).size !== value.accountIds.length || new Set(value.profileBindings.map(item => item.accountId)).size !== value.profileBindings.length || new Set(value.profileBindings.map(item => item.profileId)).size !== value.profileBindings.length) issue('Campaign accounts and profile bindings must be unique')
  if (value.accountIds.length !== value.profileBindings.length || value.profileBindings.some(item => !value.accountIds.includes(item.accountId))) issue('Bind every campaign account to exactly one current profile')
  if (value.supersedesCampaignId === value.id) issue('A campaign cannot supersede itself')
})
const blocked = message => Object.assign(new Error(message), { code: 'CAMPAIGN_BLOCKED', preDispatch: true })
const parse = record => freeCampaignSchema.safeParse(Object.fromEntries(Object.keys(freeCampaignSchema.shape).map(key => [key, record?.[key]])))
export const freeCampaignRunId = (owner, campaignId, accountId) => createHash('sha256').update(`free-campaign:${owner}:${campaignId}:${accountId}`).digest('hex').slice(0, 32)
export const freeCampaignHash = campaign => costScopeHash(campaign, null)

async function validateSupersession(repository, owner, campaign) {
  if (!campaign.supersedesCampaignId) return
  const previous = parse(await repository.studioGet(owner, 'automation_campaign', campaign.supersedesCampaignId))
  if (!previous.success) throw blocked('The superseded campaign is unavailable or invalid.')
  const old = previous.data
  if (old.supersedesCampaignId || old.status !== 'completed' || old.completion !== 'finished_with_blocks' || !old.completedAt || Date.parse(old.completedAt) > Date.parse(campaign.createdAt) || old.actorUid !== campaign.actorUid || JSON.stringify([...old.accountIds].sort()) !== JSON.stringify([...campaign.accountIds].sort())) throw blocked('Only one completed no-publication failure may be explicitly superseded within the same account scope.')
  const runs = (await repository.studioList(owner, 'automation_run')).filter(run => run.campaignId === old.id)
  const originalHash = freeCampaignHash({ ...old, status: 'active', completedAt: undefined, completion: undefined })
  if (runs.length !== old.accountIds.length || runs.some(run => !old.accountIds.includes(run.accountId) || run.id !== freeCampaignRunId(owner, old.id, run.accountId) || !['blocked', 'failed'].includes(run.status) || run.actorUid !== old.actorUid || run.campaignHash !== originalHash || run.campaignReferenceUrl !== old.referenceUrl || run.campaignTopic !== old.topic || run.profileHash !== old.profileBindings.find(item => item.accountId === run.accountId)?.profileHash || run.paidBudgetMicros !== 0 || run.demoAuthorizationId || run.publicationId || run.providerPostId)) throw blocked('Prior campaign runs do not prove a completed free-only failure without publication.')
  const packageIds = new Set(runs.flatMap(run => [run.packageId, createHash('sha256').update(`${run.id}:package`).digest('hex').slice(0, 32)]).filter(Boolean))
  const requestIds = new Set(runs.flatMap(run => (run.stages || []).map(stage => stage.requestId)))
  const publications = await repository.studioList(owner, 'social_publication')
  if (publications.some(receipt => packageIds.has(receipt.packageId) || requestIds.has(receipt.requestId))) throw blocked('A prior campaign publication receipt exists; no replacement campaign was admitted.')
}

async function validateCurrentCampaign(repository, owner, campaign, now, accounts) {
  if (campaign.status !== 'active' || Date.parse(campaign.createdAt) > now.getTime() || Date.parse(campaign.expiresAt) <= now.getTime()) throw blocked('The one-off campaign is inactive, future-dated or expired.')
  if (await workspaceRole(repository, owner, campaign.actorUid) !== 'owner') throw blocked('The campaign actor no longer owns this workspace.')
  await validateSupersession(repository, owner, campaign)
  for (const binding of campaign.profileBindings) {
    const profile = await repository.studioGet(owner, 'account_profile', binding.profileId)
    if (!profile || profile.accountId !== binding.accountId || costScopeHash(profile, null) !== binding.profileHash || !profile.enabled || !profile.automationConsent || profile.automaticPolicy?.consentedBy !== campaign.actorUid || profile.automaticPolicy?.version !== 'account-automation-v1' || profile.automaticPolicy?.scope !== 'research-generation-and-social-publishing' || profile.automaticPolicy?.paidBudgetMicros !== 0) throw blocked('A campaign account profile or owner consent changed.')
    if (!accounts.some(account => account.ownerScope === owner && account.accountId === binding.accountId && account.platform === profile.platform)) throw blocked('A campaign destination is no longer configured for this workspace.')
  }
  const runs = (await repository.studioList(owner, 'automation_run')).filter(run => run.campaignId === campaign.id)
  if (runs.length > campaign.maxRuns || runs.some(run => !campaign.accountIds.includes(run.accountId) || run.id !== freeCampaignRunId(owner, campaign.id, run.accountId))) throw blocked('Campaign run bindings exceed the authorized one-run-per-account scope.')
}

export async function currentFreeCampaign({ repository, owner, profile, now = new Date(), accounts = publishingConfig().accounts }) {
  const records = await repository.studioList(owner, 'automation_campaign')
  // Keep current-day revoked/expired records visible so a failed campaign never falls through to an ordinary post.
  let candidates = records.filter(record => Array.isArray(record.accountIds) && record.accountIds.includes(profile.accountId) && (record.status === 'active' || !Number.isFinite(Date.parse(record.createdAt)) || Math.abs(now.getTime() - Date.parse(record.createdAt)) < 24 * 3600000))
  if (!candidates.length) return null
  const successors = candidates.filter(record => record.status === 'active' && record.supersedesCampaignId)
  if (successors.length === 1) {
    const parsed = parse(successors[0])
    if (!parsed.success) return { held: true, reason: 'The replacement campaign has invalid inputs.' }
    try { await validateCurrentCampaign(repository, owner, parsed.data, now, accounts) }
    catch { return { held: true, reason: 'The replacement campaign lacks verified no-publication failure evidence.' } }
    candidates = candidates.filter(record => record.id !== parsed.data.supersedesCampaignId)
  }
  if (candidates.length !== 1) return { held: true, reason: 'Conflicting one-off campaigns require resolution; no ordinary fallback was started.' }
  const parsed = parse(candidates[0])
  if (!parsed.success) return { held: true, reason: 'The one-off campaign has invalid or unbounded inputs.' }
  try {
    const campaign = parsed.data
    await validateCurrentCampaign(repository, owner, campaign, now, accounts)
    const binding = campaign.profileBindings.find(item => item.accountId === profile.accountId)
    if (!binding || binding.profileId !== profile.id || binding.profileHash !== costScopeHash(profile, null)) throw blocked('This account does not match the frozen campaign profile.')
    return { campaign, runId: freeCampaignRunId(owner, campaign.id, profile.accountId), campaignHash: freeCampaignHash(campaign), slot: { kind: 'campaign', index: 0 } }
  } catch (error) { return { held: true, reason: error.code === 'CAMPAIGN_BLOCKED' ? error.message : 'The current campaign authorization could not be verified.' } }
}

export async function assertFreeCampaign({ repository, owner, profile, run, actorUid }, { now = new Date(), accounts = publishingConfig().accounts } = {}) {
  if (!run?.campaignId) return null
  const record = await repository.studioGet(owner, 'automation_campaign', run.campaignId)
  const parsed = parse(record)
  if (!parsed.success) throw blocked('The saved campaign is unavailable or invalid.')
  const campaign = parsed.data
  await validateCurrentCampaign(repository, owner, campaign, now, accounts)
  const binding = campaign.profileBindings.find(item => item.accountId === profile.accountId)
  if (actorUid !== campaign.actorUid || !binding || binding.profileId !== profile.id || binding.profileHash !== costScopeHash(profile, null) || run.id !== freeCampaignRunId(owner, campaign.id, profile.accountId) || run.campaignHash !== freeCampaignHash(campaign) || run.campaignReferenceUrl !== campaign.referenceUrl || run.campaignTopic !== campaign.topic || run.paidBudgetMicros !== 0 || run.demoAuthorizationId) throw blocked('The campaign operation no longer matches its frozen free-only authorization.')
  return campaign
}

export async function finishFreeCampaign(repository, owner, campaignId, now = new Date()) {
  if (!campaignId) return
  const record = await repository.studioGet(owner, 'automation_campaign', campaignId)
  const parsed = parse(record)
  if (!parsed.success || parsed.data.status !== 'active') return
  const runs = await repository.studioList(owner, 'automation_run')
  const bound = parsed.data.accountIds.map(accountId => runs.find(run => run.id === freeCampaignRunId(owner, campaignId, accountId) && run.campaignId === campaignId))
  if (bound.some(run => !run || !['completed', 'blocked', 'failed'].includes(run.status))) return
  try {
    await repository.studioPut(owner, 'automation_campaign', campaignId, { ...record, status: 'completed', completedAt: now.toISOString(), completion: bound.every(run => run.status === 'completed' && /^https:\/\//.test(run.releaseUrl || '')) ? 'all_published' : 'finished_with_blocks' }, record.revision)
  } catch (error) { if (error.code !== 'STUDIO_CONFLICT') throw error }
}
