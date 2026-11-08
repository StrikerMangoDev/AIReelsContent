import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Search, PenLine, ShieldCheck, Activity } from 'lucide-react'
import { useAuth } from '@/context/auth-state'
import { studioRequest } from '@/services/studio-api'
import { activeWorkspace, subscribeWorkspace } from '@/services/workspace-session'
import '@/styles/studio.css'
import '@/styles/workspace-settings.css'

type Usage = {
  budget: { currency: string; limitMicros: number; heldMicros: number; settledMicros: number; overageBlocked: boolean; unreconciledCount: number };
  capabilities: { generation: boolean; research: boolean; paid: boolean };
  jobs: { id: string; operation: string; status: string; createdAt: string; error?: string }[];
}
const statusLabel: Record<string, string> = { completed: 'Completed', failed: 'Needs attention', reserved: 'Queued', running: 'In progress', dispatch_unknown: 'Checking outcome', cancelled: 'Cancelled' }
export function UsagePage() {
  const { identity, loading } = useAuth()
  const workspace = useSyncExternalStore(subscribeWorkspace, activeWorkspace)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [fetching, setFetching] = useState(true)
  const [filter, setFilter] = useState('all')
  const uid = identity?.uid
  useEffect(() => {
    if (!uid) return
    let active = true
    studioRequest<Usage>('/usage').then(value => { if (active) setUsage(value) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Usage could not be loaded.') }).finally(() => { if (active) setFetching(false) })
    return () => { active = false }
  }, [uid, workspace, refresh])
  if (loading) return <section className="studio settings-page" role="status">Checking account access…</section>
  if (!identity) return <section className="studio"><Link to="/login?next=%2Fusage">Sign in to view usage</Link></section>
  function refreshUsage() { setFetching(true); setError(''); setUsage(null); setRefresh(value => value + 1) }
  const amount = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: usage?.budget.currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 10000 ? 4 : 2 }).format(value / 1000000)
  const available = usage ? Math.max(0, usage.budget.limitMicros - usage.budget.settledMicros - usage.budget.heldMicros) : 0
  const committed = usage ? usage.budget.settledMicros + usage.budget.heldMicros : 0
  const percent = usage?.budget.limitMicros ? Math.min(100, Math.max(0, committed / usage.budget.limitMicros * 100)) : 0
  const attention = (job: Usage['jobs'][number]) => ['failed', 'dispatch_unknown'].includes(job.status)
  const jobs = usage?.jobs.filter(job => filter === 'all' || (filter === 'attention' ? attention(job) : job.status === 'completed')) || []
  return <section className="studio settings-page" aria-busy={fetching}>
    <header className="settings-heading"><div><h1>Usage & limits</h1><p>See what your workspace has used and what’s available.</p></div><button disabled={fetching} onClick={refreshUsage}><RefreshCw size={16} aria-hidden="true" /> {fetching ? 'Refreshing…' : 'Refresh usage'}</button></header>
    <nav className="settings-context" aria-label="Usage scope"><span>{workspace === 'personal' ? 'Personal workspace' : 'Current team workspace'}</span><Link to="/workspaces">Change workspace →</Link><small>Viewing this page does not call AI.</small></nav>
    {error && <div className="settings-message error" role="alert">{error} <button onClick={refreshUsage}>Try again</button></div>}
    {fetching && <div className="settings-surface settings-loading" role="status"><span />Loading your saved usage…<span /><span /></div>}
    {usage && <>
      {usage.budget.overageBlocked && <div className="settings-message error" role="alert"><strong>New work is paused.</strong> Recorded spending exceeded the limit. Ask your administrator to review the charges before continuing.</div>}
      <section className="settings-surface settings-budget"><div className="settings-budget-main"><span className="settings-icon"><ShieldCheck size={23} aria-hidden="true" /></span><div><h2>Workspace spending limit</h2><p>A lifetime limit, not a daily or monthly allowance.</p></div><span className="settings-pill">{usage.budget.overageBlocked ? 'Action needed' : 'Limit enforced'}</span></div><div className="settings-balance"><div><span>Available for new work</span><strong>{amount(available)}</strong></div><p>of {amount(usage.budget.limitMicros)} total limit</p></div><progress aria-label="Budget used or reserved" value={percent} max={100} /><dl className="settings-budget-breakdown"><div><dt>Recorded spending</dt><dd>{amount(usage.budget.settledMicros)}</dd><small>Completed cost records</small></div><div><dt>Reserved for work</dt><dd>{amount(usage.budget.heldMicros)}</dd><small>Held until the outcome is confirmed</small></div><div><dt>Awaiting confirmation</dt><dd>{usage.budget.unreconciledCount}</dd><small>Cost records still being checked</small></div></dl><p className="settings-footnote">App records only. Hosting and sign-in service charges are not included. A zero estimate is not proof of a zero final bill.</p></section>
      <div className="settings-service-grid">{[{ name: 'Research ideas', icon: Search, enabled: usage.capabilities.research, description: 'Find sources and topics for your categories.' }, { name: 'Write content', icon: PenLine, enabled: usage.capabilities.generation, description: 'Turn researched ideas into posts and scripts.' }, { name: 'Gemini fallback', icon: ShieldCheck, enabled: usage.capabilities.paid, description: 'Uses the recorded budget when authorized. Charges may apply.' }].map(service => <section className="settings-surface settings-service" key={service.name}><service.icon size={22} aria-hidden="true" /><h2>{service.name}</h2><span className="settings-pill" data-state={service.enabled ? 'configured' : 'off'}>{service.enabled ? (service.name === 'Gemini fallback' ? 'Temporarily authorized' : 'Configured') : 'Not enabled'}</span><p>{service.description}</p></section>)}</div>
      <p className="settings-note">Configured does not guarantee a working connection. Check recent activity for provider errors. <strong>Promotional credit coverage has not been confirmed</strong>; this page does not show a Google Cloud credit balance.</p>
      <section className="settings-surface settings-activity"><header className="settings-section-heading"><div><h2><Activity size={20} aria-hidden="true" /> Recent activity</h2><p>Research and writing jobs saved in this workspace.</p></div><span className="settings-count">{usage.jobs.length} jobs</span></header><div className="settings-filters" role="group" aria-label="Filter activity">{[['all', 'All activity'], ['attention', `Needs attention (${usage.jobs.filter(attention).length})`], ['completed', 'Completed']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>{!jobs.length ? <div className="settings-empty"><Activity size={25} aria-hidden="true" /><h3>{filter === 'all' ? 'No activity yet' : 'Nothing to show here'}</h3><p>{filter === 'all' ? 'Your research and content jobs will appear here.' : 'Try another filter to see the rest of your activity.'}</p>{filter === 'all' && <Link to="/ideas">Browse Topic Library →</Link>}</div> : <ol className="settings-jobs">{jobs.map(job => <li key={job.id}><span className="settings-job-icon">{job.operation === 'research' ? <Search size={18} aria-hidden="true" /> : <PenLine size={18} aria-hidden="true" />}</span><div><strong>{job.operation === 'research' ? 'Topic research' : job.operation === 'generation' ? 'Content generation' : job.operation}</strong><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time>{job.error && <p className="settings-job-error">{job.error.split(' Diagnostics:')[0]}</p>}</div><span className="settings-pill" data-state={attention(job) ? 'attention' : job.status === 'completed' ? 'complete' : 'off'}>{statusLabel[job.status] || job.status}</span></li>)}</ol>}<p className="settings-footnote">Up to 100 saved jobs. If an outcome is still being checked, wait for confirmation before trying again.</p></section>
    </>}
  </section>
}
