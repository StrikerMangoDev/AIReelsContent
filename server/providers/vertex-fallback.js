import { readFileSync } from 'node:fs'
import { env } from '../config/env.js'
import { reserveCost, budgetError } from '../budget/policy.js'
// Full documented model context plus two full output/thinking allowances, not expected request usage.
export const vertexDemoCallUpperBoundMicros = Math.ceil(1048576 * 0.75 + 65536 * 2 * 3.75)
export const vertexProductionProject = 'cs-project-bvfzp2zn'
export const vertexWifAudience = 'https://iam.googleapis.com/projects/487106620228/locations/global/workloadIdentityPools/aireels-vercel/providers/aireels-prod'
export const vertexWifServiceAccount = 'aireels-vertex@cs-project-bvfzp2zn.iam.gserviceaccount.com'
const wifConfigured = config => config.VERTEX_FALLBACK_PROJECT === vertexProductionProject && config.VERTEX_WIF_AUDIENCE === vertexWifAudience && config.VERTEX_WIF_SERVICE_ACCOUNT === vertexWifServiceAccount
// Standard global text rates, USD per million tokens; expiry still requires a pricing refresh.
const vertexPrices = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75, version: 'gemini-3.8-flash-global-2026-10-29' },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50, version: 'gemini-3.1-flash-lite-global-2026-11-10' },
}

export function vertexFallbackAllowed(config = env) {
  return config.CONTENT_VERTEX_FALLBACK === 'true' && Object.hasOwn(vertexPrices, config.VERTEX_FALLBACK_MODEL) && Boolean(config.VERTEX_FALLBACK_PROJECT === vertexProductionProject ? wifConfigured(config) : config.VERTEX_FALLBACK_PROJECT && (config.VERTEX_FALLBACK_CREDENTIALS || config.VERTEX_FALLBACK_SERVICE_ACCOUNT_JSON || config.GOOGLE_SERVICE_ACCOUNT_JSON)) && Date.parse(config.VERTEX_FALLBACK_APPROVED_UNTIL || '') > Date.now() && Date.now() < Date.parse('2027-01-01T00:00:00Z')
}

export function vertexSchema(schema) {
  if (Array.isArray(schema)) return schema.map(vertexSchema)
  if (!schema || typeof schema !== 'object') return schema
  // Provider grammar limits differ; the complete original schema is still validated by the server.
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !['$schema', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'default'].includes(key)).map(([key, value]) => key === 'const' ? ['enum', [value]] : [key, vertexSchema(value)]))
}

function vertexCredentials(config) {
  try {
    const credentials = JSON.parse(config.VERTEX_FALLBACK_CREDENTIALS ? readFileSync(config.VERTEX_FALLBACK_CREDENTIALS, 'utf8') : config.VERTEX_FALLBACK_SERVICE_ACCOUNT_JSON || config.GOOGLE_SERVICE_ACCOUNT_JSON)
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
  let phase = 'google_auth_import'
  try {
    const { ExternalAccountClient } = dependencies.ExternalAccountClient ? dependencies : await import('google-auth-library')
    phase = 'vercel_oidc_import'
    const { getVercelOidcToken } = dependencies.getVercelOidcToken ? dependencies : await import('@vercel/functions/oidc')
    phase = 'client_construction'
    const authClient = ExternalAccountClient.fromJSON({
      type: 'external_account', audience: vertexWifAudience.replace(/^https:/, ''), subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', token_url: 'https://sts.googleapis.com/v1/token', scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${vertexWifServiceAccount}:generateAccessToken`,
      subject_token_supplier: { getSubjectToken: async () => {
        phase = 'oidc_exchange'
        const token = await getVercelOidcToken({ audience: vertexWifAudience })
        phase = 'google_token_exchange'
        return token
      } },
    })
    phase = 'google_token_exchange'
    const access = await authClient?.getAccessToken()
    phase = 'access_token_validation'
    if (typeof access?.token !== 'string' || !access.token) throw new Error('No access token')
    return { authClient, projectId: vertexProductionProject }
  } catch (error) {
    const allowedCodes = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_INVALID_ARG_TYPE', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ENOENT', 'invalid_request', 'invalid_grant', 'invalid_target', 'permission_denied', 'unauthorized_client', 'access_denied']
    const status = error?.response?.status ?? error?.status
    const code = allowedCodes.includes(error?.code) ? error.code : error?.response?.data?.error
    const description = error?.response?.data?.error_description
    const reason = typeof description === 'string' ? /attribute condition/i.test(description) ? 'attribute_condition_rejected' : /audience/i.test(description) ? 'audience_rejected' : /issuer/i.test(description) ? 'issuer_rejected' : /iam\.serviceAccounts\.getAccessToken/i.test(description) ? 'impersonation_permission_denied' : undefined : undefined
    const authFailure = { phase, ...(allowedCodes.includes(code) ? { code } : {}), ...(reason ? { reason } : {}), ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { httpStatus: status } : {}) }
    throw Object.assign(budgetError('Production federation authentication failed before inference admission.'), { preDispatch: true, configurationFailure: true, authFailure })
  }
}

