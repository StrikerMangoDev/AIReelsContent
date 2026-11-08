import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { createAuthMiddleware as firebaseMiddleware, requireAdmin } from './firebase.js'

export { requireAdmin }

function identityMap(config) {
  const map = JSON.parse(config.HEXCLAVE_IDENTITY_MAP_JSON || '{}')
  if (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some(uid => typeof uid !== 'string' || !uid || uid.length > 128) || new Set(Object.values(map)).size !== Object.values(map).length) throw new Error('Invalid identity migration map')
  return map
}

export function publicAuthConfig(config = env) {
  if (config.AUTH_PROVIDER === 'hexclave') {
    let configured = Boolean(config.HEXCLAVE_PROJECT_ID && config.HEXCLAVE_SECRET_SERVER_KEY && config.HEXCLAVE_MIGRATION_READY === 'true')
    try { identityMap(config) } catch { configured = false }
    return { provider: 'hexclave', configured, config: configured ? { projectId: config.HEXCLAVE_PROJECT_ID } : null }
  }
  let result = null
  try {
    const raw = JSON.parse(config.FIREBASE_WEB_CONFIG || 'null')
    if (raw?.apiKey && raw?.authDomain && raw?.projectId === config.FIREBASE_PROJECT_ID) result = { apiKey: raw.apiKey, authDomain: raw.authDomain, projectId: raw.projectId, appId: raw.appId }
  } catch { /* Missing configuration keeps sign-in disabled. */ }
  return { provider: 'firebase', configured: Boolean(result), config: result }
}

export function createHexclaveMiddleware({ config = env, loadApp = async options => {
  const { HexclaveServerApp } = await import('@hexclave/js')
  return new HexclaveServerApp(options)
} } = {}) {
  let app
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store')
    if (!publicAuthConfig({ ...config, AUTH_PROVIDER: 'hexclave' }).configured) return response.status(503).json({ error: 'Hexclave configuration and identity migration must be verified before sign-in is enabled.' })
    if (typeof request.headers.authorization !== 'string' || !request.headers.authorization || request.headers.authorization.length > 16384) return response.status(401).json({ error: 'Sign in required' })
    try {
      app ??= await loadApp({ projectId: config.HEXCLAVE_PROJECT_ID, secretServerKey: config.HEXCLAVE_SECRET_SERVER_KEY, tokenStore: null })
      // The project-bound SDK validates the session; never decode a JWT or trust client profile fields here.
      const user = await app.getUser({ tokenStore: { headers: { authorization: request.headers.authorization } } })
      if (!user || typeof user.id !== 'string' || !user.id || user.isAnonymous === true || user.isRestricted === true) return response.status(401).json({ error: 'Authentication could not be verified' })
      const mapping = identityMap(config)
      const uid = Object.hasOwn(mapping, user.id) ? mapping[user.id] : `hexclave:${createHash('sha256').update(JSON.stringify([config.HEXCLAVE_PROJECT_ID, user.id])).digest('hex')}`
      request.identity = { uid, email: typeof user.primaryEmail === 'string' ? user.primaryEmail : '', emailVerified: user.primaryEmailVerified === true, name: typeof user.displayName === 'string' ? user.displayName : '', role: 'user' }
      next()
    } catch {
      response.status(401).json({ error: 'Authentication could not be verified' })
    }
  }
}

export function createAuthMiddleware(verifyIdentity) {
  if (verifyIdentity || env.AUTH_PROVIDER !== 'hexclave') return firebaseMiddleware(verifyIdentity)
  return createHexclaveMiddleware()
}
