import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { verifyPassword } from './password.js'

const cookieName = process.env.NODE_ENV === 'production' ? '__Host-studio_session' : 'studio_session'
const digest = value => createHash('sha256').update(value).digest('hex')
const identity = account => ({ uid: account.uid, email: account.email, name: account.name, role: account.role, emailVerified: true })
function sessionHash(request) {
  const token = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  return /^[a-f0-9]{64}$/.test(token || '') ? digest(token) : ''
}
function cookie(response, token = '') {
  response.cookie(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: token ? 43200000 : 0 })
}
export function sameOriginRequest(request, response, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && (request.headers['x-studio-request'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site')) return response.status(403).json({ error: 'Open the portal and try again.' })
  next()
}

export function createAuthMiddleware(repository, verifyIdentity) {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store')
    // Explicit injection keeps existing route tests independent of session storage.
    if (verifyIdentity && process.env.NODE_ENV !== 'production') {
      const token = /^Bearer (\S+)$/.exec(request.headers.authorization || '')?.[1]
      if (!token) return response.status(401).json({ error: 'Sign in required' })
      try {
        const value = await verifyIdentity(token)
        const admins = (process.env.ADMIN_EMAILS || 'yeshaswi3@gmail.com').split(',').map(email => email.trim().toLowerCase())
        request.identity = { uid: value.uid, email: value.email || '', name: value.name || '', emailVerified: value.email_verified === true, role: value.email_verified && (value.admin || admins.includes(value.email?.toLowerCase())) ? 'admin' : 'user' }
      } catch { return response.status(401).json({ error: 'Authentication could not be verified' }) }
      return next()
    }
    const hash = sessionHash(request)
    const account = hash ? await repository.authSession(hash) : null
    if (!account) return response.status(401).json({ error: 'Sign in required. Your session may have expired.' })
    request.identity = identity(account)
    sameOriginRequest(request, response, next)
  }
}

export function mountAuthRoutes(app, repository) {
  app.use('/api/auth', (_request, response, next) => { response.setHeader('Cache-Control', 'private, no-store'); next() })
  app.get('/api/auth/config', (_request, response) => response.json({ configured: true, config: null }))
  app.post('/api/auth/login', sameOriginRequest, async (request, response) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(256) }).strict().safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Enter a valid email and password.' })
    const { email, password } = parsed.data
    // Vercel overwrites this header; other hosts use the socket address, not client forwarding headers.
    const ip = process.env.VERCEL ? request.headers['x-vercel-forwarded-for'] || request.ip : request.ip
    const limits = await Promise.all([repository.authAttempt(digest(`email:${email}`), 10), repository.authAttempt(digest(`ip:${ip}`), 60)])
    if (limits.includes(false)) return response.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' })
    const account = await repository.authAccount(email)
    if (!await verifyPassword(password, account?.password_hash) || account?.disabled) return response.status(401).json({ error: 'Email or password is incorrect.' })
    const token = randomBytes(32).toString('hex')
    const claimed = await repository.authClaim(account.uid, account.password_hash, digest(token), sessionHash(request))
    if (!claimed) return response.status(409).json({ error: 'Already logged in on another browser. Sign out there, or ask your administrator to release the session.' })
    cookie(response, token)
    response.json(identity(claimed))
  })
  app.post('/api/auth/logout', sameOriginRequest, async (request, response) => {
    const hash = sessionHash(request)
    if (hash) await repository.authLogout(hash)
    cookie(response)
    response.json({ signedOut: true })
  })
}

export function requireAdmin(request, response, next) {
  if (request.identity?.role !== 'admin') return response.status(403).json({ error: 'Administrator access required' })
  next()
}
