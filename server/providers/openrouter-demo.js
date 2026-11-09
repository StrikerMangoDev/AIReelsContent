import { env } from '../config/env.js'
import { reserveCost, budgetError, MAX_MICROS } from '../budget/policy.js'

export const openRouterDemoModel = 'google/gemini-3.8-flash'
export const openRouterDemoCallUpperBoundMicros = Math.ceil(1048576 * 0.825 + 65536 * 2 * 4.125)

export async function generateOpenRouterDemoJson(input, { repository, owner, requestId, beforeAttempt, priceExpiresAt, config = env, request = fetch }) {
  if (!config.OPENROUTER_API_KEY) throw Object.assign(budgetError('The approved OpenRouter demonstration key is unavailable.'), { preDispatch: true, configurationFailure: true })
  const maxTokens = Math.min(input.maxTokens || 6000, 8000)
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || Buffer.byteLength(JSON.stringify(input)) > 200000) throw Object.assign(budgetError('The OpenRouter demonstration request exceeds its bounded scope.'), { preDispatch: true })
  const { reservation, reserved } = await reserveCost(repository, { owner, requestId, scope: { provider: 'openrouter', model: openRouterDemoModel, input }, quote: { currency: 'USD', upperBoundMicros: openRouterDemoCallUpperBoundMicros, priceVersion: 'openrouter-gemini-3.8-flash-2026-11-09', priceExpiresAt, kind: 'generation' } })
  if (!reserved) throw Object.assign(budgetError('This paid demonstration attempt already exists; reconcile it before another dispatch.'), { preDispatch: true })
  let cost = reservation
  try {
    if (beforeAttempt) await beforeAttempt()
    cost = await repository.budgetTransition(owner, requestId, cost.revision, 'dispatch')
    const response = await request('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(110000), headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
      model: openRouterDemoModel, messages: [{ role: 'system', content: input.system }, { role: 'user', content: JSON.stringify(input.input) }],
      response_format: { type: 'json_schema', json_schema: { name: 'demo_result', strict: true, schema: input.schema } }, max_tokens: maxTokens, temperature: 0.2, plugins: [], tools: [], tool_choice: 'none',
      provider: { require_parameters: true, allow_fallbacks: false, max_price: { prompt: 0.825, completion: 4.125, request: 0 } },
    }) })
    if (!response.ok) throw Object.assign(new Error('Paid demonstration provider rejected the request.'), { code: 'MODEL_HTTP_ERROR', status: response.status })
    const result = await response.json()
    const matching = result.model === openRouterDemoModel && typeof result.id === 'string' && /^gen-[A-Za-z0-9-]{1,100}$/.test(result.id)
    const dollars = result.usage?.cost
    const micros = typeof dollars === 'number' ? Math.ceil(dollars * 1000000) : NaN
    let billedMicros = matching && Object.hasOwn(result.usage || {}, 'cost') && result.usage.is_byok === false && Number.isFinite(dollars) && dollars >= 0 && Number.isSafeInteger(micros) && micros >= 0 && micros <= MAX_MICROS ? micros : null
    if (matching && result.usage?.is_byok === undefined) {
      try {
        const receipt = await request(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(result.id)}`, { method: 'GET', headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(15000) })
        if (receipt.ok) {
          const { data } = await receipt.json(); const reportedMicros = typeof data?.total_cost === 'number' ? Math.ceil(data.total_cost * 1000000) : NaN
          if (data?.id === result.id && data.model === openRouterDemoModel && data.cancelled === false && data.is_byok === false && Number.isFinite(data.total_cost) && data.total_cost >= 0 && Number.isSafeInteger(reportedMicros) && reportedMicros <= MAX_MICROS) billedMicros = reportedMicros
        }
      } catch { /* One readback failure retains the full reservation; it never repeats generation. */ }
    }
    if (billedMicros !== null) cost = await repository.budgetTransition(owner, requestId, cost.revision, 'settle', billedMicros)
    else cost = await repository.budgetTransition(owner, requestId, cost.revision, 'unknown')
    if (!matching) throw Object.assign(budgetError('The demonstration response does not match the authorized model receipt.'), { configurationFailure: true })
    if (cost.overage) throw budgetError('A provider-reported overage blocks further demonstration work.')
    if (result.error) throw Object.assign(new Error('Paid demonstration provider returned an error.'), { code: 'MODEL_HTTP_ERROR', ...(Number.isInteger(result.error.code) && result.error.code >= 400 && result.error.code <= 599 ? { status: result.error.code } : {}) })
    const choice = result.choices?.[0]
    if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) throw Object.assign(new Error('Paid demonstration output was incomplete.'), { code: 'MODEL_INCOMPLETE', generationId: result.id })
    try { const data = JSON.parse(choice.message.content); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not an object'); return data }
    catch { throw Object.assign(new Error('Paid demonstration output was not a complete JSON object.'), { code: 'MODEL_JSON_INVALID', generationId: result.id }) }
  } catch (error) {
    if (cost.status === 'dispatched') await repository.budgetTransition(owner, requestId, cost.revision, 'unknown')
    else if (cost.status === 'reserved') await repository.budgetTransition(owner, requestId, cost.revision, 'cancel')
    if (['BUDGET_BLOCKED', 'MODEL_HTTP_ERROR', 'MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code)) throw error
    throw Object.assign(new Error('Paid demonstration outcome is unknown; its reserved charge remains protected.'), { code: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'MODEL_TIMEOUT' : 'JOB_FAILED' })
  }
}
