import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env.js'
import { reserveCost, budgetError } from '../budget/policy.js'

const operation = new AsyncLocalStorage()
export const openaiConfigured = (config = env) => config.CONTENT_TEXT_PROVIDER === 'openai' && Boolean(config.OPENAI_API_KEY) && config.OPENAI_MODEL === 'gpt-6-luna'
export const withModelBudget = (scope, run) => operation.run({ ...scope, sequence: 0 }, run)

// Optional schema fields become nullable for OpenAI's all-fields-required grammar.
export function strictOpenAISchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictOpenAISchema)
  if (!schema || typeof schema !== 'object') return schema
  const result = Object.fromEntries(Object.entries(schema).filter(([key]) => !['$schema', 'default'].includes(key)).map(([key, value]) => [key, strictOpenAISchema(value)]))
  if (result.oneOf) { result.anyOf = result.oneOf; delete result.oneOf }
  if (schema.type === 'object') {
    if (schema.additionalProperties && schema.additionalProperties !== false) throw budgetError('Dynamic object schemas need an explicit structured-output mapping')
    result.additionalProperties = false
    result.properties = Object.fromEntries(Object.entries(schema.properties || {}).map(([key, value]) => [key, (schema.required || []).includes(key) ? strictOpenAISchema(value) : { anyOf: [strictOpenAISchema(value), { type: 'null' }] }]))
    result.required = Object.keys(result.properties)
  }
  return result
}

export function restoreOptionalFields(value, schema, root = schema) {
  if (schema?.$ref?.startsWith('#/')) return restoreOptionalFields(value, schema.$ref.slice(2).split('/').reduce((node, key) => node?.[key], root), root)
  if (Array.isArray(value)) return value.map(item => restoreOptionalFields(item, schema?.items, root))
  if (!value || typeof value !== 'object') return value
  const variant = (schema?.anyOf || schema?.oneOf)?.find(item => item.type === 'object' && Object.entries(item.properties || {}).every(([key, field]) => field.const === undefined || value[key] === field.const))
  if (variant) return restoreOptionalFields(value, variant, root)
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== null || !schema?.properties?.[key] || (schema.required || []).includes(key)).map(([key, item]) => [key, restoreOptionalFields(item, schema?.properties?.[key], root)]))
}

export async function generateOpenAIJson(input, { config = env, request = fetch, scope = operation.getStore() } = {}) {
  if (!openaiConfigured(config)) throw budgetError('The approved OpenAI text provider is not configured')
  if (!scope?.repository || !scope.owner || scope.allowPaid === false) throw budgetError('OpenAI requires an authenticated paid-budget operation; free-only automation stays blocked')
  const maxTokens = input.maxTokens || 8000
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 20000) throw budgetError('OpenAI output exceeds the existing bounded scope')
  const body = { model: config.OPENAI_MODEL, store: false, service_tier: 'default', instructions: input.system, input: JSON.stringify(input.input), reasoning: { effort: 'none' }, text: { verbosity: 'medium', format: { type: 'json_schema', name: 'content_result', strict: true, schema: strictOpenAISchema(input.schema) } }, max_output_tokens: maxTokens }
  const bytes = Buffer.byteLength(JSON.stringify(body))
  // Bytes conservatively bound token count below the 272K-token long-context pricing threshold.
  if (bytes > 200000) throw budgetError('OpenAI input exceeds the bounded short-context scope')
  const repository = scope.repository; const owner = scope.owner
  scope.sequence = (scope.sequence || 0) + 1
  const requestId = `openai:${scope.requestId || randomUUID()}:${scope.sequence}`
  // Reserve the highest documented cache-write rate; usage distinguishes ordinary input, reads and both write TTLs.
  const quote = { currency: 'USD', upperBoundMicros: Math.ceil((bytes + 4096) * 0.25 + maxTokens * 0.5), priceVersion: 'openai-gpt-6-luna-standard-2026-11-18', priceExpiresAt: '2026-12-16T18:39:18Z', kind: scope.kind || 'generation' }
  const { reservation, reserved } = await reserveCost(repository, { owner, requestId, scope: { provider: 'openai', model: config.OPENAI_MODEL, organization: config.OPENAI_ORGANIZATION_ID, project: config.OPENAI_PROJECT_ID, input }, quote })
  if (!reserved) throw budgetError('This OpenAI attempt is already recorded; reconcile it before retrying')
  let cost = reservation
  try {
    if (scope.beforeAttempt) await scope.beforeAttempt()
    cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'dispatch')
    const response = await request('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(maxTokens > 3000 ? 180000 : 90000), headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json', ...(config.OPENAI_ORGANIZATION_ID ? { 'OpenAI-Organization': config.OPENAI_ORGANIZATION_ID } : {}), ...(config.OPENAI_PROJECT_ID ? { 'OpenAI-Project': config.OPENAI_PROJECT_ID } : {}) }, body: JSON.stringify(body) })
    if (!response.ok) throw Object.assign(new Error(`OpenAI request failed (${response.status}); its reservation remains protected`), { code: 'MODEL_HTTP_ERROR', status: response.status })
    const result = await response.json()
    const usage = result.usage
    const cached = usage?.input_tokens_details?.cached_tokens ?? 0
    const writes = usage?.input_tokens_details?.cache_write_tokens ?? 0
    const write30m = usage?.input_tokens_details?.cache_write_tokens_details?.ttl_30m_tokens ?? 0
    const write12h = usage?.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0
    if ([usage?.input_tokens, usage?.output_tokens, cached, writes, write30m, write12h].every(value => Number.isSafeInteger(value) && value >= 0) && write30m + write12h === writes && cached + writes <= usage.input_tokens) {
      cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'settle', Math.ceil((usage.input_tokens - cached - writes) * 0.1 + cached * 0.01 + write30m * 0.125 + write12h * 0.25 + usage.output_tokens * 0.5))
    } else cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'unknown')
    const messages = result.output?.filter(item => item.type === 'message') || []
    if (result.status !== 'completed' || result.error || !/^gpt-6-luna(?:-|$)/.test(result.model || '') || messages.some(item => item.status !== 'completed' || item.content?.some(part => part.type === 'refusal'))) throw Object.assign(new Error('OpenAI did not return complete structured content'), { code: 'MODEL_INCOMPLETE', transportStatus: 200, finishReason: 'error' })
    const text = messages.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('')
    try { return restoreOptionalFields(JSON.parse(text), input.schema) }
    catch { throw Object.assign(new Error('OpenAI output was not valid JSON'), { code: 'MODEL_JSON_INVALID' }) }
  } catch (error) {
    if (cost.status === 'dispatched') await repository.budgetTransition(owner, cost.id, cost.revision, 'unknown')
    else if (cost.status === 'reserved') await repository.budgetTransition(owner, cost.id, cost.revision, 'cancel')
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw Object.assign(new Error('OpenAI request exceeded its time limit; reserved cost is preserved'), { code: 'MODEL_TIMEOUT' })
    throw error
  }
}
