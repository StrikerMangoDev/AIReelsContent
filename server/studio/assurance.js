import { z } from 'zod'
import { citationSentences } from './citation-sentences.js'
import { contentHash, independentlyReviewed } from './approval.js'
import { reviewContent, settingsSchema } from './content.js'
import { costScopeHash } from '../budget/policy.js'

export const assurancePolicyVersion = 'content-assurance-v1'
const digest = value => costScopeHash(value, null)
const references = z.array(z.string().min(1).max(200)).max(100)
const checkSchema = z.object({ stage: z.string(), code: z.string(), status: z.enum(['passed', 'failed', 'unknown']), method: z.enum(['deterministic', 'human']), evaluator: z.string(), checkedAt: z.string().datetime(), evidenceIds: references, claimIds: references, rationale: z.string(), limitations: z.array(z.string()) }).strict()
export const assuranceSchema = z.object({
  policyVersion: z.literal(assurancePolicyVersion), contentHash: z.string(), briefHash: z.string(), sourceHashes: z.array(z.object({ id: z.string(), hash: z.string() }).strict()), brandVersion: z.string().nullable(),
  checks: z.array(checkSchema), issues: z.array(z.object({ code: z.string(), severity: z.enum(['blocker', 'warning']), field: z.string(), evidenceIds: references, claimIds: references, status: z.literal('open'), rationale: z.string() }).strict()),
  stageResults: z.array(z.object({ runId: z.string(), stage: z.string(), scopeHash: z.string(), result: z.enum(['passed', 'failed', 'review_required']), startedAt: z.string().datetime(), completedAt: z.string().datetime(), actorId: z.string().nullable() }).strict()),
}).strict()

export function buildAssurance(value, { actorId = null, runId = null, checkedAt = new Date().toISOString(), stage = 'validation' } = {}) {
  const evidence = Array.isArray(value.evidence) ? value.evidence : []
  const claims = Array.isArray(value.content?.claims) ? value.content.claims : []
  const evidenceIds = evidence.map(source => source.id).filter(Boolean)
  const claimIds = claims.map(claim => claim.id)
  const checks = []; const issues = []
  const add = (code, result, rationale, field, refs = evidenceIds, ids = claimIds) => {
    checks.push({ stage: field, code, status: result ? 'passed' : 'failed', method: 'deterministic', evaluator: assurancePolicyVersion, checkedAt, evidenceIds: refs, claimIds: ids, rationale, limitations: [] })
    if (!result) issues.push({ code, severity: 'blocker', field, evidenceIds: refs, claimIds: ids, status: 'open', rationale })
  }
  add('brief-complete', settingsSchema.safeParse(value.settings).success, 'The saved settings must match the supported brief schema; defaulted preferences are assumptions, not audience research.', 'brief', [], [])
  const sourcesValid = evidence.some(source => source.excerpt?.trim().length >= 100) && new Set(evidenceIds).size === evidence.length && evidence.every(source => {
    try { const retrieved = Date.parse(source.retrievedAt); return Boolean(source.id && source.hash && typeof source.excerpt === 'string' && new URL(source.url).protocol === 'https:' && Number.isFinite(retrieved) && retrieved <= Date.parse(checkedAt)) } catch { return false }
  })
  add('source-provenance', sourcesValid, 'Sources need distinct IDs, captured text, HTTPS URLs, hashes and retrieval timestamps; at least one capture must contain 100 readable characters. Citations separately require matching quotations.', 'research')
  const validation = reviewContent(value.content, evidence, value.settings)
  add('content-validation', validation.issues.length === 0, validation.issues.length ? validation.issues.join(' ') : 'The saved content passed schema, citation and selected-format checks.', 'automatic')
  for (const [index, message] of validation.issues.entries()) issues.push({ code: `content-${index + 1}`, severity: 'blocker', field: 'content', evidenceIds, claimIds, status: 'open', rationale: message })
  const unsupportedNumbers = claims.filter(claim => {
    const quoted = new Set([...String(claim.quote || '').matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?/gu)].map(match => match[0]))
    return [...String(claim.text || '').matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?/gu)].some(match => !quoted.has(match[0]))
  }).map(claim => claim.id)
  add('claim-numbers', unsupportedNumbers.length === 0, unsupportedNumbers.length ? 'Claims contain dates or numbers absent from their supporting passage.' : 'Claim dates and numbers occur in their cited passages; meaning still needs human review.', 'automatic', evidenceIds, unsupportedNumbers)
  const prose = [value.content?.script, value.content?.website?.title, value.content?.website?.body, ...Object.values(value.content?.captions || {}), ...(value.content?.hooks || []), ...(value.content?.scenes || []).map(scene => scene.narration), ...(value.content?.strategy?.platforms || []).flatMap(item => [item.headline, item.hook, item.body, item.alternativeHook])].filter(item => typeof item === 'string')
  const numbersSupported = prose.every(body => citationSentences(body).every(sentence => {
    const ids = [...sentence.matchAll(/\[(C\d+)\]/g)].map(match => match[1])
    const support = ids.length ? claims.filter(claim => ids.includes(claim.id)) : claims
    const quoted = new Set(support.flatMap(claim => [...String(claim.quote || '').matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?/gu)].map(match => match[0])))
    return [...sentence.replace(/\[C\d+\]/g, '').matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?/gu)].every(match => quoted.has(match[0]))
  }))
  add('output-numbers', numbersSupported, numbersSupported ? 'Dates and numbers in headline, hooks and delivery prose occur in supporting passages; semantic meaning still requires review.' : 'Headline, hook or delivery prose contains dates or numbers absent from supporting passages.', 'automatic')
  for (const [code, rationale] of [['semantic-support', 'Review every claim for semantic support, scope, dates and contradictions against the captured sources.'], ['creative-review', 'Review clarity, hook promise, brand fit, originality against an identified baseline, platform fit and CTA suitability.'], ['source-context', 'Confirm source freshness, rights and limitations; audience demand remains unknown without direct observations.']]) {
    checks.push({ stage: code === 'creative-review' ? 'creative' : 'independent-review', code, status: 'unknown', method: 'human', evaluator: 'assigned-noncontributor', checkedAt, evidenceIds, claimIds, rationale, limitations: ['Requires a current independent human review of this exact saved version.'] })
  }
  const scopeHash = contentHash(value)
  const priorStages = value.assurance?.contentHash === scopeHash ? (value.assurance.stageResults || []).slice(-9) : []
  return { policyVersion: assurancePolicyVersion, contentHash: scopeHash, briefHash: digest({ settings: value.settings, researchContext: value.researchContext || null, brandVersion: value.brandVersion || null }), sourceHashes: evidence.map(source => ({ id: source.id || '', hash: source.hash || '' })), brandVersion: value.brandVersion || null, checks, issues,
    stageResults: [...priorStages, { runId: runId || `validation-${scopeHash}`, stage, scopeHash, result: issues.length ? 'failed' : 'review_required', startedAt: checkedAt, completedAt: checkedAt, actorId }] }
}

