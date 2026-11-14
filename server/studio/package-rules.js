import { z } from 'zod'
import { metricPlatforms } from './package-analytics.js'

export const packageRulesVersion = 'content-package-rules-v1'
const checkedAt = '2026-11-11T00:00:00.000Z'
const reviewDue = '2026-12-11T00:00:00.000Z'
const source = (id, title, url, available = true) => ({ id, title, url, retrievalStatus: available ? 'reviewed_reference' : 'unavailable', checkedAt: available ? checkedAt : null, attemptedAt: checkedAt, reviewDue, limitation: available ? 'A dated reference, not verification of this account or a complete legal compliance assessment.' : 'The official page could not be retrieved during review; current requirements need verification.' })
const sources = {
  X: [source('x-automation', 'X automation rules', 'https://help.x.com/en/rules-and-policies/x-automation?lang=browser'), source('x-authenticity', 'X authenticity and misleading media', 'https://help.x.com/en/rules-and-policies/authenticity'), source('x-media', 'X media upload and processing', 'https://docs.x.com/x-api/media/quickstart/media-upload-chunked')],
  Instagram: [source('instagram-publishing', 'Instagram content publishing API', 'https://developers.facebook.com/docs/instagram-platform/content-publishing/', false)],
  YouTube: [source('youtube-video', 'YouTube video audience and synthetic-media settings', 'https://developers.google.com/youtube/data/reference/rest/v3/videos'), source('youtube-upload', 'YouTube video upload API', 'https://developers.google.com/youtube/data/reference/rest/v3/videos/insert')],
  Facebook: [source('facebook-reels', 'Facebook Reels publishing API', 'https://developers.facebook.com/docs/video-api/guides/reels-publishing/', false)],
  LinkedIn: [source('linkedin-posts', 'LinkedIn post types and permissions', 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-07'), source('linkedin-schema', 'LinkedIn document, carousel and media schema', 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema?view=li-lms-2026-06')],
}
export const policyReferenceOwner = '__package_policy_references__'
export const policyReferences = Object.entries(sources).flatMap(([platform, values]) => values.map(value => ({ ...value, platform })))
const nativeFormats = { X: ['post', 'image', 'video', 'thread'], Instagram: ['post', 'image', 'video', 'reel', 'carousel'], YouTube: ['short', 'video'], Facebook: ['post', 'image', 'video', 'reel'], LinkedIn: ['post', 'image', 'video', 'document', 'article'] }

export function normalizePackageFormat(platform, format) {
  let label = String(format || '').normalize('NFKC').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ')
  if (nativeFormats[platform]?.includes(label)) return label
  const prefix = platform === 'X' ? /^(?:x|twitter)\s*[:·-]?\s+/ : new RegExp(`^${platform.toLowerCase()}\\s*[:·-]?\\s+`)
  label = label.replace(prefix, '')
  const formats = [
    [/^reels?\b/, 'reel'], [/^shorts?\b(?!-form)/, 'short'],
    [/^short-form\s+(?:vertical\s+)?video\b/, platform === 'YouTube' ? 'short' : 'video'],
    [/^(?:(?:long-form|vertical|horizontal)\s+)?video\b/, 'video'],
    [/^(?:(?:text-only|text|single|social)\s+)?post\b/, 'post'],
    [/^(?:text-only\s+)?thread\b/, 'thread'],
    [/^(?:(?:single|static)\s+)?(?:image|photo)\b/, 'image'],
    [/^carousel\b/, 'carousel'], [/^(?:document|pdf)\b/, 'document'], [/^article\b/, 'article'],
  ]
  return formats.find(([pattern, value]) => pattern.test(label) && nativeFormats[platform]?.includes(value))?.[1] || null
}

export const packageAttestationsSchema = z.object({
  rightsConfirmed: z.boolean().optional(),
  peopleConsentConfirmed: z.boolean().optional(),
  containsIdentifiablePeople: z.boolean().optional(),
  syntheticDisclosureReviewed: z.boolean().optional(),
  containsRealisticSyntheticMedia: z.boolean().optional(),
  audienceSettingsReviewed: z.boolean().optional(),
  brandReviewed: z.boolean().optional(),
  factualClaimsReviewed: z.boolean().optional(),
  accessibilityReviewed: z.boolean().optional(),
  commercialDisclosureReviewed: z.boolean().optional(),
  containsCommercialPromotion: z.boolean().optional(),
  privacyReviewed: z.boolean().optional(),
  noManipulativeAutomation: z.boolean().optional(),
  accountConnectionVerified: z.boolean().optional(),
  connectorFormatVerified: z.boolean().optional(),
}).strict()

