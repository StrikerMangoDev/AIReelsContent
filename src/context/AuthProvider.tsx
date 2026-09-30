import { useEffect, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { configuredAuth } from '@/services/firebase'
import { AuthContext, type Identity } from './auth-state'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(false)
  useEffect(() => {
    let disposed = false
    let sequence = 0
    let unsubscribe: (() => void) | undefined
    void configuredAuth().then(async auth => {
      const { onIdTokenChanged } = await import('firebase/auth')
      if (disposed) return
      setConfigured(true)
      unsubscribe = onIdTokenChanged(auth, async next => {
        const request = ++sequence
        setUser(next); setIdentity(null); setLoading(true)
        try {
          if (next) {
            const token = await next.getIdToken()
            const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
            if (!response.ok) throw new Error('The server could not verify this account. Check the Firebase backend configuration.')
            const profile = await response.json() as Identity
            if (!disposed && request === sequence) setIdentity(profile)
          }
          if (!disposed && request === sequence) setError('')
        } catch (cause) { if (!disposed && request === sequence) setError(cause instanceof Error ? cause.message : 'Authentication unavailable.') }
        finally { if (!disposed && request === sequence) setLoading(false) }
      })
    }).catch(cause => { if (!disposed) { setError(cause instanceof Error ? cause.message : 'Authentication unavailable.'); setLoading(false) } })
    return () => { disposed = true; unsubscribe?.() }
  }, [])
  return <AuthContext.Provider value={{ user, identity, loading, error, configured }}>{children}</AuthContext.Provider>
}
