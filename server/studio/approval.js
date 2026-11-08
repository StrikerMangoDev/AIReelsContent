import { createHash } from 'node:crypto'

export const contentHash = value => createHash('sha256').update(JSON.stringify({ content: value.content, settings: value.settings, evidence: value.evidence })).digest('hex')
export const contributors = value => [...new Set([...(value.contributorUids || []), value.createdBy, value.generatedBy, value.lastEditedBy].filter(Boolean))]

export function independentlyReviewed(value, now = Date.now()) {
  const review = value.independentReview
  const reviewedAt = Date.parse(review?.reviewedAt || '')
  const expiresAt = Date.parse(review?.expiresAt || '')
  return review?.status === 'passed' && review.freshnessConfirmed === true && review.contradictionsResolved === true
    && reviewedAt <= now && expiresAt > now && expiresAt <= reviewedAt + 86400000
    && review.contentHash === contentHash(value) && review.reviewerId === value.reviewerId
}

export function approvedVersion(value) {
  const approval = value.approval
  const creatorConfirmed = approval?.method === 'creator-confirmed' && typeof approval.approvedBy === 'string' && Boolean(approval.approvedBy) && Date.parse(approval.approvedAt || '') <= Date.now()
  return value.editorialStatus === 'approved' && Boolean(creatorConfirmed || independentlyReviewed(value)) && approval?.contentHash === contentHash(value)
}
