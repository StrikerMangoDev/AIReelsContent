import { reserveCost } from './policy.js'

export async function reserveFreeOperation(repository, owner, requestId, scope) {
  const { reservation } = await reserveCost(repository, {
    owner, requestId, scope,
    quote: { currency: 'USD', upperBoundMicros: 0, priceVersion: 'enforced-provider-max-price-zero-v1', priceExpiresAt: new Date(Date.now() + 300000).toISOString(), kind: scope.operation },
  })
  return reservation
}

// A zero provider price ceiling is not a billing receipt. Settle only from reconciled usage.
export async function dispatchFreeOperation(repository, owner, reservation) {
  return repository.budgetTransition(owner, reservation.id, reservation.revision, 'dispatch')
}