export function getPackageRules({ platform, format = 'post', attestations = {}, now = new Date(), policySnapshots = [] } = {}) {
  if (!metricPlatforms.includes(platform)) throw new Error('Choose a supported platform')
  const current = new Date(now).getTime()
  if (!Number.isFinite(current)) throw new Error('A valid rule review date is required')
  const confirmations = packageAttestationsSchema.parse(attestations)
  const check = (id, title, key, notApplicable = false, detail = '') => ({ id, title, status: notApplicable ? 'not_applicable' : confirmations[key] === true ? 'confirmed' : 'needs_review', basis: notApplicable ? 'Explicit supplied applicability information.' : confirmations[key] === true ? 'Reported workspace attestation; not independently verified.' : 'No affirmative attestation supplied.', detail })
  const checks = [
    check('sources', 'Factual claims and qualifications checked', 'factualClaimsReviewed'),
    check('rights', 'Asset rights and attribution checked', 'rightsConfirmed'),
    check('consent', 'Consent for identifiable people checked', 'peopleConsentConfirmed', confirmations.containsIdentifiablePeople === false),
    check('privacy', 'Privacy and personal information checked', 'privacyReviewed'),
    check('brand', 'Brand and public copy checked', 'brandReviewed'),
    check('accessibility', 'Captions, readability and accessibility checked', 'accessibilityReviewed'),
    check('synthetic', 'Realistic synthetic-media disclosure assessed', 'syntheticDisclosureReviewed', confirmations.containsRealisticSyntheticMedia === false),
    check('commercial', 'Commercial disclosure assessed', 'commercialDisclosureReviewed', confirmations.containsCommercialPromotion === false),
    check('connection', 'Destination account connection checked', 'accountConnectionVerified'),
    check('connector', 'Selected format checked against publishing connector', 'connectorFormatVerified'),
  ]
  if (platform === 'YouTube') checks.push(check('audience', 'YouTube audience and visibility settings checked', 'audienceSettingsReviewed', false, 'The YouTube API provides audience and realistic altered/synthetic-media settings; the publishing connector must support the necessary settings.'))
  if (platform === 'X') checks.push(check('automation', 'Automation avoids duplication and trend manipulation', 'noManipulativeAutomation', false, 'X automation rules restrict duplicative posts across accounts and attempts to manipulate trending topics.'))
  const normalizedFormat = normalizePackageFormat(platform, format)
  const supportedNative = Boolean(normalizedFormat)
  const policySources = sources[platform].map(value => {
    const refreshed = policySnapshots.find(item => item.id === value.id && item.url === value.url)
    return refreshed ? { ...value, ...refreshed, limitation: 'Automated retrieval records availability and text changes only; it does not review policy meaning or certify compliance.' } : { ...value }
  })
  const effectiveReviewDue = policySources.map(value => value.reviewDue || reviewDue).sort()[0] || reviewDue
  const stale = current >= Date.parse(effectiveReviewDue)
  const policyStatus = stale ? 'review_due' : policySources.some(value => value.retrievalStatus === 'unavailable') ? 'source_unavailable' : 'dated_reference'
  return {
    version: packageRulesVersion, platform, format, checkedAt: policySources.some(value => value.checkedAt) ? checkedAt : null, researchAttemptAt: policySources.map(value => value.attemptedAt || checkedAt).sort().at(-1), reviewDue: effectiveReviewDue, policyStatus, sources: policySources,
    status: 'needs_review',
    capability: { status: !supportedNative ? 'unsupported' : 'unverified', normalizedFormat, nativeFormats: [...nativeFormats[platform]], detail: !supportedNative ? 'The selected format is not in this dated native-format reference. Choose a supported format and verify current account capabilities.' : 'Native platform availability does not establish publishing-connector or destination-account support. Confirm the exact integration before dispatch.', accountConnectionAttested: confirmations.accountConnectionVerified === true, connectorFormatAttested: confirmations.connectorFormatVerified === true },
    checks,
    limitations: ['This checklist is a planning aid, not a legal opinion, platform approval or release authorization.', 'Workspace attestations do not replace existing source, media, budget and publishing release gates.', ...(stale ? ['The dated policy references are due for review; recheck the official sources before relying on them.'] : []), ...(policyStatus === 'source_unavailable' ? ['Some official policy documentation was unavailable; this package does not claim current platform compliance.'] : [])],
  }
}
