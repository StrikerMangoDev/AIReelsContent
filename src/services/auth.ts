export async function authHeaders(): Promise<Record<string, string>> {
  return { 'X-Studio-Request': '1' }
}

export async function signIn(email: string, password: string) {
  const response = await fetch('/api/auth/login', { method: 'POST', headers: { ...await authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to sign in. Try again.')
  window.dispatchEvent(new Event('auth-refresh'))
}

export async function signOutCurrentUser() {
  const response = await fetch('/api/auth/logout', { method: 'POST', headers: await authHeaders() })
  if (!response.ok) throw new Error('Sign out failed. Try again before opening another browser.')
  window.dispatchEvent(new Event('auth-signout'))
  try { localStorage.setItem('studio-signout', String(Date.now())) } catch { /* Other tabs verify the shared cookie on focus. */ }
}
