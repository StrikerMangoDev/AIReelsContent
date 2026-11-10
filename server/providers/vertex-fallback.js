import { readFileSync } from 'node:fs'
import { env } from '../config/env.js'
import { reserveCost, budgetError } from '../budget/policy.js'
// Full documented model context plus two full output/thinking allowances, not expected request usage.
export const vertexDemoCallUpperBoundMicros = Math.ceil(1048576 * 0.75 + 65536 * 2 * 3.75)
export const vertexProductionProject = 'cs-project-bvfzp2zn'
export const vertexWifAudience = 'https://iam.googleapis.com/projects/487106620228/locations/global/workloadIdentityPools/aireels-vercel/providers/aireels-prod'
export const vertexWifServiceAccount = 'aireels-vertex@cs-project-bvfzp2zn.iam.gserviceaccount.com'
const wifConfigured = config => config.VERTEX_FALLBACK_PROJECT === vertexProductionProject && config.VERTEX_WIF_AUDIENCE === vertexWifAudience && config.VERTEX_WIF_SERVICE_ACCOUNT === vertexWifServiceAccount

export function vertexFallbackAllowed(config = env) {
  return config.CONTENT_VERTEX_FALLBACK === 'true' && config.VERTEX_FALLBACK_MODEL === 'gemini-3.8-flash' && Boolean(config.VERTEX_FALLBACK_PROJECT === vertexProductionProject ? wifConfigured(config) : config.VERTEX_FALLBACK_PROJECT && (config.VERTEX_FALLBACK_CREDENTIALS || config.GOOGLE_SERVICE_ACCOUNT_JSON)) && Date.parse(config.VERTEX_FALLBACK_APPROVED_UNTIL || '') > Date.now() && Date.now() < Date.parse('2027-01-01T00:00:00Z')
}

export function vertexSchema(schema) {
  if (Array.isArray(schema)) return schema.map(vertexSchema)
  if (!schema || typeof schema !== 'object') return schema
  // Provider grammar limits differ; the complete original schema is still validated by the server.
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !['$schema', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'default'].includes(key)).map(([key, value]) => key === 'const' ? ['enum', [value]] : [key, vertexSchema(value)]))
}

function vertexCredentials(config) {
  try {
    const credentials = JSON.parse(config.VERTEX_FALLBACK_CREDENTIALS ? readFileSync(config.VERTEX_FALLBACK_CREDENTIALS, 'utf8') : config.GOOGLE_SERVICE_ACCOUNT_JSON)
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || credentials.type !== 'service_account' || credentials.project_id !== config.VERTEX_FALLBACK_PROJECT || typeof credentials.client_email !== 'string' || !credentials.client_email || typeof credentials.private_key !== 'string' || !credentials.private_key) throw new Error('Invalid credentials')
    return credentials
  } catch { throw Object.assign(budgetError('The approved Vertex project credentials are unavailable or do not match.'), { preDispatch: true, configurationFailure: true }) }
}

export async function vertexGoogleAuthOptions(config, dependencies = {}) {
  if (config.VERTEX_FALLBACK_PROJECT !== vertexProductionProject) {
    if (config.VERTEX_WIF_AUDIENCE || config.VERTEX_WIF_SERVICE_ACCOUNT) throw Object.assign(budgetError('Production federation cannot target another project.'), { preDispatch: true, configurationFailure: true })
    return { credentials: vertexCredentials(config) }
  }
  if (!wifConfigured(config)) throw Object.assign(budgetError('The production federation audience or service account does not match its approval.'), { preDispatch: true, configurationFailure: true })
  try {
    const { ExternalAccountClient } = dependencies.ExternalAccountClient ? dependencies : await import('google-auth-library')
    const { getVercelOidcToken } = dependencies.getVercelOidcToken ? dependencies : await import('@vercel/functions/oidc')
    const authClient = ExternalAccountClient.fromJSON({
      type: 'external_account', audience: vertexWifAudience, subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', token_url: 'https://sts.googleapis.com/v1/token', scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${vertexWifServiceAccount}:generateAccessToken`,
      subject_token_supplier: { getSubjectToken: () => getVercelOidcToken({ audience: vertexWifAudience }) },
    })
    const access = await authClient?.getAccessToken()
    if (typeof access?.token !== 'string' || !access.token) throw new Error('No access token')
    return { authClient, projectId: vertexProductionProject }
  } catch { throw Object.assign(budgetError('Production federation authentication failed before inference admission.'), { preDispatch: true, configurationFailure: true }) }
}

