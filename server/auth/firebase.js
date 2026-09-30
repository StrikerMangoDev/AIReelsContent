import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { readFileSync } from 'node:fs'
import { env } from '../config/env.js'

export function roleForIdentity(identity) {
  const admins = env.ADMIN_EMAILS.split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
  return identity.email_verified === true && (identity.admin === true || admins.includes(String(identity.email).toLowerCase())) ? 'admin' : 'user'
}

export async function verifyIdentity(token) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('AUTH_NOT_CONFIGURED')
  if (!getApps().length) {
    const credentials = JSON.parse(env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || readFileSync(env.FIREBASE_ADMIN_CREDENTIALS || env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'))
    initializeApp({ credential: cert(credentials), projectId: env.FIREBASE_PROJECT_ID })
  }
  return getAuth().verifyIdToken(token, true)
}

export function createAuthMiddleware(verify = verifyIdentity) {
  return async (request, response, next) => {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization || '')
    if (!match) return response.status(401).json({ error: 'Sign in required' })
    try { const identity = await verify(match[1]); request.identity = { uid: identity.uid, email: identity.email || '', emailVerified: identity.email_verified === true, name: identity.name || '', role: roleForIdentity(identity) }; next() }
    catch { response.status(401).json({ error: 'Authentication could not be verified' }) }
  }
}
export function requireAdmin(request, response, next) {
  if (request.identity?.role !== 'admin') return response.status(403).json({ error: 'Administrator access required' })
  next()
}
