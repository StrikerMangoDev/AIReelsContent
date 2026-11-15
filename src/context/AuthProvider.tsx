import { useEffect, useState, type ReactNode } from 'react'
import { setWorkspaceIdentity } from '@/services/workspace-session'
import { authRead } from '@/services/auth-read'
import { AuthContext, type Identity } from './auth-state'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let sequence = 0
    const update = (profile: Identity | null) => { setWorkspaceIdentity(profile?.uid || null); setIdentity(profile) }
    const refresh = async () => {
      const request = ++sequence
      try {
        const response = await authRead('/api/auth/me')
        if (disposed || request !== sequence) return
        if (response.status === 401 || response.status === 403) { update(null); setError(''); return }
        if (!response.ok) throw new Error('Session check unavailable. Try again; your saved content is safe.')
        const profile = await response.json() as Identity
        if (!disposed && request === sequence) { update(profile); setError('') }
      } catch (cause) {
        // An outage does not prove revocation; backend authorization still applies.
        if (!disposed && request === sequence) setError(cause instanceof Error ? cause.message : 'Session check unavailable.')
      } finally { if (!disposed && request === sequence) setLoading(false) }
    }
    const signOut = () => { ++sequence; update(null); setLoading(false); setError('') }
    const storage = (event: StorageEvent) => { if (event.key === 'studio-signout') signOut() }
    const onFocus = () => { void refresh() }
    void refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('auth-refresh', onFocus)
    window.addEventListener('auth-signout', signOut)
    window.addEventListener('storage', storage)
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60000)
    return () => { disposed = true; clearInterval(interval); window.removeEventListener('focus', onFocus); window.removeEventListener('auth-refresh', onFocus); window.removeEventListener('auth-signout', signOut); window.removeEventListener('storage', storage) }
  }, [])
  return <AuthContext.Provider value={{ user: identity ? { uid: identity.uid } : null, identity, loading, error, configured: true }}>{children}</AuthContext.Provider>
}
