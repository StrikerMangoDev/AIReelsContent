import test from 'node:test'
import assert from 'node:assert/strict'
import { getPackageRules, normalizePackageFormat, packageAttestationsSchema, packageRulesVersion } from '../studio/package-rules.js'

const now = new Date('2026-11-11T12:00:00.000Z')

test('all five platforms receive dated official references and honest unverified capability', () => {
  for (const platform of ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']) {
    const result = getPackageRules({ platform, format: platform === 'YouTube' ? 'video' : 'post', now })
    assert.equal(result.version, packageRulesVersion)
    assert.equal(result.capability.status, 'unverified')
    assert.equal(result.status, 'needs_review')
    assert.ok(result.sources.length)
    assert.ok(result.sources.every(source => source.url.startsWith('https://') && source.reviewDue))
    assert.ok(result.checks.every(check => check.status === 'needs_review'))
  }
})

test('unavailable Meta references and expired rule reviews do not claim current verification', () => {
  const instagram = getPackageRules({ platform: 'Instagram', now })
  assert.equal(instagram.policyStatus, 'source_unavailable')
  assert.equal(instagram.sources[0].checkedAt, null)
  assert.equal(instagram.checkedAt, null)
  assert.equal(instagram.researchAttemptAt, '2026-11-11T00:00:00.000Z')
  assert.match(instagram.limitations.join(' '), /unavailable/)
  const expired = getPackageRules({ platform: 'X', now: new Date('2027-01-01T00:00:00.000Z') })
  assert.equal(expired.policyStatus, 'review_due')
  assert.match(expired.limitations.join(' '), /due for review/)
})

test('applicability and attestations are explicit and cannot certify legal compliance', () => {
  const result = getPackageRules({ platform: 'YouTube', format: 'video', now, attestations: { rightsConfirmed: true, containsIdentifiablePeople: false, containsRealisticSyntheticMedia: false, containsCommercialPromotion: false, audienceSettingsReviewed: true, connectorFormatVerified: true, accountConnectionVerified: true } })
  assert.equal(result.checks.find(check => check.id === 'rights').status, 'confirmed')
  assert.equal(result.checks.find(check => check.id === 'consent').status, 'not_applicable')
  assert.equal(result.checks.find(check => check.id === 'synthetic').status, 'not_applicable')
  assert.equal(result.checks.find(check => check.id === 'audience').status, 'confirmed')
  assert.equal(result.checks.find(check => check.id === 'sources').status, 'needs_review')
  assert.equal(result.capability.status, 'unverified')
  assert.equal(result.status, 'needs_review')
  assert.match(result.limitations[0], /not a legal opinion/)
  assert.equal(packageAttestationsSchema.safeParse({ legalComplianceApproved: true }).success, false)
})

test('native format support is separate from connector and account availability', () => {
  assert.equal(getPackageRules({ platform: 'YouTube', format: 'carousel', now }).capability.status, 'unsupported')
  assert.equal(getPackageRules({ platform: 'LinkedIn', format: 'document', now }).capability.status, 'unverified')
  assert.ok(getPackageRules({ platform: 'X', now }).checks.some(check => check.id === 'automation'))
  assert.throws(() => getPackageRules({ platform: 'Unknown', now }))
})

test('known saved and AI format descriptions normalize across all five platforms without certifying support', () => {
  const examples = [
    ['Instagram', 'Instagram Reel (9:16 vertical video)', 'reel'],
    ['Instagram', 'Carousel of six educational slides', 'carousel'],
    ['YouTube', 'YouTube Short (9:16 vertical video)', 'short'],
    ['YouTube', 'Short-form vertical video', 'short'],
    ['YouTube', 'Long-form video with chapters', 'video'],
    ['X', 'X single post with source link', 'post'],
    ['X', 'Text-only thread (four posts)', 'thread'],
    ['Facebook', 'Facebook Reel — narrated explainer', 'reel'],
    ['Facebook', 'Single image post', 'image'],
    ['LinkedIn', 'LinkedIn document carousel (PDF)', 'document'],
    ['LinkedIn', 'Professional article', null],
    ['LinkedIn', 'Article with practical takeaways', 'article'],
  ]
  for (const [platform, description, expected] of examples) {
    assert.equal(normalizePackageFormat(platform, description), expected, description)
    const rule = getPackageRules({ platform, format: description, now, attestations: { connectorFormatVerified: true } })
    assert.equal(rule.capability.status, expected ? 'unverified' : 'unsupported')
    assert.equal(rule.capability.normalizedFormat, expected)
    assert.equal(rule.status, 'needs_review')
  }
  for (const [platform, description] of [['YouTube', 'Instagram Reel (9:16)'], ['YouTube', 'Carousel video collection'], ['X', 'Live hologram video'], ['Instagram', 'Unavailable'], ['Facebook', 'Not applicable'], ['LinkedIn', 'Unrecognized format']]) {
    assert.equal(getPackageRules({ platform, format: description, now }).capability.status, 'unsupported', description)
  }
})
