import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { signIn } from '@/services/auth'
import { useAuth } from '@/context/auth-state'
import { Logo } from '@/components/common/Logo'
import { safeRedirect } from '@/services/safe-redirect'

export function AuthPage() {
  const { identity, loading, error: connectionError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const notice = useRef<HTMLDivElement>(null)
  const [params] = useSearchParams()
  if (identity) return <Navigate replace to={safeRedirect(params.get('next'))} />
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await signIn(email, password); setPassword('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in. Try again.'); requestAnimationFrame(() => notice.current?.focus()) }
    finally { setBusy(false) }
  }
  return <main className="auth-screen"><div className="auth-panel"><Logo /><h1>Sign in to your workspace</h1><p>Internal access for your content team.</p>
    {(connectionError || error) && <div ref={notice} tabIndex={-1} className="feed-notice" role="alert">{error || connectionError}</div>}
    <form onSubmit={submit} aria-busy={busy}>
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input name="password" type="password" required maxLength={256} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="auth-submit" disabled={busy || loading}>{busy ? 'Signing in…' : loading ? 'Checking session…' : 'Sign in'}</button>
    </form>
    <p className="auth-help">Need access or a password change? Contact your administrator.</p>
    <p className="auth-help">One browser at a time. Sign out before switching browsers.</p>
  </div></main>
}
