import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { trackEvent } from '@/services/analytics'
export function AnalyticsConsent() {
  const location = useLocation()
  const [choice, setChoice] = useState(() => localStorage.getItem('signal_analytics_consent'))
  const previous = useRef('')
  useEffect(() => {
    if (choice !== 'yes') return
    void trackEvent('page_view')
    const params = new URLSearchParams(location.search)
    const before = new URLSearchParams(previous.current)
    for (const [key, type] of [['region', 'region_change'], ['category', 'category_change'], ['q', 'search']] as const) {
      if (params.get(key) !== before.get(key)) void trackEvent(type, { value: key === 'q' ? `length:${(params.get(key) || '').length}` : params.get(key) || 'All' })
    }
    previous.current = location.search
  }, [location.pathname, location.search, choice])
  useEffect(() => {
    const click = (event: MouseEvent) => { const link = (event.target as Element).closest?.('a[href*="/api/articles/"]'); const id = link?.getAttribute('href')?.match(/\/api\/articles\/([a-f0-9]{24})\/source/)?.[1]; if (id) void trackEvent('article_click', { articleId: id }) }
    document.addEventListener('click', click)
    return () => document.removeEventListener('click', click)
  }, [])
  function choose(value: string) { localStorage.setItem('signal_analytics_consent', value); setChoice(value); if (value === 'no') sessionStorage.removeItem('signal_session') }
  return choice === null ? <aside className="consent-banner" aria-label="Analytics preference"><p>Help improve Signal AI? With your permission, we record page visits and clicks for up to 90 days. Signed-in activity is associated with your account. Passwords and search text are never tracked.</p><button onClick={() => choose('no')}>Decline</button><button onClick={() => choose('yes')}>Allow analytics</button></aside> : <button className="privacy-control" onClick={() => { localStorage.removeItem('signal_analytics_consent'); setChoice(null) }}>Privacy preferences</button>
}
