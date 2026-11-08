import { useEffect, useState, type ReactNode } from 'react'
import { authConfiguration, authHeaders, configuredAuth, hexclaveClient } from '@/services/firebase'
import { setWorkspaceIdentity } from '@/services/workspace-session'
import { AuthContext, type Identity } from './auth-state'
import { authRead } from '@/services/auth-read'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ uid: string } | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(false)
  const [provider, setProvider] = useState<'firebase' | 'hexclave'>('firebase')
  useEffect(() => {
    const updateIdentity = (value: Identity | null) => { setWorkspaceIdentity(value?.uid || null); setIdentity(value) }
    let disposed = false
    let sequence = 0
    let unsubscribe: (() => void) | undefined
    let interval: ReturnType<typeof setInterval> | undefined
    let onFocus: (() => void) | undefined
    let onSignOut: (() => void) | undefined
    void authConfiguration().then(async config => {
      if (disposed) return
      setProvider(config.provider || 'firebase')
      if (config.provider === 'hexclave') {
        if (!config.configured) throw new Error('Sign-in is awaiting identity configuration and migration verification.')
        const client = await hexclaveClient()
        setConfigured(true)
        let accountId: string | null = null
        const refresh = async () => {
          const request = ++sequence
          try {
            const account = await client.getUser()
            if (disposed || request !== sequence) return
            if ((account?.id || null) !== accountId) {
              accountId = account?.id || null
              updateIdentity(null); setUser(null); setLoading(true)
            }
            const response = account ? await authRead('/api/auth/me', await authHeaders()) : null
            if (response && !response.ok) throw new Error('The server could not verify this account.')
            const profile = response ? await response.json() as Identity : null
            if (!disposed && request === sequence) { updateIdentity(profile); setUser(profile ? { uid: profile.uid } : null); setError('') }
          } catch (cause) {
            if (!disposed && request === sequence) { updateIdentity(null); setUser(null); setError(cause instanceof Error ? cause.message : 'Authentication unavailable.') }
          } finally { if (!disposed && request === sequence) setLoading(false) }
        }
        await refresh()
        if (disposed) return
        onFocus = () => { void refresh() }
        onSignOut = () => { ++sequence; accountId = null; updateIdentity(null); setUser(null); setLoading(true) }
        window.addEventListener('focus', onFocus)
        window.addEventListener('auth-refresh', onFocus)
        window.addEventListener('auth-signout-start', onSignOut)
        interval = setInterval(() => { void refresh() }, 60000)
        return
      }
      const auth = await configuredAuth()
      const { onIdTokenChanged } = await import('firebase/auth')
      if (disposed) return
      setConfigured(true)
      let firebaseAccountId: string | null = null
      unsubscribe = onIdTokenChanged(auth, async next => {
        if (disposed) return
        const request = ++sequence
        const nextId = next?.uid || null
        if (firebaseAccountId !== nextId) updateIdentity(null)
        firebaseAccountId = nextId
        setUser(next); setLoading(true)
        try {
          if (next) {
            const token = await next.getIdToken()
            const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
            if (!response.ok) throw new Error('The server could not verify this account. Check the Firebase backend configuration.')
            const profile = await response.json() as Identity
            if (!disposed && request === sequence) updateIdentity(profile)
          }
          if (!disposed && request === sequence) setError('')
        } catch (cause) { if (!disposed && request === sequence) { updateIdentity(null); setUser(null); setError(cause instanceof Error ? cause.message : 'Authentication unavailable.') } }
        finally { if (!disposed && request === sequence) setLoading(false) }
      })
    }).catch(cause => { if (!disposed) { setError(cause instanceof Error ? cause.message : 'Authentication unavailable.'); setLoading(false) } })
    return () => { disposed = true; unsubscribe?.(); if (interval) clearInterval(interval); if (onFocus) { window.removeEventListener('focus', onFocus); window.removeEventListener('auth-refresh', onFocus) } if (onSignOut) window.removeEventListener('auth-signout-start', onSignOut) }
  }, [])
  return <AuthContext.Provider value={{ user, identity, loading, error, configured, provider }}>{children}</AuthContext.Provider>
}