export function assessAssurance(value, { now = Date.now(), requireIndependentReview = true } = {}) {
  const parsed = assuranceSchema.safeParse(value.assurance)
  const issues = []
  if (!parsed.success) return { eligible: false, policyVersion: assurancePolicyVersion, contentHash: contentHash(value), checks: [], issues: ['Run the required content assurance checks for this version.'] }
  const saved = parsed.data
  const expected = buildAssurance(value, { checkedAt: saved.checks[0]?.checkedAt || new Date(now).toISOString() })
  if (saved.contentHash !== expected.contentHash || saved.briefHash !== expected.briefHash || digest(saved.sourceHashes) !== digest(expected.sourceHashes) || saved.brandVersion !== expected.brandVersion) issues.push('Content assurance belongs to a different saved version.')
  if (digest(saved.checks) !== digest(expected.checks) || digest(saved.issues) !== digest(expected.issues)) issues.push('Content assurance checks are incomplete or inconsistent; run them again.')
  if (!saved.stageResults.some(result => result.scopeHash === expected.contentHash && Date.parse(result.completedAt) <= now)) issues.push('A completed assurance stage for this version is required.')
  issues.push(...expected.issues.filter(issue => issue.severity === 'blocker').map(issue => issue.rationale))
  const reviewed = requireIndependentReview && independentlyReviewed(value, now)
  if (requireIndependentReview && !reviewed) issues.push('A current independent human semantic and creative review is required.')
  const checks = saved.checks.map(check => check.method === 'human' && reviewed ? { ...check, status: 'passed', evaluator: value.independentReview.reviewerId, checkedAt: value.independentReview.reviewedAt, limitations: ['Human editorial judgment, not a guarantee of factual truth or audience performance.'] } : check)
  return { eligible: issues.length === 0, policyVersion: assurancePolicyVersion, contentHash: expected.contentHash, checks, issues: [...new Set(issues)] }
}