async function callVertex(request, config, googleAuthOptions, timeoutMs = 180000) {
  const { GoogleGenAI } = await import('@google/genai')
  // The SDK also sends this as X-Server-Timeout; allow structured generation to finish without automatic retries.
  const client = new GoogleGenAI({ vertexai: true, project: config.VERTEX_FALLBACK_PROJECT, location: 'global', googleAuthOptions, httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } } })
  return client.models.generateContent({ model: config.VERTEX_FALLBACK_MODEL, contents: JSON.stringify(request.input), config: { systemInstruction: request.system, responseMimeType: 'application/json', responseJsonSchema: vertexSchema(request.schema), maxOutputTokens: request.maxTokens, thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false } } })
}

export async function generateVertexJson(input, { repository, owner, requestId, beforeAttempt, kind = 'generation', config = env, request = callVertex, worstCaseModelBound = false, timeoutMs = 180000, authenticate }) {
  if (!vertexFallbackAllowed(config)) throw budgetError('Vertex fallback is not authorized or its test approval expired')
  const maxTokens = Math.min(input.maxTokens || 6000, 8000)
  const bytes = Buffer.byteLength(JSON.stringify(input))
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 12000 || bytes > 200000 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) throw budgetError('Fallback request exceeds the bounded test scope')
  const googleAuthOptions = request === callVertex || authenticate ? await (authenticate || vertexGoogleAuthOptions)(config) : undefined
  // Verified global introductory rates through 2026-12-31; allow extra output headroom for thinking.
  const upperBoundMicros = worstCaseModelBound ? vertexDemoCallUpperBoundMicros : Math.ceil((bytes + 4096) * 0.75 + maxTokens * 2 * 3.75)
  const { reservation, reserved } = await reserveCost(repository, { owner, requestId, scope: { provider: 'vertex', project: config.VERTEX_FALLBACK_PROJECT, model: config.VERTEX_FALLBACK_MODEL, input }, quote: { currency: 'USD', upperBoundMicros, priceVersion: 'gemini-3.8-flash-global-2026-10-29', priceExpiresAt: new Date(Math.min(Date.parse(config.VERTEX_FALLBACK_APPROVED_UNTIL), Date.parse('2027-01-01T00:00:00Z'))).toISOString(), kind } })
  if (!reserved) throw budgetError('This fallback attempt already exists; reconcile it before another dispatch')
  let cost = reservation
  try {
    if (beforeAttempt) await beforeAttempt()
    cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'dispatch')
    const response = await request({ ...input, maxTokens }, config, googleAuthOptions, timeoutMs)
    const usage = response.usageMetadata
    const counts = [usage?.promptTokenCount, usage?.candidatesTokenCount, usage?.thoughtsTokenCount ?? 0]
    if (counts.every(value => Number.isSafeInteger(value) && value >= 0)) {
      cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'settle', Math.ceil(counts[0] * 0.75 + (counts[1] + counts[2]) * 3.75))
    } else {
      cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'unknown')
    }
    if (response.candidates?.[0]?.finishReason !== 'STOP' || !response.text?.trim()) throw Object.assign(new Error('Vertex fallback did not return complete content'), { code: 'MODEL_INCOMPLETE' })
    try { return JSON.parse(response.text) } catch { throw Object.assign(new Error('Vertex fallback returned invalid JSON'), { code: 'MODEL_JSON_INVALID' }) }
  } catch (error) {
    // Google documents no token charge for a confirmed HTTP 400 rejection; ambiguous outcomes stay held.
    if (cost.status === 'dispatched' && error.status === 400) await repository.budgetTransition(owner, cost.id, cost.revision, 'settle', 0)
    else if (cost.status === 'dispatched') await repository.budgetTransition(owner, cost.id, cost.revision, 'unknown')
    else if (cost.status === 'reserved') await repository.budgetTransition(owner, cost.id, cost.revision, 'cancel')
    if (error.code === 'BUDGET_BLOCKED' || ['MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code)) throw error
    throw Object.assign(new Error('Vertex fallback request failed; the reserved cost remains protected'), { code: 'VERTEX_REQUEST_FAILED', status: Number.isInteger(error.status) ? error.status : undefined })
  }
}
