import { env } from '../config/env.js'

// Intentionally no paid or Google fallback. A quota/capacity error stops the request.
export async function generateJson({ system, input, schema, maxTokens = 8000 }, { config = env, request = fetch } = {}) {
  if (!config.OPENROUTER_API_KEY) throw new Error('Free generation provider is not configured')
  if (!/^nvidia\/[a-z0-9.-]+:free$/.test(config.LLM_MODEL)) throw new Error('Only free NVIDIA models are allowed')
  const response = await request('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.LLM_MODEL,
      messages: [{ role: 'system', content: `${system}\nReturn one compact JSON object matching this schema exactly: ${JSON.stringify(schema)}` }, { role: 'user', content: JSON.stringify(input) }],
      temperature: 0.2, max_tokens: maxTokens, reasoning: { enabled: false },
      response_format: { type: 'json_object' },
      provider: { require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } },
    }),
  })
  if (!response.ok) throw Object.assign(new Error(`Free model request failed (${response.status})`), { status: response.status })
  const result = await response.json()
  const choice = result.choices?.[0]
  if (result.error || choice?.finish_reason !== 'stop' || !choice.message?.content) throw new Error('Free model returned incomplete content')
  return JSON.parse(choice.message.content)
}
