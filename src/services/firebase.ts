import type { FirebaseOptions } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import { authRead } from './auth-read'
let pending: Promise<Auth> | undefined
let current: Auth | undefined
type AuthConfiguration = { provider?: 'firebase' | 'hexclave'; configured: boolean; config: FirebaseOptions & { projectId: string } }
let configuration: Promise<AuthConfiguration> | undefined
let hexclave: Promise<import('@hexclave/react').HexclaveClientApp> | undefined
export function authConfiguration() {
  configuration ??= authRead('/api/auth/config').then(response => {
    if (!response.ok) throw new Error('Authentication service unavailable.')
    return response.json() as Promise<AuthConfiguration>
  }).catch(error => { configuration = undefined; throw error })
  return configuration
}
export function hexclaveClient() {
  hexclave ??= authConfiguration().then(async config => {
    if (config.provider !== 'hexclave' || !config.configured) throw new Error('Hexclave configuration and identity migration are awaiting verification.')
    const { HexclaveClientApp } = await import('@hexclave/react')
    return new HexclaveClientApp({ projectId: config.config.projectId, tokenStore: 'cookie', analytics: { enabled: false, replays: { enabled: false } }, urls: { default: { type: 'hosted' }, afterSignIn: '/login', afterSignUp: '/login', afterSignOut: '/', home: '/' } })
  })
  return hexclave
}
export function configuredAuth() {
  pending ??= authConfiguration().then(async result => {
    if (result.provider === 'hexclave') throw new Error('Firebase is not the selected identity provider.')
    if (!result.configured) throw new Error('Firebase connection is awaiting the Ai Vertical web-app configuration.')
    const [{ initializeApp }, { getAuth }] = await Promise.all([import('firebase/app'), import('firebase/auth')])
    current = getAuth(initializeApp(result.config))
    return current
  })
  return pending
}
export async function authHeaders(): Promise<Record<string, string>> {
  if ((await authConfiguration()).provider === 'hexclave') {
    const authorization = await (await hexclaveClient()).getAuthorizationHeader()
    return authorization ? { Authorization: authorization } : {}
  }
  const token = await current?.currentUser?.getIdToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
export async function signOutCurrentUser() {
  if ((await authConfiguration()).provider === 'hexclave') {
    window.dispatchEvent(new Event('auth-signout-start'))
    try { return await (await hexclaveClient()).redirectToSignOut() } catch (error) { window.dispatchEvent(new Event('auth-refresh')); throw error }
  }
  const { signOut } = await import('firebase/auth')
  return signOut(await configuredAuth())
}
