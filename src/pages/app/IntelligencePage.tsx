import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, AudioLines, Globe2, Radar, Sparkles } from 'lucide-react'
import { useAuth } from '@/context/auth-state'
import { studioRequest, type StudioConfig, type StudioPackage } from '@/services/studio-api'
import { trackEvent } from '@/services/analytics'
import '@/styles/studio.css'

type Niche = { id?: string; revision?: number; name: string; brief: string; audience: string; region: string; language: string; voice: string; tone: string; duration: number; windowDays: number; autoRefresh: boolean }
type Observation = { text: string; evidenceIds: string[] }
type Opportunity = { title: string; whatChanged: string; eventDate: string | null; verification: string; whyItMatters: string; evidenceIds: string[]; positive: Observation[]; negative: Observation[]; audienceReaction: { status: string; summary: string; evidenceIds: string[]; limitations: string }; angle: string; hook: string; counterpoint: string; opportunityReason: string; keywords: string[] }
type Report = { id: string; nicheId: string; niche: Niche; researchedAt: string; summary: string; opportunities: Opportunity[]; unknowns: string[]; evidence: StudioPackage['evidence']; methodology: string; searchQueries: string[]; searchEntryPoint: string }
type ReportSummary = Pick<Report, 'id' | 'nicheId' | 'researchedAt'>
type HistoryPage = { reports: ReportSummary[]; nextCursor: { before: string; beforeId: string } | null }
const initial: Niche = { name: 'AI & technology', brief: '', audience: '', region: 'Global', language: 'Auto', voice: 'Auto', tone: 'Auto', duration: 45, windowDays: 7, autoRefresh: false }
const draftKey = 'signal_niche_draft'
const nicheFields = (value: Niche) => ({ name: value.name, brief: value.brief, audience: value.audience, region: value.region, language: value.language, voice: value.voice, tone: value.tone, duration: value.duration, windowDays: value.windowDays, autoRefresh: value.autoRefresh || false })
function initialDraft(): Niche {
  try { const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); return saved && typeof saved.brief === 'string' ? { ...initial, ...saved } : initial } catch { return initial }
}

export function IntelligencePage() {
  const { identity } = useAuth()
  return <IntelligenceWorkspace key={identity?.uid || 'guest'} />
}

