import { createHash } from 'node:crypto'
import { assessQuality, finalizationPolicy } from './finalization.js'

export const contentHash = value => createHash('sha256').update(JSON.stringify({ content: value.content, settings: value.settings, evidence: value.evidence, researchContext: value.researchContext, brandVersion: value.brandVersion }, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex')
export const contributors = value => [...new Set([...(value.contributorUids || []), value.createdBy, value.generatedBy, value.lastEditedBy].filter(Boolean))]

export function independentlyReviewed(value, now = Date.now()) {
  const review = value.independentReview
  const reviewedAt = Date.parse(review?.reviewedAt || '')
  const expiresAt = Date.parse(review?.expiresAt || '')
  const claimIds = (value.content?.claims || []).map(claim => claim.id)
  const proofs = review?.claims
  return review?.status === 'passed' && review.freshnessConfirmed === true && review.contradictionsResolved === true && review.rightsConfirmed === true && review.promiseAligned === true && review.accessibilityConfirmed === true && review.scopeConfirmed === true
    && claimIds.length > 0 && new Set(claimIds).size === claimIds.length && Array.isArray(proofs) && proofs.length === claimIds.length
    && new Set(proofs.map(proof => proof.id)).size === proofs.length && proofs.every(proof => claimIds.includes(proof.id) && proof.supported === true && typeof proof.note === 'string' && proof.note.trim().length >= 10)
    && review.quality?.policyVersion === finalizationPolicy.version && assessQuality(review.quality.ratings, value.evidence)?.eligible === true
    && typeof review.reviewerId === 'string' && Boolean(review.reviewerId) && !contributors(value).includes(review.reviewerId)
    && reviewedAt <= now && expiresAt > now && expiresAt <= reviewedAt + 86400000
    && review.contentHash === contentHash(value) && review.reviewerId === value.reviewerId
}

export function approvedVersion(value) {
  const approval = value.approval
  return value.editorialStatus === 'approved' && independentlyReviewed(value) && approval?.method === 'independent-human'
    && typeof approval.approvedBy === 'string' && Boolean(approval.approvedBy) && approval.approvedBy !== value.reviewerId
    && Date.parse(approval.approvedAt || '') <= Date.now() && approval?.contentHash === contentHash(value)
}
