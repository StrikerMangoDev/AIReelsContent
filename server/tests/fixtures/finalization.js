import { contentHash } from '../../studio/approval.js'
import { assessQuality, finalizationPolicy } from '../../studio/finalization.js'

export const ratingsFixture = (score = 8) => Object.fromEntries(finalizationPolicy.dimensions.map(key => [key, { score, note: `Fixture review of ${key} against the saved source and content.`, evidenceIds: ['E1'] }]))
export function reviewFixture(value, reviewerId = 'bob') {
  const now = Date.now()
  return { status: 'passed', reviewerId, contentHash: contentHash(value), claims: (value.content?.claims || []).map(claim => ({ id: claim.id, supported: true, note: 'The saved publisher passage supports this claim in context.' })), rightsConfirmed: true, promiseAligned: true, freshnessConfirmed: true, contradictionsResolved: true, accessibilityConfirmed: true, scopeConfirmed: true, quality: assessQuality(ratingsFixture(), value.evidence), reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() }
}
