import test from 'node:test'
import assert from 'node:assert/strict'
import { metricObservationSchema, metricObservationKey, calculateObservationMetrics, summarizeComparablePerformance, compareObservationToBaseline } from '../studio/package-analytics.js'

const now = new Date('2026-11-11T12:00:00.000Z')
const observation = (patch = {}) => ({ observationId: 'observation-1', accountId: 'account-one', postId: 'post-one', platform: 'Instagram', format: 'reel', distribution: 'organic', publishedAt: '2026-11-10T12:00:00.000Z', measuredAt: now.toISOString(), source: { kind: 'manual', label: 'Native dashboard export' }, metrics: { reach: 100, impressions: 200, views: 120, likes: 5, comments: 2, shares: 2, saves: 1, clicks: 10, conversions: 2, averageWatchSeconds: 15, durationSeconds: 20 }, ...patch })
const cohort = { accountId: 'account-one', platform: 'Instagram', format: 'reel', distribution: 'organic', now }

test('metric observations validate counts, windows and untrusted provenance', () => {
  assert.equal(metricObservationSchema.safeParse(observation({ metrics: { reach: -1 } })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ metrics: { reach: 1.5 } })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ metrics: { reach: Infinity } })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ metrics: {} })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ measuredAt: '2026-11-09T12:00:00.000Z' })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ windowKind: 'period' })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ windowKind: 'period', periodStart: '2026-11-09T12:00:00.000Z', periodEnd: now.toISOString() })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ metrics: { likes: Number.MAX_SAFE_INTEGER, comments: 1 } })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ source: { kind: 'provider', label: 'Claimed API', verified: true } })).success, false)
  assert.equal(metricObservationSchema.safeParse(observation({ source: { kind: 'manual', label: 'Export', url: 'https://user:secret@example.com/file' } })).success, false)
  assert.equal(calculateObservationMetrics(observation({ source: { kind: 'provider', label: 'Claimed API' } })).provenance, 'reported_unverified')
})

test('calculations record repeatable numerators, denominators and formulas', () => {
  const result = calculateObservationMetrics(observation())
  assert.equal(result.metrics.engagementRateByReach.value, 10)
  assert.equal(result.metrics.engagementRateByReach.numerator, 10)
  assert.equal(result.metrics.engagementRateByReach.denominator, 100)
  assert.equal(result.metrics.shareRate.value, 2)
  assert.equal(result.metrics.saveRate.value, 1)
  assert.equal(result.metrics.clickThroughRate.value, 5)
  assert.equal(result.metrics.conversionRateByClick.value, 20)
  assert.equal(result.metrics.averagePercentageViewed.value, 75)
  assert.match(result.metrics.clickThroughRate.formula, /impressions/)
})

test('missing counts and zero denominators do not become invented rates', () => {
  const missing = calculateObservationMetrics(observation({ metrics: { reach: 100, likes: 5, shares: 0 } }))
  assert.equal(missing.metrics.engagementRateByReach.value, null)
  assert.equal(missing.metrics.engagementRateByReach.status, 'unavailable')
  assert.equal(missing.metrics.shareRate.value, 0)
  assert.equal(missing.metrics.saveRate.value, null)
  const zero = calculateObservationMetrics(observation({ metrics: { reach: 0, shares: 0 } }))
  assert.equal(zero.metrics.shareRate.value, null)
  assert.match(zero.metrics.shareRate.reason, /zero/)
  assert.equal(calculateObservationMetrics(observation({ metrics: { averageWatchSeconds: 30, durationSeconds: 20 } })).metrics.averagePercentageViewed.value, 150)
})

test('observation identity is idempotent for a measurement rather than its caller id', () => {
  const first = observation()
  assert.equal(metricObservationKey(first), metricObservationKey({ ...first, observationId: 'retried-import' }))
  assert.equal(metricObservationKey(first), metricObservationKey({ ...first, metrics: { reach: 200 } }))
  assert.equal(metricObservationKey(first), metricObservationKey({ ...first, source: { label: 'Native dashboard export', kind: 'manual' } }))
  assert.notEqual(metricObservationKey(first), metricObservationKey({ ...first, measuredAt: '2026-11-11T11:59:00.000Z' }))
})

test('baseline excludes paid, other-account, other-format and different-definition observations', () => {
  const rows = [observation(), observation({ postId: 'paid', distribution: 'paid' }), observation({ postId: 'other-account', accountId: 'other' }), observation({ postId: 'other-format', format: 'carousel' }), observation({ postId: 'other-definition', definitionVersion: 'changed-views' })]
  const result = summarizeComparablePerformance(rows, cohort)
  assert.equal(result.sampleSize, 1)
  assert.equal(result.status, 'limited_sample')
  assert.equal(result.excluded.different_cohort, 4)
  assert.equal(result.baseline.engagementRateByReach.median, 10)
})

