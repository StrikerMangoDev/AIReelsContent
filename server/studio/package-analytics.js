import { createHash } from 'node:crypto'
import { z } from 'zod'

export const metricPlatforms = ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional()
const seconds = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional()
const httpsUrl = z.url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password }, 'Use an HTTPS source URL without credentials')

export const metricObservationSchema = z.object({
  observationId: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
  accountId: z.string().trim().min(1).max(200),
  postId: z.string().trim().min(1).max(200),
  publicationId: z.string().trim().min(1).max(200).optional(),
  platform: z.enum(metricPlatforms),
  format: z.string().trim().min(1).max(50),
  distribution: z.enum(['organic', 'paid']),
  publishedAt: z.iso.datetime(),
  measuredAt: z.iso.datetime(),
  windowKind: z.enum(['lifetime', 'period']).default('lifetime'),
  periodStart: z.iso.datetime().optional(),
  periodEnd: z.iso.datetime().optional(),
  definitionVersion: z.string().trim().min(1).max(120).default('reported-v1'),
  source: z.object({ kind: z.enum(['manual', 'provider']), label: z.string().trim().min(1).max(200), url: httpsUrl.optional() }).strict(),
  metrics: z.object({ reach: count, impressions: count, views: count, likes: count, comments: count, shares: count, saves: count, clicks: count, conversions: count, averageWatchSeconds: seconds, durationSeconds: z.number().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.measuredAt) < Date.parse(value.publishedAt)) ctx.addIssue({ code: 'custom', path: ['measuredAt'], message: 'Measurement cannot precede publication' })
  if (value.windowKind === 'period') {
    if (!value.periodStart || !value.periodEnd || Date.parse(value.periodStart) < Date.parse(value.publishedAt) || Date.parse(value.periodStart) > Date.parse(value.periodEnd) || Date.parse(value.periodEnd) > Date.parse(value.measuredAt)) ctx.addIssue({ code: 'custom', path: ['periodStart'], message: 'A period needs ordered start/end dates within publication and measurement' })
  } else if (value.periodStart || value.periodEnd) ctx.addIssue({ code: 'custom', path: ['periodStart'], message: 'Lifetime measurements cannot include a period' })
  const interactions = ['likes', 'comments', 'shares', 'saves'].map(key => value.metrics[key]).filter(metric => typeof metric === 'number')
  if (!Number.isSafeInteger(interactions.reduce((total, metric) => total + metric, 0))) ctx.addIssue({ code: 'custom', path: ['metrics'], message: 'Combined interaction counts exceed precise integer arithmetic' })
  if (!Object.values(value.metrics).some(metric => typeof metric === 'number')) ctx.addIssue({ code: 'custom', path: ['metrics'], message: 'Provide at least one measured metric' })
})

// A provider label supplied by a client is reported data, not server-verified provider evidence.
export function metricObservationKey(input) {
  const value = metricObservationSchema.parse(input)
  return createHash('sha256').update(JSON.stringify([value.accountId, value.platform, value.postId, value.format, value.distribution, value.measuredAt, value.windowKind, value.periodStart || null, value.periodEnd || null, value.definitionVersion, value.source.kind, value.source.label, value.source.url || null])).digest('hex').slice(0, 32)
}