function IntelligenceWorkspace() {
  const { identity, loading, configured } = useAuth()
  const navigate = useNavigate()
  const [niche, setNiche] = useState<Niche>(initialDraft)
  const [niches, setNiches] = useState<Niche[]>([])
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [nextCursor, setNextCursor] = useState<HistoryPage['nextCursor']>(null)
  const [selectedReportId, setSelectedReportId] = useState('')
  const [fetchedReport, setReport] = useState<Report | null>(null)
  const report = fetchedReport?.id === selectedReportId ? fetchedReport : null
  const [config, setConfig] = useState<StudioConfig | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState<'updates' | 'ideas'>('updates')
  const [schedules, setSchedules] = useState<{ id: string; status: string; attemptedAt: string; error?: string }[]>([])
  useEffect(() => { studioRequest<StudioConfig>('/config', undefined, 'GET', false).then(setConfig).catch(() => setError('Could not check service availability. Reload to try again.')) }, [])
  useEffect(() => {
    if (!identity) return
    let active = true
    studioRequest<HistoryPage & { niches: Niche[]; schedules: typeof schedules }>('/intelligence').then(data => {
      if (!active) return
      setNiches(data.niches); setReports(data.reports); setNextCursor(data.nextCursor); setSchedules(data.schedules || [])
      if (!initialDraft().brief && data.niches[0]) { setNiche(data.niches[0]); setSelectedReportId(data.reports.find(item => item.nicheId === data.niches[0].id)?.id || '') }
    }).catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [identity])
  useEffect(() => {
    let active = true
    if (!selectedReportId) return
    studioRequest<Report>(`/intelligence/reports/${selectedReportId}`).then(value => { if (active) setReport(value) }).catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [selectedReportId])
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.') } finally { setBusy('') }
  }
  async function research() {
    if (!identity) {
      try { sessionStorage.setItem(draftKey, JSON.stringify(nicheFields(niche))) } catch { /* A disabled browser store must not block sign-in. */ }
      navigate('/login?next=%2F'); return
    }
    await run('Researching your niche. Searching sources and comparing the available evidence…', async () => {
      const saved = await saveNiche()
      const next = await studioRequest<Report>('/intelligence/research', { nicheId: saved.id, requestId: crypto.randomUUID() }, 'POST')
      setReports(previous => [{ id: next.id, nicheId: next.nicheId, researchedAt: next.researchedAt }, ...previous]); setSelectedReportId(next.id)
      void trackEvent('research_completed')
    })
  }
  async function saveNiche() {
    const saved = await studioRequest<Niche>('/intelligence/niches', { niche: nicheFields(niche), ...(niche.id ? { id: niche.id, revision: niche.revision } : {}) }, 'POST')
    setNiche(saved); setNiches(previous => [saved, ...previous.filter(item => item.id !== saved.id)])
    try { sessionStorage.removeItem(draftKey) } catch { /* Optional draft cleanup. */ }
    return saved
  }
  async function create(index: number) {
    if (!report) return
    await run('Writing your platform content and production brief. Evidence checks run automatically…', async () => {
      const pack = await studioRequest<StudioPackage>('/packages', { researchId: report.id, opportunityIndex: index, requestId: crypto.randomUUID() }, 'POST')
      try {
        await studioRequest<StudioPackage>(`/packages/${pack.id}/generate`, { requestId: crypto.randomUUID() }, 'POST')
        void trackEvent('package_generated')
      } finally { navigate(`/studio/${pack.id}`) }
    })
  }
  function citations(ids: string[]) {
    return <span className="source-chips">{ids.map(id => { const source = report?.evidence.find(item => item.id === id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id} ↗</a> : null })}</span>
  }
  const visibleReports = reports.filter(item => item.nicheId === niche.id)
  return <section className="studio intelligence" aria-busy={Boolean(busy)}>
    <header className="intelligence-hero"><span className="studio-eyebrow"><Radar size={15} /> YOUR RESEARCH & CONTENT DESK</span><h1>Know what matters.<br /><em>Make it worth watching.</em></h1><p>Your niche. Your audience. Fresh research and a clear creative direction for LinkedIn, Instagram and YouTube.</p></header>
    <div className="intelligence-modes"><span><Globe2 size={17} /> Stay informed</span><span><Sparkles size={17} /> Find your next story</span><span><AudioLines size={17} /> Brief your production team</span></div>
    {error && <div className="studio-alert" role="alert">{error}</div>}
    <div className="intelligence-layout"><aside>
      <form className="studio-panel brief-panel" onSubmit={event => { event.preventDefault(); void research() }}>
        <div className="studio-toolbar"><h2>Your niche agent</h2>{niche.id && <button type="button" disabled={Boolean(busy)} onClick={() => { setNiche(initial); setSelectedReportId('') }}>+ New niche</button>}</div>
        {niches.length > 0 && <label>Saved niches<select disabled={Boolean(busy)} value={niche.id || ''} onChange={event => { const next = niches.find(item => item.id === event.target.value); if (next) { setNiche(next); setSelectedReportId(reports.find(item => item.nicheId === next.id)?.id || '') } }}><option value="">New brief</option>{niches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label>Niche<input required maxLength={100} minLength={2} value={niche.name} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, name: event.target.value })} placeholder="AI, fitness, cinema, cricket…" /></label>
        <label>What should your agent follow?<textarea required minLength={15} maxLength={4000} className="brief-input" disabled={Boolean(busy)} value={niche.brief} onChange={event => setNiche({ ...niche, brief: event.target.value })} placeholder="Find the most important AI launches this week. Explain the real benefits, concerns and public reactions. Help me create practical, high-retention content for Indian business owners." /></label>
        <details><summary>Audience & production preferences</summary><p className="studio-muted">Optional. Auto uses your brief to suggest a starting point. Recommendations are hypotheses to test.</p>
          <label>Audience<input maxLength={300} value={niche.audience} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, audience: event.target.value })} placeholder="Infer from my brief" /></label>
          <label>Market / region<input maxLength={100} value={niche.region} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, region: event.target.value })} /></label>
          <div className="studio-fields">{([['language', 'Language', ['Auto', 'English', 'Hindi', 'Hinglish']], ['voice', 'Voice', ['Auto', 'Female', 'Male']], ['tone', 'Delivery', ['Auto', 'Calm', 'Conversational', 'Energetic']]] as const).map(([key, label, options]) => <label key={key}>{label}<select disabled={Boolean(busy)} value={niche[key]} onChange={event => setNiche({ ...niche, [key]: event.target.value })}>{options.map(value => <option key={value}>{value}</option>)}</select></label>)}
          <label>Video length (seconds)<input type="number" min={15} max={180} value={niche.duration} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, duration: Number(event.target.value) })} /></label></div>
        </details>
        <label>Research window<select value={niche.windowDays} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, windowDays: Number(event.target.value) })}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
        <button className="primary-action" disabled={Boolean(busy) || loading || (!identity && !configured) || (Boolean(identity) && !config?.capabilities.generation)}>{identity ? 'Research & find opportunities' : 'Sign in & research'}<ArrowRight size={16} /></button>
        <p className="studio-muted">No source links needed. Your brief is saved per niche. Refresh when you want new research; up to 10 briefings per day.</p>
        {identity && <><label className="studio-check"><input type="checkbox" checked={niche.autoRefresh || false} disabled={Boolean(busy) || (!config?.capabilities.researchScheduling && !niche.autoRefresh)} onChange={event => setNiche({ ...niche, autoRefresh: event.target.checked })} />Research this niche automatically each day</label><p className="studio-muted">{config?.capabilities.researchScheduling ? 'Uses your research allowance. A running research worker is required; new briefings are saved here.' : 'Automatic research requires an enabled research worker.'}</p><button type="button" disabled={Boolean(busy) || niche.brief.trim().length < 15 || niche.name.trim().length < 2} onClick={() => void run('Saving agent preferences', async () => { await saveNiche() })}>Save agent preferences</button>{schedules.filter(item => item.id === niche.id).map(item => <p key={item.id} className="studio-muted">Last automatic attempt: {new Date(item.attemptedAt).toLocaleString()} · {item.status}{item.error ? ` — ${item.error}` : ''}</p>)}</>}
        {!loading && !configured && <p role="status">Account access needs to be configured before private research can run. <Link to="/dashboard">Explore public updates</Link></p>}
        {identity && config && !config.capabilities.generation && <p role="status">Research requires a configured generation provider.</p>}
      </form>
      <Link className="studio-button" to="/studio">Open your content library →</Link>
    </aside><div className="intelligence-results">
      <div className="studio-toolbar">{visibleReports.length > 0 && <label>Previous briefings<select disabled={Boolean(busy)} value={selectedReportId} onChange={event => setSelectedReportId(event.target.value)}><option value="">Choose a briefing</option>{visibleReports.map(item => <option key={item.id} value={item.id}>{new Date(item.researchedAt).toLocaleString()}</option>)}</select></label>}{nextCursor && <button disabled={Boolean(busy)} onClick={() => void run('Loading older briefings', async () => {
        const page = await studioRequest<HistoryPage>(`/intelligence/reports?${new URLSearchParams(nextCursor)}`)
        setReports(previous => [...previous, ...page.reports.filter(item => !previous.some(existing => existing.id === item.id))]); setNextCursor(page.nextCursor)
      })}>Load older briefings</button>}</div>
      {selectedReportId && !report && !error && <p role="status">Loading briefing…</p>}
      {busy && <div className="studio-panel research-progress" role="status"><Radar size={25} /><div><strong>{busy}</strong><p>This can take a few minutes. Your previous work stays saved.</p></div></div>}
      {!report ? <div className="studio-panel intelligence-empty"><span className="studio-eyebrow">FROM A BRIEF TO A CREATIVE DIRECTION</span><h2>One place for the story<br />and what to do with it.</h2><ol><li><strong>Understand the development</strong><p>What changed, why it matters, and what is still uncertain.</p></li><li><strong>See the conversation</strong><p>Supported positive and negative reactions, with their sources and limitations.</p></li><li><strong>Make the content</strong><p>Platform hooks, headlines, retention beats, narration, voice direction and production prompts.</p></li></ol><p className="studio-muted">We help you test stronger ideas. Nobody can guarantee virality or maximum views.</p></div> : <>
        <div className="report-heading"><div><span className="studio-eyebrow">{report.niche.name} · RESEARCH SNAPSHOT</span><h2>Your briefing</h2><p>Researched {new Date(report.researchedAt).toLocaleString()} · {report.niche.windowDays}-day window</p></div></div>
        <p className="briefing-summary">{report.summary}</p>
        <nav className="studio-tabs" aria-label="Briefing view"><button aria-pressed={view === 'updates'} onClick={() => setView('updates')}>Major updates</button><button aria-pressed={view === 'ideas'} onClick={() => setView('ideas')}>Content opportunities</button></nav>
        {!report.opportunities.length && <div className="studio-panel"><h2>No supported opportunities yet</h2><p>Try a wider research window or a more specific brief. We won’t invent a development to fill the board.</p></div>}
        {report.opportunities.map((topic, index) => <article className="studio-panel opportunity" key={`${report.id}-${index}`}>
          <div className="opportunity-meta"><span className="studio-badge">{topic.verification}</span><span>{topic.eventDate || 'Event date unconfirmed'}</span>{citations(topic.evidenceIds)}</div>
          <h2>{topic.title}</h2><p>{topic.whatChanged}</p><p><strong>Why your audience should care</strong><br />{topic.whyItMatters}</p>
          {view === 'updates' ? <><div className="reaction-columns"><div><h3>Benefits & positive signals</h3>{topic.positive.length ? topic.positive.map((item, i) => <p key={i}>{item.text} {citations(item.evidenceIds)}</p>) : <p>No supported positive observations found.</p>}</div><div><h3>Concerns & criticism</h3>{topic.negative.length ? topic.negative.map((item, i) => <p key={i}>{item.text} {citations(item.evidenceIds)}</p>) : <p>No supported criticism found.</p>}</div></div><div className="audience-reaction"><span className="studio-eyebrow">PUBLIC REACTION · {topic.audienceReaction.status.replaceAll('-', ' ')}</span><p>{topic.audienceReaction.summary} {citations(topic.audienceReaction.evidenceIds)}</p><small>{topic.audienceReaction.limitations}</small></div></> : <><blockquote className="creative-hook">{topic.hook}</blockquote><p><strong>The angle</strong><br />{topic.angle}</p><p><strong>Why this is worth testing</strong><br />{topic.opportunityReason}</p><p><strong>Keep this counterpoint</strong><br />{topic.counterpoint}</p><div className="keyword-list">{topic.keywords.map(word => <span key={word}>{word}</span>)}</div></>}
          <button disabled={Boolean(busy)} onClick={() => void create(index)}>Create platform content <ArrowRight size={15} /></button><span className="studio-muted"> LinkedIn · Instagram · YouTube</span>
        </article>)}
        {report.unknowns.length > 0 && <details className="studio-panel"><summary>What the research could not establish</summary><ul>{report.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        <details className="studio-panel"><summary>Sources & research method ({report.evidence.length})</summary><p>{report.methodology}</p>{report.evidence.map(item => <article className="studio-evidence" key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.id} · {item.title} ↗</a><p className="studio-muted">{item.type} · Retrieved {new Date(item.retrievedAt).toLocaleString()}</p><p>{item.limitations.join(' ')}</p><details><summary>Read captured evidence</summary><blockquote>{item.excerpt}</blockquote></details></article>)}<p className="studio-muted">Searches: {report.searchQueries.join(' · ')}</p></details>
        {report.searchEntryPoint && <iframe title="Google Search suggestions" className="search-suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={report.searchEntryPoint} />}
      </>}
    </div></div>
  </section>
}
