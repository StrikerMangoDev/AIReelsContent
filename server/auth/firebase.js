import { readFileSync } from 'node:fs'
import { env } from '../config/env.js'

let serviceAccount

export function roleForIdentity(identity) {
  const admins = env.ADMIN_EMAILS.split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
  return identity.email_verified === true && (identity.admin === true || admins.includes(String(identity.email).toLowerCase())) ? 'admin' : 'user'
}

export function firebaseCredentials(config, read = readFileSync) {
  return JSON.parse(config.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || (config.FIREBASE_ADMIN_CREDENTIALS ? read(config.FIREBASE_ADMIN_CREDENTIALS, 'utf8') : config.GOOGLE_SERVICE_ACCOUNT_JSON || read(config.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')))
}

export async function verifyIdentity(token) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('AUTH_NOT_CONFIGURED')
  const [{ cert, initializeApp, getApps }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')])
  if (!getApps().length) {
    const credentials = firebaseCredentials(env)
    serviceAccount = credentials.client_email?.endsWith('.gserviceaccount.com') ? credentials.client_email : undefined
    initializeApp({ credential: cert(credentials), projectId: env.FIREBASE_PROJECT_ID })
  }
  return getAuth().verifyIdToken(token, true)
}

export function createAuthMiddleware(verify = verifyIdentity) {
  return async (request, response, next) => {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization || '')
    if (!match) return response.status(401).json({ error: 'Sign in required' })
    try { const identity = await verify(match[1]); request.identity = { uid: identity.uid, email: identity.email || '', emailVerified: identity.email_verified === true, name: identity.name || '', role: roleForIdentity(identity) }; next() }
    catch (error) {
      // Log SDK error codes only: messages can contain tokens or credential details.
      const code = typeof error.code === 'string' && /^(auth\/[a-z-]+|app\/[a-z-]+|ENOENT)$/.test(error.code) ? error.code : 'AUTH_VERIFICATION_FAILED'
      console.error(JSON.stringify({ event: 'auth_verification_failed', code, serviceAccount, requestId: response.getHeader('X-Request-Id') }))
      response.status(401).json({ error: 'Authentication could not be verified' })
    }
  }
}
export function requireAdmin(request, response, next) {
  if (request.identity?.role !== 'admin') return response.status(403).json({ error: 'Administrator access required' })
  next()
}
