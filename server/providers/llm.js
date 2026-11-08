import { env } from '../config/env.js'
import { assertCapability } from '../policy.js'

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
export async function generateJson({ system, input, schema, maxTokens = 8000 }, { config = env, request = fetch } = {}) {
  assertCapability('generation', config)
  if (!config.OPENROUTER_API_KEY) throw new Error('Free generation provider is not configured')
  if (!/^nvidia\/[a-z0-9.-]+:free$/.test(config.LLM_MODEL)) throw new Error('Only free NVIDIA models are allowed')
  const nativeJson = config.LLM_MODEL === 'nvidia/nemotron-3.5-super-vl:free'
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
        tools: [{ type: 'function', function: { name: 'submit_json', description: 'Submit the requested structured result. This does not execute an external action.', parameters: schema } }],
        tool_choice: { type: 'function', function: { name: 'submit_json' } },
      }),
      temperature: 0.2, max_tokens: maxTokens, reasoning: { enabled: false },
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
  const output = choice?.finish_reason === 'stop' || (choice?.finish_reason === 'tool_calls' && !calls?.length) ? choice?.message?.content : choice?.finish_reason === 'tool_calls' ? argumentsJson : undefined
  if (result.error || typeof output !== 'string' || !output.trim()) throw Object.assign(new Error('Free model returned incomplete content'), { code: 'MODEL_INCOMPLETE', ...receipt, toolCallCount: Array.isArray(calls) ? calls.length : 0, expectedTool: Boolean(expectedCall), argumentKind: typeof submitted })
  const raw = output.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(raw)
  try { return JSON.parse(fenced ? fenced[1] : raw) }
  catch { throw Object.assign(new SyntaxError('Model output was not valid JSON'), { code: 'MODEL_JSON_INVALID', ...receipt, outputKind: raw.startsWith('```') ? 'fenced' : raw.startsWith('{') ? 'object' : 'other' }) }
}