test('baseline takes one current eligible snapshot per distinct post', () => {
  const rows = [observation({ observationId: 'older', measuredAt: '2026-11-11T11:00:00.000Z', metrics: { reach: 100, shares: 99 } }), observation({ observationId: 'latest' }), ...Array.from({ length: 4 }, (_, index) => observation({ observationId: `distinct-${index}`, postId: `post-${index}`, metrics: { reach: 100, shares: index + 1 } }))]
  const result = summarizeComparablePerformance(rows, cohort)
  assert.equal(result.sampleSize, 5)
  assert.equal(result.status, 'available')
  assert.equal(result.excluded.duplicate_post_snapshot, 1)
  assert.equal(result.observationIds.includes('older'), false)
  assert.equal(result.baseline.shareRate.median, 2)
  assert.equal(result.baseline.engagementRateByReach.sampleSize, 1)
  assert.equal(result.baseline.engagementRateByReach.status, 'limited_sample')
})

test('stale, future and differently aged measurements are explicitly excluded', () => {
  const result = summarizeComparablePerformance([observation({ observationId: 'stale', publishedAt: '2026-09-01T12:00:00.000Z', measuredAt: '2026-09-02T12:00:00.000Z' }), observation({ observationId: 'future', measuredAt: '2026-11-12T12:00:00.000Z' }), observation({ observationId: 'old-post-age', publishedAt: '2026-11-01T12:00:00.000Z' })], cohort)
  assert.equal(result.status, 'unavailable')
  assert.deepEqual(result.excluded, { stale: 1, future: 1, different_post_age: 1 })
  assert.equal(result.baseline.shareRate.median, null)
})

test('measurement sources and lifetime/period windows cannot be silently pooled', () => {
  const otherSource = observation({ observationId: 'other-source', postId: 'post-two', source: { kind: 'provider', label: 'Different definitions' } })
  const mixed = summarizeComparablePerformance([observation(), otherSource], cohort)
  assert.equal(mixed.status, 'unavailable')
  assert.equal(mixed.excluded.mixed_sources, 1)
  assert.equal(summarizeComparablePerformance([observation(), otherSource], { ...cohort, sourceKind: 'manual', sourceLabel: 'Native dashboard export' }).sampleSize, 1)
  const period = observation({ windowKind: 'period', periodStart: '2026-11-10T12:00:00.000Z', periodEnd: now.toISOString() })
  assert.equal(summarizeComparablePerformance([period], cohort).sampleSize, 0)
  assert.equal(summarizeComparablePerformance([period], { ...cohort, windowKind: 'period', periodHours: 24 }).sampleSize, 1)
})

test('conflicting snapshots do not silently choose whichever arrived first', () => {
  const original = observation(); const conflicting = observation({ observationId: 'conflict', metrics: { reach: 100, shares: 99 } })
  for (const rows of [[original, conflicting], [conflicting, original]]) {
    const result = summarizeComparablePerformance(rows, cohort)
    assert.equal(result.sampleSize, 0)
    assert.equal(result.excluded.conflicting_snapshot, 1)
  }
})

test('relative performance reports rate-to-median math only for the same cohort', () => {
  const summary = summarizeComparablePerformance([observation()], cohort)
  const result = compareObservationToBaseline(observation({ observationId: 'target', postId: 'target', metrics: { reach: 100, shares: 4 } }), summary)
  assert.equal(result.comparable, true)
  assert.equal(result.metrics.shareRate.value, 2)
  assert.equal(result.metrics.shareRate.numerator, 4)
  assert.equal(result.metrics.shareRate.denominator, 2)
  assert.equal(result.metrics.shareRate.sampleSize, 1)
  assert.equal(result.metrics.shareRate.status, 'limited_sample')
  assert.match(result.metrics.shareRate.confidence, /descriptive/)
  assert.equal(compareObservationToBaseline(observation({ accountId: 'other' }), summary).metrics.shareRate.value, null)
  assert.equal(compareObservationToBaseline(observation({ measuredAt: '2026-11-12T12:00:00.000Z' }), summary).comparable, false)
  const zero = summarizeComparablePerformance([observation({ metrics: { reach: 100, shares: 0 } })], cohort)
  assert.equal(compareObservationToBaseline(observation(), zero).metrics.shareRate.value, null)
  assert.match(compareObservationToBaseline(observation(), zero).metrics.shareRate.reason, /zero/)
})
