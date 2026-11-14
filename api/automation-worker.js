import { QueueClient } from '@vercel/queue'
import { z } from 'zod'
import { env } from '../server/config/env.js'
import { automationRegistryOwner } from '../server/automation/runner.js'
import { executeAccountAutomation } from '../server/automation/services.js'
import { automationReference } from './automation.js'

const messageSchema = automationReference.extend({ enqueuedAt: z.string().datetime() }).strict()
const lifetimeMs = 86400000
const maxDeliveries = 96

export function automationQueueRetry(error, metadata) {
  if (!Number.isInteger(metadata?.deliveryCount) || metadata.deliveryCount >= maxDeliveries) {
    console.error(JSON.stringify({ event: 'automation_queue_delivery_exhausted' }))
    return { acknowledge: true }
  }
  return { afterSeconds: Number.isFinite(error?.retryAfterMs) ? Math.max(1, Math.min(300, Math.ceil(error.retryAfterMs / 1000))) : 30 }
}

export function createAutomationConsumer({ repository, execute = executeAccountAutomation, config = env, now = Date.now }) {
  return async (message, metadata) => {
    const parsed = messageSchema.safeParse(message)
    if (!parsed.success || config.CONTENT_ACCOUNT_AUTOMATION !== 'true') return
    const input = parsed.data
    const age = now() - Date.parse(input.enqueuedAt)
    if (age < 0 || age >= lifetimeMs || !Number.isInteger(metadata?.deliveryCount) || metadata.deliveryCount > maxDeliveries) return
    const registry = await repository.studioGet(automationRegistryOwner, 'automation_owner', input.owner)
    const profile = await repository.studioGet(input.owner, 'account_profile', input.profileId)
    if (!registry?.enabled || !profile?.enabled || !profile.automationConsent) return
    const outcome = await execute({ repository, owner: input.owner, profileId: input.profileId, requestId: input.requestId })
    if (outcome.deferred || outcome.continuationPending === true) throw Object.assign(new Error('Saved automation requires another bounded stage or receipt check.'), { retryAfterMs: outcome.continuationPending === true ? 30000 : Number.isFinite(outcome.retryAfterMs) && outcome.retryAfterMs > 0 ? outcome.retryAfterMs : 1000 })
  }
}

let consumer
export default new QueueClient().handleNodeCallback(async (message, metadata) => {
  if (!consumer) { const { repository } = await import('../server/storage/index.js'); consumer = createAutomationConsumer({ repository }) }
  await consumer(message, metadata)
}, { visibilityTimeoutSeconds: 300, retry: automationQueueRetry })