export function calculateObservationMetrics(input) {
  const value = metricObservationSchema.parse(input)
  const metrics = value.metrics
  const ratio = (numerator, denominator, formula, missing) => {
    const result = typeof numerator === 'number' && typeof denominator === 'number' && denominator > 0 ? numerator / denominator * 100 : null
    const available = result !== null && Number.isFinite(result)
    return {
    value: available ? Number(result.toFixed(6)) : null,
    numerator: typeof numerator === 'number' ? numerator : null,
    denominator: typeof denominator === 'number' ? denominator : null,
    unit: 'percent', formula,
    status: available ? 'available' : 'unavailable',
    reason: typeof numerator !== 'number' || typeof denominator !== 'number' ? missing : denominator === 0 ? 'The denominator is zero; no rate can be calculated.' : !available ? 'The rate exceeds finite numeric arithmetic.' : null,
  } }
  const interactions = ['likes', 'comments', 'shares', 'saves'].every(key => typeof metrics[key] === 'number') ? metrics.likes + metrics.comments + metrics.shares + metrics.saves : null
  return { observationId: value.observationId, provenance: 'reported_unverified', metrics: {
    engagementRateByReach: ratio(interactions, metrics.reach, '(likes + comments + shares + saves) / reach * 100', 'Reach and all four interaction counts are required; missing counts are not zero.'),
    shareRate: ratio(metrics.shares, metrics.reach, 'shares / reach * 100', 'Shares and reach are required.'),
    saveRate: ratio(metrics.saves, metrics.reach, 'saves / reach * 100', 'Saves and reach are required.'),
    clickThroughRate: ratio(metrics.clicks, metrics.impressions, 'clicks / impressions * 100', 'Clicks and their matching impressions are required.'),
    conversionRateByClick: ratio(metrics.conversions, metrics.clicks, 'conversions / clicks * 100', 'Conversions and their matching clicks are required.'),
    averagePercentageViewed: ratio(metrics.averageWatchSeconds, metrics.durationSeconds, 'averageWatchSeconds / durationSeconds * 100', 'Average watch time and video duration in seconds are required.'),
  }, limitations: ['Imported metrics have not been independently verified.', 'Ratios assume the supplied numerator and denominator use matching definitions and measurement windows.', 'A percentage viewed above 100 can reflect repeat viewing; it is not clamped.'] }
}

const metricNames = ['engagementRateByReach', 'shareRate', 'saveRate', 'clickThroughRate', 'conversionRateByClick', 'averagePercentageViewed']
const median = values => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[middle] : sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2 : null }

export function summarizeComparablePerformance(observations, { accountId, platform, format, distribution, definitionVersion = 'reported-v1', sourceKind, sourceLabel, windowKind = 'lifetime', periodHours, now = new Date(), targetAgeHours = 24, ageToleranceHours = 12, maxAgeDays = 90, staleAfterDays = 30, minimumSample = 5 } = {}) {
  const currentTime = new Date(now).getTime()
  if (!Number.isFinite(currentTime) || !accountId || !metricPlatforms.includes(platform) || !format || !['organic', 'paid'].includes(distribution) || !Number.isFinite(targetAgeHours) || targetAgeHours < 0 || !Number.isFinite(ageToleranceHours) || ageToleranceHours < 0 || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0 || !Number.isFinite(staleAfterDays) || staleAfterDays <= 0 || !Number.isInteger(minimumSample) || minimumSample < 1) throw new Error('A valid comparable account, platform, format, distribution and measurement window are required')
  const excluded = {}; const countExcluded = reason => { excluded[reason] = (excluded[reason] || 0) + 1 }
  const byPost = new Map(); const snapshots = new Map(); const conflictedPosts = new Set()
  for (const input of observations) {
    const parsed = metricObservationSchema.safeParse(input)
    if (!parsed.success) { countExcluded('invalid'); continue }
    const value = parsed.data; const published = Date.parse(value.publishedAt); const measured = Date.parse(value.measuredAt)
    const ageHours = (measured - published) / 3600000
    if (value.accountId !== accountId || value.platform !== platform || value.format !== format || value.distribution !== distribution || value.definitionVersion !== definitionVersion || value.windowKind !== windowKind || sourceKind && value.source.kind !== sourceKind || sourceLabel && value.source.label !== sourceLabel) { countExcluded('different_cohort'); continue }
    if (windowKind === 'period' && (!Number.isFinite(periodHours) || Math.abs((Date.parse(value.periodEnd) - Date.parse(value.periodStart)) / 3600000 - periodHours) > 0.01)) { countExcluded('different_period'); continue }
    if (measured > currentTime || published > currentTime) { countExcluded('future'); continue }
    if ((currentTime - measured) / 86400000 > staleAfterDays || (currentTime - published) / 86400000 > maxAgeDays) { countExcluded('stale'); continue }
    if (Math.abs(ageHours - targetAgeHours) > ageToleranceHours) { countExcluded('different_post_age'); continue }
    const key = `${value.platform}:${value.accountId}:${value.postId}`
    const snapshotKey = `${key}:${value.measuredAt}`; const fingerprint = JSON.stringify(value.metrics)
    if (snapshots.has(snapshotKey) && snapshots.get(snapshotKey) !== fingerprint) { conflictedPosts.add(key); countExcluded('conflicting_snapshot') }
    snapshots.set(snapshotKey, fingerprint)
    const previous = byPost.get(key)
    if (previous) countExcluded('duplicate_post_snapshot')
    if (!previous || measured > Date.parse(previous.measuredAt)) byPost.set(key, value)
  }
  let selected = [...byPost.entries()].filter(([key]) => !conflictedPosts.has(key)).map(([, value]) => value)
  // Different provider definitions must not be silently pooled when a source was not selected.
  const sources = new Set(selected.map(value => JSON.stringify([value.source.kind, value.source.label])))
  if (sources.size > 1 && (!sourceKind || !sourceLabel)) { countExcluded('mixed_sources'); selected = [] }
  const calculations = selected.map(calculateObservationMetrics)
  const baseline = Object.fromEntries(metricNames.map(name => {
    const values = calculations.map(result => result.metrics[name].value).filter(value => value !== null)
    return [name, { median: median(values), sampleSize: values.length, status: values.length >= minimumSample ? 'available' : values.length ? 'limited_sample' : 'unavailable' }]
  }))
  return { status: selected.length >= minimumSample ? 'available' : selected.length ? 'limited_sample' : 'unavailable', evaluatedAt: new Date(currentTime).toISOString(), sampleSize: selected.length, observationIds: selected.map(value => value.observationId), baseline, excluded, cohort: { accountId, platform, format, distribution, definitionVersion, windowKind, sourceKind: sourceKind || selected[0]?.source.kind || null, sourceLabel: sourceLabel || selected[0]?.source.label || null, periodHours: periodHours ?? null, targetAgeHours, ageToleranceHours, maxAgeDays, staleAfterDays, minimumSample }, limitations: ['Reported observations are not a verified provider analytics connection.', 'Small samples and observational comparisons do not establish causation or guarantee future performance.', ...(sources.size > 1 && (!sourceKind || !sourceLabel) ? ['Select one measurement source before comparing these observations.'] : [])] }
}