async function callVertex(request, config, googleAuthOptions, timeoutMs = 180000) {
  const { GoogleGenAI } = await import('@google/genai')
  // The SDK also sends this as X-Server-Timeout; allow structured generation to finish without automatic retries.
  const client = new GoogleGenAI({ vertexai: true, project: config.VERTEX_FALLBACK_PROJECT, location: 'global', googleAuthOptions, httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } } })
  return client.models.generateContent({ model: config.VERTEX_FALLBACK_MODEL, contents: JSON.stringify(request.input), config: { systemInstruction: request.system, responseMimeType: 'application/json', responseJsonSchema: vertexSchema(request.schema), maxOutputTokens: request.maxTokens, thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false } } })
}

export async function generateVertexJson(input, { repository, owner, requestId, beforeAttempt, kind = 'generation', config = env, request = callVertex, worstCaseModelBound = false, timeoutMs = 180000, authenticate }) {
  if (!vertexFallbackAllowed(config)) throw budgetError('Vertex fallback is not authorized or its test approval expired')
  const price = vertexPrices[config.VERTEX_FALLBACK_MODEL]
  const maxTokens = Math.min(input.maxTokens || 6000, 8000)
  const bytes = Buffer.byteLength(JSON.stringify(input))
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 12000 || bytes > 200000 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) throw budgetError('Fallback request exceeds the bounded test scope')
  const googleAuthOptions = request === callVertex || authenticate ? await (authenticate || vertexGoogleAuthOptions)(config) : undefined
  // Allow extra output headroom for thinking; the demo bound remains conservative for either model.
  const upperBoundMicros = worstCaseModelBound ? vertexDemoCallUpperBoundMicros : Math.ceil((bytes + 4096) * price.input + maxTokens * 2 * price.output)
  const { reservation, reserved } = await reserveCost(repository, { owner, requestId, scope: { provider: 'vertex', project: config.VERTEX_FALLBACK_PROJECT, model: config.VERTEX_FALLBACK_MODEL, input }, quote: { currency: 'USD', upperBoundMicros, priceVersion: price.version, priceExpiresAt: new Date(Math.min(Date.parse(config.VERTEX_FALLBACK_APPROVED_UNTIL), Date.parse('2027-01-01T00:00:00Z'))).toISOString(), kind } })
  if (!reserved) throw budgetError('This fallback attempt already exists; reconcile it before another dispatch')
  let cost = reservation
  try {
    if (beforeAttempt) await beforeAttempt()
    cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'dispatch')
    const response = await request({ ...input, maxTokens }, config, googleAuthOptions, timeoutMs)
    const usage = response.usageMetadata
    const counts = [usage?.promptTokenCount, usage?.candidatesTokenCount, usage?.thoughtsTokenCount ?? 0]
    if (counts.every(value => Number.isSafeInteger(value) && value >= 0)) {
      cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'settle', Math.ceil(counts[0] * price.input + (counts[1] + counts[2]) * price.output))
    } else {
      cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'unknown')
    }
    if (response.candidates?.[0]?.finishReason !== 'STOP' || !response.text?.trim()) throw Object.assign(new Error('Vertex fallback did not return complete content'), { code: 'MODEL_INCOMPLETE' })
    try { return JSON.parse(response.text) } catch { throw Object.assign(new Error('Vertex fallback returned invalid JSON'), { code: 'MODEL_JSON_INVALID' }) }
  } catch (error) {
    // Google's current Gemini pricing charges input/output only for HTTP 200 responses:
    // https://cloud.google.com/model-garden/pricing (verified 2026-11-12).
    // Admit only these confirmed SDK rejection statuses here; timeouts and missing usage stay held.
    let nonbillableRejection
    if (cost.status === 'dispatched' && [400, 429].includes(error.status)) {
      cost = await repository.budgetTransition(owner, cost.id, cost.revision, 'settle', 0)
      nonbillableRejection = { httpStatus: error.status, actualMicros: 0, policyUrl: 'https://cloud.google.com/model-garden/pricing' }
    }
    else if (cost.status === 'dispatched') await repository.budgetTransition(owner, cost.id, cost.revision, 'unknown')
    else if (cost.status === 'reserved') await repository.budgetTransition(owner, cost.id, cost.revision, 'cancel')
    if (error.code === 'BUDGET_BLOCKED' || ['MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code)) throw error
    throw Object.assign(new Error(nonbillableRejection ? 'Vertex rejected the request; its documented input/output charge was reconciled to zero.' : 'Vertex fallback request failed; the reserved cost remains protected'), { code: 'VERTEX_REQUEST_FAILED', status: Number.isInteger(error.status) ? error.status : undefined, ...(nonbillableRejection ? { nonbillableRejection } : {}) })
  }
}
