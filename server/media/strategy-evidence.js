import { createHash } from 'node:crypto'
import { contentHash } from '../studio/approval.js'
import { costScopeHash } from '../budget/policy.js'
import { mediaManifest } from './acceptance.js'

export const automaticStrategyMediaVersion = 'automatic-strategy-media-v1'
export const automaticStrategyChecks = ['editorialReview', 'originalLayout', 'boundedLayout', 'soundOffText', 'originalAssetRights', 'sourceCaptureCurrent', 'lowRiskScope']
export const automaticStrategyMediaId = (packageId, platform, accountId) => createHash('sha256').update(`${packageId}:${platform}:${accountId}`).digest('hex').slice(0, 32)
export const automaticAssetEvidenceHash = assets => costScopeHash(assets.map(({ id, technicalReport, provenance, captions }) => ({ id, technicalReport, provenance, captions })), null)

// Only server-owned records are supplied here; clients cannot submit machine evidence in context.
export function currentAutomaticStrategyMedia(record, pack, profile, assets, { now = Date.now() } = {}) {
  if (!record || record.version !== automaticStrategyMediaVersion || record.method !== 'server-machine-assessment' || !record.eligible || record.packageId !== pack.id || record.platform !== profile?.platform || record.accountId !== profile?.accountId || record.contentHash !== contentHash(pack) || record.profileHash !== costScopeHash(profile, null) || record.editorialReviewId !== pack.automaticReview?.runId || record.editorialReviewHash !== costScopeHash(pack.automaticReview, null) || !automaticStrategyChecks.every(key => record.checks?.[key] === true) || record.issues?.length) return null
  const checkedAt = Date.parse(record.checkedAt); const expiresAt = Date.parse(record.expiresAt)
  const review = pack.automaticReview
  if (!(checkedAt <= now && expiresAt > now && expiresAt <= checkedAt + 86400000) || profile?.enabled !== true || profile?.automationConsent !== true || review?.status !== 'passed' || review.method !== 'automated-model-review' || Date.parse(review.reviewedAt) > now || Date.parse(review.expiresAt) <= now || review.contentHash !== contentHash(pack) || review.profileHash !== costScopeHash(profile, null)) return null
  const usedSources = (pack.evidence || []).filter(source => pack.content?.claims?.some(claim => claim.evidenceId === source.id))
  if (!usedSources.length || usedSources.some(source => !(Date.parse(source.retrievedAt) <= now && now - Date.parse(source.retrievedAt) <= 86400000))) return null
  let manifest
  try { manifest = mediaManifest(pack, assets) } catch { return null }
  if (manifest.hash !== record.manifestHash || costScopeHash(manifest.assets, null) !== costScopeHash(record.assets, null) || record.assetEvidenceHash !== automaticAssetEvidenceHash(assets)) return null
  return record
}
