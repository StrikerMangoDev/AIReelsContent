import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/auth-state'
import { authHeaders } from '@/services/firebase'
type Overview = { sessions: number; articleCount: number; events: { type: string; total: number }[]; users: { uid: string; email: string; name: string; role: string; lastSeen: string }[]; recent: { id: string; type: string; path: string; userId: string | null; createdAt: string; payload: { articleId?: string; value?: string } }[]; daily: { day: string; total: number }[]; ingestion: { status: string; finishedAt: string | null } | null }
export function AdminPage() {
  const { identity, loading } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (identity?.role !== 'admin') return
    const controller = new AbortController()
    async function load() { try { const response = await fetch('/api/admin/overview', { headers: await authHeaders(), signal: controller.signal }); if (!response.ok) throw new Error('Admin data could not be loaded.'); setData(await response.json() as Overview); setError('') } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Admin request failed.') } }
    void load(); const timer = window.setInterval(() => { if (!document.hidden) void load() }, 60000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [identity])
  if (loading) return <p>Checking administrator access…</p>
  if (!identity) return <Navigate to="/login" replace />
  if (identity.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <section className="admin-page"><div className="admin-heading"><h1>Admin overview</h1><Link className="admin-website-link" to="/dashboard">Open website <span aria-hidden="true">↗</span></Link></div><p>Account activity and consented website interactions over the last 30 days.</p>{error && <div role="alert" className="feed-notice">{error}</div>}{!data ? <p>Loading dashboard…</p> : <><div className="admin-stats">{[['Sessions', data.sessions], ['Accounts', data.users.length], ['Articles', data.articleCount], ['Article clicks', data.events.find(event => event.type === 'article_click')?.total ?? 0]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div><h2>Activity</h2><div className="admin-chart">{data.daily.map(day => <div key={day.day} title={`${day.day}: ${day.total} events`}><span style={{ height: `${Math.max(3, day.total / Math.max(...data.daily.map(item => item.total), 1) * 100)}px` }} /><small>{day.day.slice(5)}</small></div>)}</div><h2>Accounts</h2><div className="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last seen</th></tr></thead><tbody>{data.users.map(user => <tr key={user.uid}><td>{user.name || '—'}</td><td>{user.email}</td><td>{user.role}</td><td>{new Date(user.lastSeen).toLocaleString()}</td></tr>)}</tbody></table></div><h2>Recent interactions</h2><div className="table-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Page</th><th>Account</th><th>Detail</th></tr></thead><tbody>{data.recent.map(event => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString()}</td><td>{event.type.replaceAll('_', ' ')}</td><td>{event.path}</td><td>{event.userId ? data.users.find(user => user.uid === event.userId)?.email || 'Signed-in user' : 'Anonymous session'}</td><td>{event.payload.value || event.payload.articleId || '—'}</td></tr>)}</tbody></table></div><p className="admin-note">Last ingestion: {data.ingestion?.status ?? 'Not run'}. Analytics excludes visitors who decline tracking. Counts are observed events, not a complete record of every visitor.</p></>}</section>
}
