import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createRepository } from '../storage/repository.js'
import { reserveCost, validateQuote, verifyCreditEligibility } from '../budget/policy.js'

const hash = 'c'.repeat(64)
const quote = (amount, kind = 'generation') => ({ currency: 'USD', upperBoundMicros: amount, priceVersion: 'fixture-price-1', priceExpiresAt: new Date(Date.now() + 3600000).toISOString(), kind })
const blocked = error => ['BUDGET_BLOCKED', 'P0004'].includes(error.code)
const denied = operation => assert.rejects(async () => operation(), blocked)

async function contract(db) {
  assert.deepEqual(await db.budgetSummary('alice'), { currency: 'USD', limitMicros: 0, heldMicros: 0, settledMicros: 0, overageBlocked: false, unreconciledCount: 0 })
  await denied(() => db.budgetReserve('alice', 'unknown-price', hash, { ...quote(0), upperBoundMicros: null }))
  await denied(() => db.budgetReserve('alice', 'expired-price', hash, { ...quote(0), priceExpiresAt: '2020-01-01T00:00:00Z' }))
  const credit = { grantId: 'grant', billingAccount: 'account', projectId: 'project', service: 'search', sku: 'standard', region: 'global', currency: 'USD' }
  await denied(() => db.budgetReserve('alice', 'infinite-price', hash, { ...quote(0), priceExpiresAt: 'infinity' }))
  for (const field of ['expiresAt', 'verifiedUntil']) await denied(() => db.budgetReserve('alice', `infinite-${field}`, hash, { ...quote(0), credit, creditEvidence: { ...credit, status: 'verified', expiresAt: '2099-01-01T00:00:00Z', verifiedUntil: '2099-01-01T00:00:00Z', [field]: 'infinity' } }))
  await denied(() => db.budgetReserve('alice', 'unverified-credit', hash, { ...quote(0), credit }))
  await denied(() => db.budgetReserve('alice', 'expired-credit', hash, { ...quote(0), credit, creditEvidence: { ...credit, status: 'verified', expiresAt: '2020-01-01T00:00:00Z', verifiedUntil: '2099-01-01T00:00:00Z' } }))
  await denied(() => db.budgetReserve('alice', 'unfunded', hash, quote(1)))
  const free = await db.budgetReserve('alice', 'free', hash, quote(0))
  assert.equal(free.reserved, true)
  await db.budgetConfigure('USD', 'alice', 100, 70)
  await db.budgetConfigure('USD', 'bob', 100, 70)
  const firstQuote = quote(60)
  const first = await db.budgetReserve('alice', 'first', hash, firstQuote)
  assert.deepEqual(await db.budgetReserve('alice', 'first', hash, firstQuote), { reserved: false, reservation: first.reservation })
  await denied(() => db.budgetReserve('alice', 'first', 'd'.repeat(64), firstQuote))
  await denied(() => db.budgetReserve('alice', 'first', hash, quote(61)))
  await denied(() => db.budgetReserve('alice', 'owner-exhausted', hash, quote(11)))
  await denied(() => db.budgetReserve('bob', 'global-exhausted', hash, quote(41)))
  assert.equal(await db.budgetGet('bob', 'first'), null)
  await denied(() => db.budgetTransition('bob', 'first', 1, 'dispatch'))
  const second = await db.budgetReserve('bob', 'second', hash, quote(40))
  assert.equal(second.reserved, true)
  assert.deepEqual(await db.budgetSummary('bob'), { currency: 'USD', limitMicros: 70, heldMicros: 40, settledMicros: 0, overageBlocked: false, unreconciledCount: 1 })
  await db.budgetConfigure('USD', 'alice', 99, 70)
  await denied(() => db.budgetTransition('alice', 'first', 1, 'dispatch'))
  await db.budgetConfigure('USD', 'alice', 100, 59)
  await denied(() => db.budgetTransition('alice', 'first', 1, 'dispatch'))
  assert.equal((await db.budgetGet('alice', 'first')).revision, 1)
  await db.budgetConfigure('USD', 'alice', 100, 70)
  await db.budgetTransition('alice', 'first', 1, 'dispatch')
  await denied(() => db.budgetTransition('alice', 'first', 1, 'cancel'))
  await db.budgetTransition('alice', 'first', 2, 'unknown')
  const cancelledInflight = await db.budgetTransition('alice', 'first', 3, 'cancel')
  assert.equal(cancelledInflight.status, 'dispatch_unknown')
  assert.equal(cancelledInflight.cancellationRequested, true)
  await denied(() => db.budgetReserve('alice', 'still-held', hash, quote(1)))
  await denied(() => db.budgetTransition('alice', 'first', 4, 'dispatch'))
  await db.budgetTransition('alice', 'first', 4, 'settle', 20)
  const cancelBeforeDispatch = await db.budgetTransition('bob', 'second', 1, 'cancel')
  assert.equal(cancelBeforeDispatch.status, 'cancelled')
  await denied(() => db.budgetTransition('bob', 'second', 2, 'dispatch'))
  const attempts = await Promise.allSettled(['race-a', 'race-b'].map(id => Promise.resolve().then(() => db.budgetReserve('alice', id, hash, quote(30)))))
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(result => result.status === 'rejected' && blocked(result.reason)).length, 1)
  // Persistent storage retains capacity even when no query/generation job exists.
  await db.budgetReserve('bob', 'storage', hash, quote(50, 'storage'))
  await denied(() => db.budgetReserve('bob', 'storage-still-held', hash, quote(1)))
  await db.budgetTransition('bob', 'storage', 1, 'dispatch')
  const overage = await db.budgetTransition('bob', 'storage', 2, 'settle', 51)
  assert.equal(overage.overage, true)
  assert.equal(overage.actualMicros, 51)
  assert.deepEqual(await db.budgetSummary('bob'), { currency: 'USD', limitMicros: 70, heldMicros: 0, settledMicros: 51, overageBlocked: true, unreconciledCount: 0 })
  await denied(() => db.budgetTransition('alice', 'free', 1, 'dispatch'))
  await denied(() => db.budgetReserve('alice', 'overage-freeze', hash, quote(0)))
  await db.budgetConfigure('USD', 'alice', 1000, 1000)
  await denied(() => db.budgetReserve('alice', 'raising-limit-does-not-clear-overage', hash, quote(1)))
  await denied(() => db.budgetReserve('alice', 'other-currency', hash, { ...quote(1), currency: 'INR' }))
}

