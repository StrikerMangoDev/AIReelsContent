import { env } from '../config/env.js'
import { assertCapability } from '../policy.js'
import { z } from 'zod'

const receipts = new WeakMap()
const tokenCount = z.number().int().min(0).max(1000000000)
export const providerReceiptSchema = z.object({ method: z.literal('native-json-complete-at-length-v1'), model: z.string().regex(/^nvidia\/[a-z0-9.-]+:free$/), generationId: z.string().regex(/^gen-[A-Za-z0-9-]{1,100}$/), finishReason: z.literal('length'), transportStatus: z.literal(200), acceptedCompleteJsonAtLength: z.literal(true), schemaValidated: z.boolean(), billingVerified: z.literal(false), receivedAt: z.string().datetime(), promptTokens: tokenCount.optional(), completionTokens: tokenCount.optional(), reasoningTokens: tokenCount.optional(), outputChars: z.number().int().min(0).max(10000000), outputNonWhitespaceChars: z.number().int().min(0).max(10000000), startsSchemaDefinition: z.literal(false), wholeJsonObject: z.boolean().optional(), fullFence: z.boolean().optional(), missingExpectedFieldCount: z.number().int().min(0).max(1000).optional(), extraFieldCount: z.number().int().min(0).max(1000).optional(), providerReportedCost: z.number().min(0).max(1000000).optional() }).strict()
export const generationReceipt = value => receipts.get(value)
export function retainGenerationReceipt(target, source) {
  const receipt = generationReceipt(source)
  if (receipt) receipts.set(target, Object.freeze({ ...receipt, schemaValidated: true }))
  return target
}

