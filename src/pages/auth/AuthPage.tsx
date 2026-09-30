import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, updateProfile, sendPasswordResetEmail } from 'firebase/auth'
import { configuredAuth } from '@/services/firebase'
import { useAuth } from '@/context/auth-state'
import { Logo } from '@/components/common/Logo'

export function AuthPage({ signup = false }: { signup?: boolean }) {
  const { identity, configured, loading, error: connectionError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (identity) return <Navigate replace to={identity.role === 'admin' ? '/admin' : '/dashboard'} />
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await operation() } catch (cause) { const code = (cause as {code?:string}).code; setError(code === 'auth/popup-closed-by-user' ? 'Google sign-in was closed. Try again when ready.' : code === 'auth/email-already-in-use' ? 'An account already exists for this email.' : code === 'auth/invalid-credential' ? 'Email or password is incorrect.' : code === 'auth/operation-not-allowed' ? 'This sign-in provider must be enabled in Firebase.' : cause instanceof Error ? cause.message : 'Unable to sign in.') }
    finally { setBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    await perform(async () => {
      const auth = await configuredAuth()
      if (signup) { const result = await createUserWithEmailAndPassword(auth, email, password); await updateProfile(result.user, { displayName: name.trim() }); await sendEmailVerification(result.user) }
      else await signInWithEmailAndPassword(auth, email, password)
    })
  }
  return <main className="auth-screen"><div className="auth-panel"><Logo /><h1>{signup ? 'Create your account.' : 'Welcome back.'}</h1><p>One place to follow what comes next.</p>
    {(connectionError || error) && <div className="feed-notice" role="alert">{error || connectionError}</div>}
    <button className="google-signin" disabled={!configured || busy || loading} onClick={() => perform(async () => signInWithPopup(await configuredAuth(), new GoogleAuthProvider()))}><span>G</span> Continue with Google</button><div className="auth-divider">or use your email</div>
    <form onSubmit={submit}>{signup && <label>Full name<input name="name" required autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>}<label>Email<input name="email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input name="password" type="password" required minLength={signup ? 10 : 1} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label><button className="auth-submit" disabled={!configured || busy || loading}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button></form>
    {!signup && <button className="auth-forgot" disabled={!configured || busy} onClick={() => perform(async () => { if (!email) throw new Error('Enter your email first.'); await sendPasswordResetEmail(await configuredAuth(), email); setError('If an account exists, password reset instructions will be sent.') })}>Forgot password?</button>}
    <p className="auth-switch">{signup ? 'Already have an account?' : 'New here?'} <Link to={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Create account'}</Link></p><Link className="auth-back" to="/">Continue reading →</Link>
  </div></main>
}
