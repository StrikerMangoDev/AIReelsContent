import { authHeaders } from './firebase'
type EventType = 'page_view' | 'article_click' | 'region_change' | 'category_change' | 'search' | 'signin' | 'signout' | 'research_completed' | 'package_generated' | 'package_approved' | 'package_exported'
export async function trackEvent(type: EventType, detail: { value?: string; articleId?: string } = {}) {
  if (localStorage.getItem('signal_analytics_consent') !== 'yes') return
  let sessionId = sessionStorage.getItem('signal_session')
  if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem('signal_session', sessionId) }
  const path = location.pathname.startsWith('/studio') ? '/studio' : ['/', '/dashboard', '/login', '/signup', '/admin'].includes(location.pathname) ? location.pathname : '/'
  try { await fetch('/api/events', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', ...await authHeaders() }, body: JSON.stringify({ consent: true, sessionId, type, path, ...detail }) }) } catch { /* Analytics never blocks navigation. */ }
}