export async function readFreeGenerationReceipt(id, { config = env, request = fetch } = {}) {
  assertCapability('generation', config)
  if (!/^gen-[A-Za-z0-9-]{1,100}$/.test(id) || !config.OPENROUTER_API_KEY) throw new Error('Generation receipt is unavailable')
  const response = await request(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('Generation receipt is unavailable')
  const { data } = await response.json()
  if (data?.id !== id || !/^nvidia\/[a-z0-9.-]+:free$/.test(data.model || '') || data.total_cost !== 0 || data.cancelled !== false || !['length', 'error', 'stop', 'tool_calls'].includes(data.native_finish_reason || data.finish_reason)) throw new Error('Generation receipt is not verified')
  return { generationId: id, actualMicros: 0, finishReason: data.native_finish_reason || data.finish_reason, checkedAt: new Date().toISOString() }
}

// This free adapter never routes to paid models; separately approved Vertex calls use the monetary ledger.
export async function generateJson({ system, input, schema, maxTokens = 8000 }, { config = env, request = fetch, acceptCompleteJsonAtLength = false, preferTools = false } = {}) {
  assertCapability('generation', config)
  if (!config.OPENROUTER_API_KEY) throw new Error('Free generation provider is not configured')
  if (!/^nvidia\/[a-z0-9.-]+:free$/.test(config.LLM_MODEL)) throw new Error('Only free NVIDIA models are allowed')
  const nativeJson = config.LLM_MODEL === 'nvidia/nemotron-3.5-super-vl:free' && preferTools !== true
  const timeoutMs = maxTokens > 3000 ? 180000 : 90000
  const signal = AbortSignal.timeout(timeoutMs)
  const timeoutError = () => Object.assign(new Error('Free model request exceeded its time limit'), { name: 'TimeoutError', code: 'MODEL_TIMEOUT' })
  let response
  try { response = await request('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.LLM_MODEL,
      messages: [{ role: 'system', content: `${system}\nReturn a JSON DATA INSTANCE, never the JSON Schema itself. The top-level data keys are: ${Object.keys(schema.properties || {}).join(", ") || "as specified below"}. Fill these fields with actual requested content. ${nativeJson ? 'Return the populated JSON object directly.' : 'Submit the populated data through submit_json.'} Do not return schema-definition keys such as $schema, type, properties, required or additionalProperties.` }, { role: 'user', content: JSON.stringify(input) }],
      ...(nativeJson ? { response_format: { type: 'json_schema', json_schema: { name: 'content_result', strict: true, schema } } } : {
        tools: [{ type: 'function', function: { name: 'submit_json', description: 'Submit the requested structured result. This does not execute an external action.', parameters: schema, ...(preferTools === true ? { strict: true } : {}) } }],
        tool_choice: { type: 'function', function: { name: 'submit_json' } },
      }),
      temperature: 0.2, max_tokens: maxTokens, reasoning: { enabled: false, effort: 'none' },
      provider: { require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } },
    }),
  }) } catch (error) {
    if (signal.aborted || error?.name === 'TimeoutError') throw timeoutError()
    throw error
  }
  if (!response.ok) throw Object.assign(new Error(`Free model request failed (${response.status})`), { code: 'MODEL_HTTP_ERROR', status: response.status })
  let result
  try { result = await response.json() }
  catch (error) { if (signal.aborted || error?.name === 'TimeoutError') throw timeoutError(); throw error }
  const choice = result.choices?.[0]
  const receipt = {
    ...(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? { transportStatus: response.status } : {}),
    ...(Number.isInteger(result.error?.code) && result.error.code >= 400 && result.error.code <= 599 ? { providerErrorCode: result.error.code } : {}),
    ...(typeof result.id === 'string' && /^gen-[A-Za-z0-9-]{1,100}$/.test(result.id) ? { generationId: result.id } : {}),
    ...(['stop', 'length', 'content_filter', 'tool_calls', 'error'].includes(choice?.finish_reason) ? { finishReason: choice.finish_reason } : {}),
  }
  const calls = choice?.message?.tool_calls
  const expectedCall = calls?.length === 1 && (calls[0].type === undefined || calls[0].type === 'function') && calls[0].function?.name === 'submit_json'
  const submitted = expectedCall ? calls[0].function.arguments : undefined
  const argumentsJson = submitted && typeof submitted === 'object' && !Array.isArray(submitted) ? JSON.stringify(submitted) : submitted
  const diagnosticOutput = typeof choice?.message?.content === 'string' ? choice.message.content : typeof argumentsJson === 'string' ? argumentsJson : ''
  let completeObject
  try { const parsed = JSON.parse(diagnosticOutput); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) completeObject = parsed } catch { /* Shape diagnostics never repair or retain model text. */ }
  const expectedKeys = Object.keys(schema.properties || {})
  const diagnostics = {
    ...Object.fromEntries([['promptTokens', result.usage?.prompt_tokens], ['completionTokens', result.usage?.completion_tokens], ['reasoningTokens', result.usage?.completion_tokens_details?.reasoning_tokens]].filter(([, value]) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000)),
    outputChars: Math.min(diagnosticOutput.length, 10000000), outputNonWhitespaceChars: Math.min(diagnosticOutput.replace(/\s/g, '').length, 10000000),
    startsSchemaDefinition: /^\s*\{\s*"(?:\$schema|type|properties|additionalProperties)"\s*:/.test(diagnosticOutput),
    wholeJsonObject: Boolean(completeObject), fullFence: /^\s*```(?:json)?\s*\n[\s\S]*\n```\s*$/i.test(diagnosticOutput),
    ...(completeObject ? { missingExpectedFieldCount: Math.min(expectedKeys.filter(key => !Object.hasOwn(completeObject, key)).length, 1000), extraFieldCount: Math.min(Object.keys(completeObject).filter(key => !expectedKeys.includes(key)).length, 1000) } : {}),
    ...(typeof result.usage?.cost === 'number' && Number.isFinite(result.usage.cost) && result.usage.cost >= 0 && result.usage.cost <= 1000000 ? { providerReportedCost: result.usage.cost } : {}),
  }
  if (acceptCompleteJsonAtLength === true && nativeJson && choice?.finish_reason === 'length' && !result.error && !calls?.length && typeof choice?.message?.content === 'string' && receipt.generationId && receipt.transportStatus === 200 && !diagnostics.startsSchemaDefinition) {
    try {
      const data = JSON.parse(choice.message.content)
      const keys = Object.keys(schema.properties || {}).sort()
      if (data && typeof data === 'object' && !Array.isArray(data) && keys.length && keys.every(key => !['$schema', 'type', 'properties', 'required', 'additionalProperties'].includes(key)) && JSON.stringify(Object.keys(data).sort()) === JSON.stringify(keys)) {
        const audit = providerReceiptSchema.parse({ ...receipt, ...diagnostics, method: 'native-json-complete-at-length-v1', model: config.LLM_MODEL, acceptedCompleteJsonAtLength: true, schemaValidated: false, billingVerified: false, receivedAt: new Date().toISOString() })
        receipts.set(data, Object.freeze(audit))
        return data
      }
    } catch { /* Partial JSON, trailing prose and invalid receipt metadata remain rejected. */ }
  }
  const output = choice?.finish_reason === 'stop' || (choice?.finish_reason === 'tool_calls' && !calls?.length) ? choice?.message?.content : choice?.finish_reason === 'tool_calls' ? argumentsJson : undefined
  if (result.error || typeof output !== 'string' || !output.trim()) throw Object.assign(new Error('Free model returned incomplete content'), { code: 'MODEL_INCOMPLETE', ...receipt, ...diagnostics, toolCallCount: Array.isArray(calls) ? calls.length : 0, expectedTool: Boolean(expectedCall), argumentKind: typeof submitted })
  const raw = output.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(raw)
  try { return JSON.parse(fenced ? fenced[1] : raw) }
  catch { throw Object.assign(new SyntaxError('Model output was not valid JSON'), { code: 'MODEL_JSON_INVALID', ...receipt, outputKind: raw.startsWith('```') ? 'fenced' : raw.startsWith('{') ? 'object' : 'other' }) }
}