test('SQLite monetary ledger enforces global+owner admission, cancellation, reconciliation and persistent costs', async () => {
  const db = createRepository(':memory:')
  try { await contract(db) } finally { db.close() }
})

test('PostgreSQL monetary ledger matches SQLite and rejects browser access', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;')
    const migration = await readFile(new URL('../../supabase/migrations/006_budget.sql', import.meta.url), 'utf8')
    await db.exec(migration); await db.exec(migration)
    await db.exec('set role service_role')
    const call = async (operation, args) => (await db.query('select public.signal_budget($1,$2::jsonb) value', [operation, JSON.stringify(args)])).rows[0].value
    await contract({
      budgetConfigure: (currency, owner, globalLimitMicros, ownerLimitMicros) => call('configure', { currency, owner, globalLimitMicros, ownerLimitMicros }),
      budgetGet: (owner, requestId) => call('get', { owner, requestId }),
      budgetSummary: (owner, currency = 'USD') => call('summary', { owner, currency }),
      budgetReserve: (owner, requestId, scopeHash, quote) => call('reserve', { owner, requestId, scopeHash, quote }),
      budgetTransition: (owner, requestId, expectedRevision, action, actualMicros) => call('transition', { owner, requestId, expectedRevision, action, actualMicros }),
    })
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      for (const operation of ['get', 'summary', 'reserve', 'transition', 'configure']) await assert.rejects(call(operation, { owner: 'alice', requestId: 'first' }), error => error.code === '42501')
      await assert.rejects(db.query('select * from public.signal_budget_reservations'), error => error.code === '42501')
      await assert.rejects(db.query('select * from public.signal_budget_limits'), error => error.code === '42501')
    }
  } finally { await db.close() }
})

test('unknown prices, unsafe amounts and stale or mismatched credit eligibility fail closed before admission', async () => {
  for (const amount of [undefined, null, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => validateQuote({ ...quote(0), upperBoundMicros: amount }), blocked)
  assert.throws(() => validateQuote({ ...quote(0), priceVersion: '' }), blocked)
  assert.throws(() => validateQuote({ ...quote(0), priceExpiresAt: '2020-01-01T00:00:00Z' }), blocked)
  assert.throws(() => validateQuote({ ...quote(0), credit: null }), blocked)
  const requested = { grantId: 'grant', billingAccount: 'account', projectId: 'project', service: 'search', sku: 'standard', region: 'global', currency: 'USD' }
  const confirmed = { ...requested, status: 'verified', expiresAt: '2099-01-01T00:00:00Z', verifiedUntil: '2099-01-01T00:00:00Z' }
  verifyCreditEligibility(requested, confirmed)
  for (const altered of [undefined, { ...confirmed, sku: 'other' }, { ...confirmed, verifiedUntil: '2020-01-01T00:00:00Z' }, { ...confirmed, expiresAt: '2020-01-01T00:00:00Z' }, { ...confirmed, status: 'assumed' }]) assert.throws(() => verifyCreditEligibility(requested, altered), blocked)
  let calls = 0
  await assert.rejects(reserveCost({ budgetReserve: () => { calls++ } }, { owner: 'alice', requestId: 'credit', scope: {}, quote: { ...quote(0), credit: requested } }), blocked)
  assert.equal(calls, 0)
})