export function compareObservationToBaseline(input, summary) {
  const value = metricObservationSchema.parse(input); const cohort = summary?.cohort
  const postAge = (Date.parse(value.measuredAt) - Date.parse(value.publishedAt)) / 3600000
  const evaluatedAt = Date.parse(summary?.evaluatedAt)
  const measurementAge = (evaluatedAt - Date.parse(value.measuredAt)) / 86400000
  const publicationAge = (evaluatedAt - Date.parse(value.publishedAt)) / 86400000
  const comparable = Boolean(cohort && Number.isFinite(evaluatedAt) && measurementAge >= 0 && measurementAge <= cohort.staleAfterDays && publicationAge <= cohort.maxAgeDays && ['accountId', 'platform', 'format', 'distribution', 'definitionVersion', 'windowKind'].every(key => value[key] === cohort[key]) && value.source.kind === cohort.sourceKind && value.source.label === cohort.sourceLabel && Math.abs(postAge - cohort.targetAgeHours) <= cohort.ageToleranceHours && (value.windowKind !== 'period' || Math.abs((Date.parse(value.periodEnd) - Date.parse(value.periodStart)) / 3600000 - cohort.periodHours) <= 0.01))
  const calculated = calculateObservationMetrics(value)
  return { observationId: value.observationId, comparable, provenance: 'reported_unverified', metrics: Object.fromEntries(metricNames.map(name => {
    const numerator = calculated.metrics[name].value; const denominator = summary?.baseline?.[name]?.median ?? null; const sampleSize = summary?.baseline?.[name]?.sampleSize || 0
    const result = comparable && numerator !== null && typeof denominator === 'number' && denominator > 0 ? numerator / denominator : null
    const available = result !== null && Number.isFinite(result)
    return [name, { value: available ? Number(result.toFixed(6)) : null, unit: 'multiple', numerator, denominator, sampleSize, formula: 'observed rate / median comparable rate', status: !available ? 'unavailable' : sampleSize >= cohort.minimumSample ? 'available' : 'limited_sample', confidence: !available ? 'No valid comparable baseline.' : sampleSize < cohort.minimumSample ? 'Limited sample; descriptive comparison only.' : 'Descriptive account comparison; not a causal estimate or performance forecast.', reason: !comparable ? 'The observation does not match the baseline cohort, source and post age.' : numerator === null || denominator === null ? 'The observed rate or comparable baseline is unavailable.' : denominator === 0 ? 'The comparable median is zero; a relative multiple is undefined.' : !available ? 'The relative multiple exceeds finite numeric arithmetic.' : null }]
  })), limitations: ['Relative performance describes reported observations; it does not predict reach or establish causation.'] }
}
