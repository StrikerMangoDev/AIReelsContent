import { createHash } from 'node:crypto'

export const MAX_MICROS = 1_000_000_000_000
export const budgetError = message => Object.assign(new Error(message), { code: 'BUDGET_BLOCKED', status: 409 })
export function validateAmount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MICROS) throw budgetError('A bounded integer monetary amount is required')
}
export function validateBudgetOwner(owner, currency) {
  if (typeof owner !== 'string' || !owner || owner === '*' || owner.length > 128 || !/^[A-Z]{3}$/.test(currency)) throw budgetError('Invalid budget owner or currency')
}
export function validateQuote(quote, now = Date.now()) {
  if (!quote || typeof quote !== 'object') throw budgetError('A priced quote is required')
  validateAmount(quote.upperBoundMicros)
  if (!/^[A-Z]{3}$/.test(quote.currency) || typeof quote.priceVersion !== 'string' || !quote.priceVersion.trim() || !Number.isFinite(Date.parse(quote.priceExpiresAt)) || Date.parse(quote.priceExpiresAt) <= now) throw budgetError('Current verified pricing is required')
  if (!['generation', 'research', 'storage'].includes(quote.kind)) throw budgetError('Unknown charge kind')
  if (Object.hasOwn(quote, 'credit')) {
    if (!quote.credit || typeof quote.credit !== 'object' || quote.credit.currency !== quote.currency) throw budgetError('Credit currency does not match the monetary quote')
    verifyCreditEligibility(quote.credit, quote.creditEvidence, now)
  }
}

export function verifyCreditEligibility(requested, confirmed, now = Date.now()) {
  const fields = ['grantId', 'billingAccount', 'projectId', 'service', 'sku', 'region', 'currency']
  if (!requested || !confirmed || confirmed.status !== 'verified' || fields.some(key => typeof requested[key] !== 'string' || !requested[key] || requested[key] !== confirmed[key])) throw budgetError('Exact credit eligibility has not been confirmed')
  if (![confirmed.expiresAt, confirmed.verifiedUntil].every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > now)) throw budgetError('Credit evidence expired or requires refresh')
}

// The caller supplies trusted server pricing/promotion evidence, never browser-provided entitlements.
export async function reserveCost(repository, { owner, requestId, scope, quote, confirmedCredit, now = Date.now() }) {
  quote = quote?.credit ? { ...quote, creditEvidence: confirmedCredit } : quote
  validateBudgetOwner(owner, quote?.currency)
  validateQuote(quote, now)
  const scopeHash = createHash('sha256').update(JSON.stringify({ scope, quote })).digest('hex')
  return repository.budgetReserve(owner, requestId, scopeHash, quote)
}

export function nextReservation(current, action, actualMicros) {
  const result = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString() }
  if (action === 'dispatch' && current.status === 'reserved') { validateQuote(current.quote); return { ...result, status: 'dispatched' } }
  if (action === 'unknown' && current.status === 'dispatched') return { ...result, status: 'dispatch_unknown' }
  if (action === 'cancel' && ['reserved', 'dispatched', 'dispatch_unknown'].includes(current.status)) return { ...result, cancellationRequested: true, status: current.status === 'reserved' ? 'cancelled' : current.status }
  if (action === 'settle' && ['dispatched', 'dispatch_unknown'].includes(current.status)) {
    validateAmount(actualMicros)
    return { ...result, status: 'settled', actualMicros, overage: actualMicros > current.quote.upperBoundMicros }
  }
  throw budgetError('Invalid monetary reservation transition')
}
