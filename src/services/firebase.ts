import type { FirebaseOptions } from 'firebase/app'
import type { Auth } from 'firebase/auth'
let pending: Promise<Auth> | undefined
let current: Auth | undefined
export function configuredAuth() {
  pending ??= fetch('/api/auth/config').then(response => { if (!response.ok) throw new Error('Authentication service unavailable.'); return response.json() as Promise<{ configured: boolean; config: FirebaseOptions }> }).then(async result => {
    if (!result.configured) throw new Error('Firebase connection is awaiting the Ai Vertical web-app configuration.')
    const [{ initializeApp }, { getAuth }] = await Promise.all([import('firebase/app'), import('firebase/auth')])
    current = getAuth(initializeApp(result.config))
    return current
  })
  return pending
}
export async function authHeaders(): Promise<Record<string, string>> { const token = await current?.currentUser?.getIdToken(); return token ? { Authorization: `Bearer ${token}` } : {} }
