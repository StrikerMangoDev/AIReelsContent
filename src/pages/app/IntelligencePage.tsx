import { CategorySetupFields } from './CategorySetupFields'
import { categoryDefaults, type CategorySetup } from '@/services/category-setup'
import { topicResearchDetails } from '@/services/topic-research-details'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom'
import { ArrowRight, Radar, Sparkles } from 'lucide-react'
import { useAuth } from '@/context/auth-state'
import { studioRead, studioRequest, type StudioConfig, type StudioPackage } from '@/services/studio-api'
import { trackEvent } from '@/services/analytics'
import { activeWorkspace } from '@/services/workspace-session'
import { IdeaLibrary, CategoryCover } from './IdeaLibrary'
import '@/styles/studio.css'
import '@/styles/discovery.css'

type Niche = CategorySetup & { id?: string; revision?: number; name: string; brief: string; audience: string; region: string; language: string; voice: string; tone: string; duration: number; windowDays: number; mode: string; sourceLocale: string; referenceUrls?: string[]; contentApproach?: 'news' | 'evergreen' | 'creative' | 'tradition'; autoRefresh: boolean }
type Observation = { text: string; evidenceIds: string[] }
type Opportunity = { title: string; whatChanged: string; eventDate: string | null; verification: string; whyItMatters: string; evidenceIds: string[]; positive: Observation[]; negative: Observation[]; audienceReaction: { status: string; summary: string; evidenceIds: string[]; limitations: string }; angle: string; hook: string; counterpoint: string; opportunityReason: string; keywords: string[] }
type Report = { refreshAvailableAt?: string | null; sourceStates?: { url: string; status: string; reason: string }[]; changes?: { previousReportId: string | null; limitations: string; counts: Record<string, number>; topics: { index: number; status: string; disposition: string }[] }; id: string; nicheId: string; niche: Niche; researchedAt: string; summary: string; opportunities: Opportunity[]; unknowns: string[]; evidence: StudioPackage['evidence']; methodology: string; searchQueries: string[]; searchEntryPoint: string }
type ReportSummary = Pick<Report, 'id' | 'nicheId' | 'researchedAt'>
type HistoryPage = { reports: ReportSummary[]; nextCursor: { before: string; beforeId: string } | null }
type ResearchJob = { jobId: string; status: string }
type Collection = { niche: Niche; reportId: string; researchedAt: string; topicCount: number; summary: string; refreshAvailableAt?: string | null }
const initial: Niche = { ...categoryDefaults, name: '', brief: '', audience: '', region: 'Global', language: 'Auto', voice: 'Auto', tone: 'Auto', duration: 45, windowDays: 7, mode: 'latest', sourceLocale: 'en-US', referenceUrls: [], autoRefresh: false }
const draftKey = (uid?: string) => `signal_niche_draft:${uid || 'guest'}:${activeWorkspace()}`
const nicheFields = (value: Niche) => ({ name: value.name, brief: value.brief, audience: value.audience, region: value.region, language: value.language, voice: value.voice, tone: value.tone, duration: value.duration, windowDays: value.windowDays, mode: value.mode || 'latest', sourceLocale: value.sourceLocale || 'en-US', referenceUrls: value.referenceUrls || [], contentApproach: value.contentApproach || 'news', coverage: value.coverage || 'international', country: value.country || '', topics: (value.topics || []).map(topic => topic.trim()).filter(Boolean), intent: value.intent || '', exclusions: value.exclusions || '', refreshIntervalDays: value.refreshIntervalDays || 7, autoRefresh: value.autoRefresh })
function initialDraft(uid?: string): Niche {
  try { const saved = JSON.parse(sessionStorage.getItem(draftKey(uid)) || 'null'); return saved && typeof saved.brief === 'string' ? { ...initial, ...saved } : initial } catch { return initial }
}

export function IntelligencePage() {
  const { identity } = useAuth()
  const { pathname, search } = useLocation()
  return <IntelligenceWorkspace key={`${identity?.uid || 'guest'}:${pathname}:${search}`} />
}

function TopicResearchDetails({ topic }: { topic: Opportunity }) {
  const details = topicResearchDetails(topic)
  return <section aria-label="Keyword intent and audience questions">
    <h3>Suggested keywords</h3>
    {details.keywords.length ? <div className="keyword-list">{details.keywords.map(keyword => <span key={keyword.term}>{keyword.term}</span>)}</div> : <p>No keyword suggestions were supplied.</p>}
    <p className="studio-muted">Search volume: unavailable · Audience intent: not researched.</p>
    <p className="studio-muted">Suggested terminology is not validated search demand. Relevance and intent need editorial research; no search volume or ranking is inferred.</p>
    <h3>Observed audience questions · unavailable</h3><p>{details.observedQuestions.reason}</p>
    <h3>Proposed questions · editorial suggestions</h3><p>{details.proposedQuestions.reason}</p><ul>{details.proposedQuestions.items.map(question => <li key={question}>{question}</li>)}</ul>
  </section>
}
function IntelligenceWorkspace() {
  const { identity, loading, configured } = useAuth()
  const uid = identity?.uid
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const { categoryId } = useParams()
  const entry = new URLSearchParams(search)
  const view = pathname === '/ideas' ? 'library' : categoryId && !pathname.endsWith('/edit') ? 'topics' : 'form'
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [niche, setNiche] = useState<Niche>(() => initialDraft(uid))
  const [referenceText, setReferenceText] = useState(() => (initialDraft(uid).referenceUrls || []).join('\n'))
  const [niches, setNiches] = useState<Niche[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [collectionSearch, setCollectionSearch] = useState('')
  const [workspace, setWorkspace] = useState({ personal: true, role: 'viewer' })
  const canWrite = workspace.role === 'owner' || workspace.role === 'editor'
  const [refresh, setRefresh] = useState(false)
  const [notice, setNotice] = useState('')
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [nextCursor, setNextCursor] = useState<HistoryPage['nextCursor']>(null)
  const [selectedReportId, setSelectedReportId] = useState('')
  const [fetchedReport, setReport] = useState<Report | null>(null)
  const report = fetchedReport?.id === selectedReportId ? fetchedReport : null
  const refreshAfter = report ? Date.parse(report.researchedAt) + (niche.refreshIntervalDays || 7) * 86400000 : 0
  const [config, setConfig] = useState<StudioConfig | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadErrors, setLoadErrors] = useState({ config: '', library: '', report: '' })
  const [confirmation, setConfirmation] = useState<Niche | null>(null)
  const [pendingResearch, setPendingResearch] = useState<{ nicheId: string; nicheRevision: number; requestId: string } | null>(null)
  const [jobs, setJobs] = useState<Record<string, ResearchJob>>({})
  const currentJob = jobs[niche.id || '']
  const currentJobId = currentJob?.jobId; const currentJobStatus = currentJob?.status
  const detailsDialog = useRef<HTMLDialogElement>(null)
  const [drafts, setDrafts] = useState<StudioPackage[]>([])
  useEffect(() => { if (!uid) return; let active = true; studioRead<{ packages: StudioPackage[] }>('/packages').then(value => { if (active) setDrafts(value.packages) }).catch(() => { /* The server still resolves existing drafts on click. */ }); return () => { active = false } }, [uid])
  const [selectedTopic, setSelectedTopic] = useState<number | null>(null)
  const [categorySection, setCategorySection] = useState<'ideas' | 'research'>('ideas')
  const [detailSection, setDetailSection] = useState<'idea' | 'evidence'>('idea')
  useEffect(() => { if (detailSection === 'evidence') document.getElementById('idea-evidence-view')?.focus() }, [detailSection])
  useEffect(() => {
    if (selectedTopic !== null) detailsDialog.current?.showModal()
  }, [selectedTopic])

  const [schedules, setSchedules] = useState<{ id: string; status: string; attemptedAt: string; error?: string }[]>([])
  useEffect(() => {
    let active = true
    studioRead<StudioConfig>('/config', false).then(value => { if (active) { setConfig(value); setLoadErrors(previous => ({ ...previous, config: '' })) } }).catch(() => { if (active) setLoadErrors(previous => ({ ...previous, config: 'Service availability could not be checked. Saved ideas are still available.' })) })
    return () => { active = false }
  }, [loadAttempt])
  useEffect(() => {
    if (!uid) return
    let active = true
    studioRead<HistoryPage & { collections: Collection[]; workspace: typeof workspace; niches: Niche[]; schedules: typeof schedules; states: (ResearchJob & { id: string })[] }>('/intelligence').then(data => {
      if (!active) return
      setLoadErrors(previous => ({ ...previous, library: '' }))
      setNiches(data.niches); setReports(data.reports); setNextCursor(data.nextCursor); setSchedules(data.schedules || [])
      setCollections(data.collections); setWorkspace(data.workspace)
      setJobs(Object.fromEntries((data.states || []).map(state => [state.id, { jobId: state.jobId, status: state.status }])))
      const requested = data.niches.find(item => item.id === categoryId)
      if (requested) { setNiche(requested); setReferenceText((requested.referenceUrls || []).join('\n')); setSelectedReportId(data.collections.find(item => item.niche.id === requested.id)?.reportId || '') }
      else if (categoryId) setError('This category is unavailable in your current workspace.')
      else { setNiche(initialDraft(uid)); setSelectedReportId('') }
      setSelectedTopic(null); setLibraryLoading(false)
    }).catch(cause => { if (active) { setLoadErrors(previous => ({ ...previous, library: cause.message })); setLibraryLoading(false) } })
    return () => { active = false }
  }, [uid, categoryId, loadAttempt])
  useEffect(() => {
    let active = true
    if (!selectedReportId) return
    studioRead<Report>(`/intelligence/reports/${selectedReportId}`).then(value => { if (active) { setReport(value); setLoadErrors(previous => ({ ...previous, report: '' })) } }).catch(cause => { if (active) setLoadErrors(previous => ({ ...previous, report: cause.message })) })
    return () => { active = false }
  }, [selectedReportId, loadAttempt])
  useEffect(() => {
    if (!currentJobId || !currentJobStatus || !['reserved', 'running'].includes(currentJobStatus) || !niche.id) return
    let active = true; let checking = false; let lastPollError = ''
    const nicheId = niche.id
    async function poll() {
      if (checking) return
      checking = true
      try {
        const job = await studioRead<{ id: string; status: string; result?: Report; error?: string }>(`/jobs/${encodeURIComponent(currentJobId)}`)
        if (!active) return
        if (lastPollError) { const recovered = lastPollError; setError(previous => previous === recovered ? '' : previous); lastPollError = '' }
        setJobs(previous => ({ ...previous, [nicheId]: { jobId: job.id, status: job.status } }))
        if (job.status === 'completed' && job.result) {
          const next = job.result
          setReports(previous => [{ id: next.id, nicheId: next.nicheId, researchedAt: next.researchedAt }, ...previous.filter(value => value.id !== next.id)])
          setSelectedReportId(next.id); setSelectedTopic(null); void trackEvent('research_completed')
          setCollections(previous => [{ niche: next.niche, reportId: next.id, researchedAt: next.researchedAt, topicCount: next.opportunities.length, summary: next.summary }, ...previous.filter(value => value.niche.id !== next.nicheId)])
        } else if (job.error) setError(job.error)
      } catch (cause) { if (active) { lastPollError = cause instanceof Error ? cause.message : 'Could not read job status. No new research was started.'; setError(lastPollError) } } finally { checking = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [currentJobId, currentJobStatus, niche.id])
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.') } finally { setBusy('') }
  }
  async function research(forceRefresh = false) {
    if (!identity) {
      try { sessionStorage.setItem(draftKey(uid), JSON.stringify(nicheFields(niche))) } catch { /* A disabled browser store must not block sign-in. */ }
      navigate(`/login?next=${encodeURIComponent(pathname + search)}`); return
    }
    if (!confirmation) { setRefresh(forceRefresh); setConfirmation({ ...niche, brief: niche.brief.trim() || `Find source-supported developments about ${niche.name} and explain their relevance and limitations.` }); return }
    await run('Queuing your confirmed research…', async () => {
      let command = pendingResearch
      if (!command) {
        const saved = await saveNiche(confirmation)
        if (!saved.id || !saved.revision) throw new Error('The saved research scope is incomplete. Reload before retrying.')
        command = { nicheId: saved.id, nicheRevision: saved.revision, requestId: crypto.randomUUID() }
        setPendingResearch(command)
      }
      const next = await studioRequest<(Report | { jobId: string; jobStatus: string; nicheId: string; niche?: Niche }) & { reused?: boolean }>('/intelligence/research', { ...command, confirmed: true, refresh }, 'POST')
      setNotice(next.reused ? 'Opened existing workspace research. No new model call or research allowance was used.' : '')
      if ('jobId' in next) { setJobs(previous => ({ ...previous, [next.nicheId]: { jobId: next.jobId, status: next.jobStatus } })); if (next.niche) { setNiche(next.niche); setReferenceText((next.niche.referenceUrls || []).join('\n')) } }
      else { setReports(previous => [{ id: next.id, nicheId: next.nicheId, researchedAt: next.researchedAt }, ...previous.filter(item => item.id !== next.id)]); setSelectedReportId(next.id); setSelectedTopic(null); setCollections(previous => [{ niche: next.niche, reportId: next.id, researchedAt: next.researchedAt, topicCount: next.opportunities.length, summary: next.summary }, ...previous.filter(value => value.niche.id !== next.nicheId)]) }
      setConfirmation(null); setPendingResearch(null); setRefresh(false)
      navigate(`/ideas/${encodeURIComponent(next.nicheId)}`)
    })
  }
  async function saveNiche(value = niche) {
    const existing = niches.find(item => item.id === value.id)
    if (existing && JSON.stringify(nicheFields(existing)) === JSON.stringify(nicheFields(value))) return existing
    const saved = await studioRequest<Niche>('/intelligence/niches', { niche: nicheFields({ ...value, brief: value.brief.trim() || `Find source-supported developments about ${value.name} and explain their relevance and limitations.` }), ...(value.id ? { id: value.id, revision: value.revision } : {}) }, 'POST')
    setNiche(saved); setNiches(previous => [saved, ...previous.filter(item => item.id !== saved.id)])
    try { sessionStorage.removeItem(draftKey(uid)) } catch { /* Optional draft cleanup. */ }
    return saved
  }
  async function create(index: number) {
    if (!report) return
    await run('Preparing your saved topic for the editor…', async () => {
      const pack = await studioRequest<StudioPackage>('/packages', { reuseExisting: true, researchId: report.id, opportunityIndex: index, requestId: crypto.randomUUID() }, 'POST')
      navigate(`/studio/${pack.id}`)
    })
  }
  const existingDraft = (index: number) => drafts.find(pack => pack.researchId === report?.id && (pack.opportunityIndex === index || (pack.opportunityIndex == null && pack.researchContext?.opportunity.title === report?.opportunities[index]?.title)))
  async function saveForLater(index: number) { if (!report) return; await run('Saving to Planner', async () => { await studioRequest('/planning/shortlist', { reportId: report.id, index }, 'POST'); setNotice('Saved for later in Content Planner. No content was generated.') }) }
  function citations(ids: string[]) {
    return <span className="source-chips">{ids.map(id => { const source = report?.evidence.find(item => item.id === id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id} ↗</a> : null })}</span>
  }
  const visibleReports = reports.filter(item => item.nicheId === niche.id)
  const loadFailure = Object.values(loadErrors).filter(Boolean).join(' ')
  const retryNotice = loadFailure && <div className="studio-alert" role="alert"><p>{loadFailure}</p><button type="button" onClick={() => { setLoadErrors({ config: '', library: '', report: '' }); setLoadAttempt(value => value + 1); if (!niches.length) setLibraryLoading(true) }}>Try again</button></div>
  if ((loading && view !== 'library') || (categoryId && identity && libraryLoading)) return <section className="studio discovery-page category-page" role="status"><p className="library-loading-status"><span className="library-loading-spinner" aria-hidden="true" />Opening your category…</p><div className="discovery-cards" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div className="studio-panel category-skeleton" key={index}><span className="skeleton-line skeleton-line-short" /><span className="skeleton-line skeleton-line-title" /><span className="skeleton-line" /><span className="skeleton-line skeleton-line-medium" /></div>)}</div></section>
  if (categoryId && !identity) return <section className="studio discovery-page"><h1>Sign in to explore this category</h1><Link className="idea-action" to={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link></section>
  if (categoryId && !niches.some(item => item.id === categoryId)) return <section className="studio discovery-page"><h1>{loadErrors.library ? 'Could not load this category' : 'Category unavailable'}</h1>{retryNotice || <p role="alert">{error || 'This category is not available in your current workspace.'}</p>}<Link to="/ideas">Back to your Topic Library</Link></section>
  if (view === 'library') return <section className="studio discovery-page library-page">{retryNotice}{error && <p role="alert" className="studio-alert">{error}</p>}{identity || loading ? (loadErrors.library && !niches.length ? <h1>Could not load your Topic Library</h1> : <IdeaLibrary categories={niches} collections={collections} search={collectionSearch} setSearch={setCollectionSearch} personal={workspace.personal} loading={loading || libraryLoading} jobs={jobs} />) : <div className="studio-panel"><h1>Your Topic Library</h1><p>Sign in to explore your workspace’s saved categories.</p><Link className="idea-action" to="/login?next=%2Fideas">Sign in</Link></div>}</section>
  return <section className={`studio discovery-page${view === 'topics' ? ' category-page' : ''}`} aria-busy={Boolean(busy)}>
    <nav className="idea-breadcrumbs" aria-label="Breadcrumb"><Link to="/ideas">Topic Library</Link><span aria-hidden="true">/</span><span>{view === 'form' ? 'Find ideas' : niche.name}</span></nav>
    <>{entry.has('reused') && <p role="status" className="studio-notice">Opened your existing category.</p>}{entry.has('trending') && <p className="studio-muted">These are saved research ideas. Measured trend rankings are unavailable.</p>}{entry.get('research') === 'not-started' && <p role="alert" className="studio-alert">Your category was saved, but research could not be confirmed. Check its status before trying again.</p>}</>{<header className="discovery-hero">{view === 'form' && <span className="studio-eyebrow"><Sparkles size={15} aria-hidden="true" /> {categoryId ? "MAKE IT YOURS" : "FOLLOW YOUR CURIOSITY"}</span>}<h1>{view === 'form' ? (categoryId ? 'Category settings' : 'What inspires you?') : niche.name}</h1><p>{view === 'form' ? 'Choose your research scope and refresh schedule. Saved ideas stay available.' : 'Choose an idea to create content.'}</p></header>}

    {error && <div className="studio-alert" role="alert">{error}</div>}
    {retryNotice}
    {notice && <p className="studio-panel" role="status">{notice}</p>}

    {currentJob && ['reserved', 'running', 'dispatch_unknown', 'failed'].includes(currentJob.status) && <div className={`studio-panel category-research-status is-${currentJob.status}`} role="status"><Radar size={20} aria-hidden="true" /><div><strong>{currentJob.status === 'reserved' ? 'Waiting to start research' : currentJob.status === 'running' ? 'Research in progress' : currentJob.status === 'dispatch_unknown' ? 'Research needs a status check' : 'Research could not finish'}</strong><p>{currentJob.status === 'reserved' ? 'This request has not started yet. You can cancel it and review your category settings.' : currentJob.status === 'running' ? 'We’re researching your category. You can leave and return; results are saved here.' : currentJob.status === 'dispatch_unknown' ? 'The previous attempt must be checked before starting another. Your saved ideas are safe.' : (report ? 'Your saved ideas are safe. Try research again to get fresh results.' : 'This attempt did not save any ideas. Try research again with your saved category settings.')}</p></div>{currentJob.status === 'failed' && canWrite && <button className="primary-action" disabled={Boolean(busy) || !config?.capabilities.research} onClick={() => void research(true)}>Try research again</button>}{currentJob.status === 'reserved' && canWrite && <button disabled={Boolean(busy)} onClick={() => { if (window.confirm('Cancel this queued research before dispatch?')) void run('Cancelling queued research', async () => { const cancelled = await studioRequest<{ status: string }>(`/jobs/${encodeURIComponent(currentJobId)}/cancel`, {}, 'POST'); setJobs(previous => ({ ...previous, [niche.id || '']: { ...currentJob, status: cancelled.status } })) }) }}>Cancel request</button>}</div>}
    <div className={`discovery-layout journey-${view}`}>{view === 'form' && <aside>
      <form className="studio-panel brief-panel" onChange={() => { setConfirmation(null); setPendingResearch(null) }} onSubmit={event => { event.preventDefault(); if (categoryId && !confirmation) void run('Saving settings', async () => { const saved = await saveNiche(); navigate(`/ideas/${saved.id}`) }); else void research() }}>
        <div className="studio-toolbar"><h2>{categoryId ? "Your category" : "Research brief"}</h2>{categoryId && <Link to={`/ideas/${categoryId}`}>Back to ideas</Link>}</div>

        <label>Category name<input id="discovery-topic" name="topic" autoComplete="off" required maxLength={100} minLength={2} value={niche.name} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, name: event.target.value })} placeholder="AI, fitness, cinema, cricket…" /></label>
        <CategorySetupFields value={{ ...categoryDefaults, ...niche }} onChange={patch => { setNiche({ ...niche, ...patch }); setConfirmation(null) }} disabled={Boolean(busy)} />
        <details className="discovery-advanced"><summary>More options <span>Reference links, audience & source preferences</span></summary><label>Research brief (optional)<textarea minLength={15} maxLength={4000} className="brief-input" disabled={Boolean(busy)} value={niche.brief} onChange={event => setNiche({ ...niche, brief: event.target.value })} placeholder="For example: practical AI launches for small business owners. Leave blank for a source-supported overview of your topic." /></label>
        <label>Reference article URLs (up to 5, one per line)<textarea maxLength={10004} value={referenceText} disabled={Boolean(busy)} onChange={event => { setReferenceText(event.target.value); setNiche({ ...niche, referenceUrls: event.target.value.split('\n').map(url => url.trim()).filter(Boolean) }) }} placeholder="https://publisher.com/original-article" /></label>
        <details><summary>Audience & production preferences</summary><p className="studio-muted">Optional. Auto uses your brief to suggest a starting point. Recommendations are hypotheses to test.</p>
          <label>Audience<input maxLength={300} value={niche.audience} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, audience: event.target.value })} placeholder="Infer from my brief" /></label>
          <label>Market / region<input maxLength={100} value={niche.region} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, region: event.target.value })} /></label>
          <div className="studio-fields">{([['voice', 'Voice', ['Auto', 'Female', 'Male']], ['tone', 'Delivery', ['Auto', 'Calm', 'Conversational', 'Energetic']]] as const).map(([key, label, options]) => <label key={key}>{label}<select disabled={Boolean(busy)} value={niche[key]} onChange={event => setNiche({ ...niche, [key]: event.target.value })}>{options.map(value => <option key={value}>{value}</option>)}</select></label>)}
          <label>Video length (seconds)<input type="number" min={15} max={180} value={niche.duration} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, duration: Number(event.target.value) })} /></label></div>
        </details>
        
        <label>Discovery mode<select value={niche.mode || 'latest'} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, mode: event.target.value })}><option value="latest">Latest news</option><option value="recommended">Recommended angles (editorial)</option><option value="trending" disabled>Trending — measured data unavailable</option><option value="most-viewed" disabled>Most viewed — platform metrics unavailable</option></select></label>
        <label>News source edition<select value={niche.sourceLocale || 'en-US'} disabled={Boolean(busy)} onChange={event => setNiche({ ...niche, sourceLocale: event.target.value })}><option value="en-US">United States · English</option><option value="en-GB">United Kingdom · English</option><option value="en-IN">India · English</option><option value="hi-IN">India · Hindi</option></select></label>
        <p className="studio-muted">This edition limits the news source. Audience region guides the brief; it does not establish global coverage. Output language is separate.</p>
        </details>
      {confirmation && <div role="status" className="studio-panel setup-confirm"><h3>{refresh ? 'Refresh your ideas now?' : 'Ready to find ideas?'}</h3><p>{confirmation.intent || confirmation.brief}</p><p><strong>Coverage:</strong> {confirmation.coverage === 'both' ? 'International + national' : confirmation.coverage || 'International'}{confirmation.country ? ` · ${confirmation.country}` : ''}</p><p><strong>Topics:</strong> {(confirmation.topics || []).join(', ') || confirmation.name}</p><p>Search the last {confirmation.windowDays} days. Results in {confirmation.language === 'Auto' ? 'the language suggested by your brief' : confirmation.language}.</p><p>{config?.capabilities.vertexFallback ? 'Tries free AI first. If it fails, the approved Gemini fallback may use your remaining testing budget.' : 'Uses your free AI allowance. No paid fallback.'} Your saved ideas stay available if research fails.</p><button type="button" onClick={() => { setConfirmation(null); setPendingResearch(null); setRefresh(false) }}>Cancel</button></div>}

        {identity && config && !config.capabilities.research && <p role="status" className="discovery-provider-notice">New research is unavailable right now. You can still explore your saved ideas.</p>}
        <div className="category-save-bar">{categoryId && !confirmation ? <><button className="primary-action" disabled={Boolean(busy) || !canWrite}>{busy ? 'Saving…' : 'Save settings'}</button><button type="button" disabled={Boolean(busy) || !canWrite || !config?.capabilities.research || ['reserved','running','dispatch_unknown'].includes(currentJob?.status || '')} onClick={() => void research(true)}>Review & research now</button><p>Saving settings does not run research immediately.</p></> : <>
        <button className="primary-action" disabled={Boolean(busy) || (currentJob && ['reserved', 'running', 'dispatch_unknown'].includes(currentJob.status)) || loading || (!identity && !configured) || (Boolean(identity) && (!canWrite || !config?.capabilities.research))}>{identity ? (confirmation ? (refresh ? 'Confirm refresh' : 'Confirm & find ideas') : 'Find ideas') : 'Sign in to find ideas'}<ArrowRight size={16} /></button>
        {identity && <button type="button" disabled={Boolean(busy) || !canWrite || niche.name.trim().length < 2} onClick={() => void run('Saving preferences', async () => { const saved = await saveNiche(); setConfirmation(null); setPendingResearch(null); navigate(`/ideas/${saved.id}`) })}>Save category without research</button>}
        </>}</div>
        <details className="discovery-service-notes"><summary>Research limits & saved preferences</summary><p className="studio-muted">Briefings use supplied reference passages and news excerpts; audience discussions and linked pages are not crawled. Your brief is saved per niche; up to 10 briefings per day, subject to the configured model allowance.</p>
        {identity && <><p className="studio-muted">Manual refresh requires confirmation. Automatic refresh uses your saved interval and the free-provider allowance.</p>{schedules.filter(item => item.id === niche.id).map(item => <p key={item.id} className="studio-muted">Last automatic dispatch: {new Date(item.attemptedAt).toLocaleString()} · {item.status}</p>)}</>}        {!loading && !configured && <p role="status">Account access needs to be configured before private research can run. <Link to="/dashboard">Explore public updates</Link></p>}
        </details>
        {!configured && <p role="status" className="studio-muted">You can prepare your topic now. Account access must be configured before research can start.</p>}

      </form>
      <Link className="studio-button" to="/studio">Open your content library →</Link>
    </aside>}{view === 'form' ? <div className="find-ideas-guide category-settings-summary"><span className="studio-eyebrow">YOUR RESEARCH AT A GLANCE</span><h2>{niche.name || 'Your category'}</h2><dl><div><dt>Coverage</dt><dd>{niche.coverage === 'both' ? 'International + national' : niche.coverage === 'national' ? 'National' : 'International'}{niche.country ? ` · ${niche.country}` : ''}</dd></div><div><dt>News age</dt><dd>Last {niche.windowDays} days</dd></div><div><dt>Refresh</dt><dd>{niche.autoRefresh ? `Every ${niche.refreshIntervalDays || 7} days` : 'Only when you choose'}</dd></div></dl><p>Your team reuses the saved results. Opening a category does not call AI.</p><Link to={categoryId ? `/ideas/${categoryId}` : '/ideas'}>View saved ideas →</Link></div> : <div className="intelligence-results">
        {<>
        <div className="category-toolbar"><nav className="category-view-nav" aria-label="Category view"><button type="button" aria-pressed={categorySection === 'ideas'} onClick={() => { setCategorySection('ideas'); document.getElementById('main-content')?.scrollIntoView({ behavior: 'instant' }) }}>Ideas{report ? ` (${report.opportunities.length})` : ''}</button><button type="button" aria-pressed={categorySection === 'research'} onClick={() => { setCategorySection('research'); document.getElementById('main-content')?.scrollIntoView({ behavior: 'instant' }) }}>Research & sources</button></nav>{report && <div className="category-actions"><button type="button" disabled={Boolean(busy) || !canWrite || !config?.capabilities.research || ['reserved', 'running'].includes(currentJob?.status || '')} onClick={() => { setRefresh(true); setPendingResearch(null); setConfirmation(niches.find(item => item.id === categoryId) || report.niche) }}>{['reserved', 'running'].includes(currentJob?.status || '') ? 'Researching…' : 'Refresh now'}</button><Link to={`/ideas/${categoryId}/edit`}>Category settings</Link></div>}</div>
        {report && <div className="category-snapshot"><span><strong>{report.opportunities.length}</strong> saved ideas</span><span><strong>{report.evidence.length}</strong> sources</span><span>Updated {new Date(report.researchedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</span>{niche.autoRefresh && refreshAfter > 0 && <span>Next automatic refresh: {new Date(refreshAfter).toLocaleString()}.</span>}</div>}
      </>}
      {categorySection === 'research' && (visibleReports.length > 0 || nextCursor) && <section className="studio-panel research-history"><h2>Saved research</h2><div className="studio-toolbar">{visibleReports.length > 0 && <label>Saved research<select disabled={Boolean(busy)} value={selectedReportId} onChange={event => { setSelectedReportId(event.target.value); setSelectedTopic(null) }}><option value="">Choose a briefing</option>{visibleReports.map(item => <option key={item.id} value={item.id}>{new Date(item.researchedAt).toLocaleString()}</option>)}</select></label>}{nextCursor && <button disabled={Boolean(busy)} onClick={() => void run('Loading older briefings', async () => {
        const page = await studioRead<HistoryPage>(`/intelligence/reports?${new URLSearchParams(nextCursor)}`)
        setReports(previous => [...previous, ...page.reports.filter(item => !previous.some(existing => existing.id === item.id))]); setNextCursor(page.nextCursor)
      })}>Load older briefings</button>}</div></section>}
      {confirmation && <section className="studio-panel refresh-confirm" role="status"><h2>Find fresh ideas?</h2><p>We’ll research {confirmation.name} again. Your saved ideas stay available. {config?.capabilities.vertexFallback ? 'Tries free AI first, then the approved Gemini fallback within your remaining testing budget if needed.' : 'This uses one free research allowance; there is no paid fallback.'}</p><p>Coverage: {confirmation.coverage || "international"}{confirmation.country ? ` · ${confirmation.country}` : ""}. Topics: {(confirmation.topics || []).join(", ") || "From your brief"}.</p><p>{confirmation.intent}</p><button disabled={Boolean(busy)} onClick={() => void research()}>Confirm refresh</button><button disabled={Boolean(busy)} onClick={() => { setConfirmation(null); setPendingResearch(null); setRefresh(false) }}>Cancel</button></section>}
      {selectedReportId && !report && !loadErrors.report && <div role="status"><p className="library-loading-status"><span className="library-loading-spinner" aria-hidden="true" />Loading saved ideas…</p><div className="discovery-cards" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div className="studio-panel category-skeleton" key={index}><span className="skeleton-line skeleton-line-short" /><span className="skeleton-line skeleton-line-title" /><span className="skeleton-line" /><span className="skeleton-line skeleton-line-medium" /></div>)}</div></div>}
      {!report && !selectedReportId && categorySection === 'research' && <section className="studio-panel"><h2>{visibleReports.length ? 'Choose a saved briefing' : 'No saved research yet'}</h2><p>{visibleReports.length ? 'Choose a briefing above to read its sources and research notes.' : 'Research sources will appear here after your first confirmed research run.'}</p></section>}
      {busy && <div className="studio-panel research-progress" role="status"><Radar size={25} /><div><strong>{busy}</strong><p>This can take a few minutes. Your previous work stays saved.</p></div></div>}
      {!report && !selectedReportId && categorySection === 'ideas' && <section className="studio-panel intelligence-empty category-empty" aria-label="No saved ideas"><CategoryCover name={niche.name} /><div className="category-empty-copy"><span className="category-empty-count">0 saved ideas</span><h2>Your ideas will appear here</h2><p>{currentJob && ['reserved', 'running'].includes(currentJob.status) ? 'After research finishes, choose an idea to explore its keywords, sources and content angle.' : 'Research this category to discover ideas with supporting sources. Then choose one to create your content.'}</p>{categoryId && <Link className="idea-action" to={`/ideas/${categoryId}/edit`}>{currentJob && ['reserved', 'running'].includes(currentJob.status) ? 'View category settings' : 'Set up research'} <ArrowRight size={16} aria-hidden="true" /></Link>}</div></section>}{report && <>
        {categorySection === 'ideas' && <><h2 className="sr-only">Pick your next idea</h2>
        {!report.opportunities.length && <div className="studio-panel"><h2>No supported ideas yet</h2><p>Try a wider research window or a more specific topic. No developments will be invented to fill this board.</p></div>}
        <div className="discovery-cards">{report.opportunities.map((topic, index) => <article className="discovery-card" key={`${report.id}-${index}`}><span className="idea-card-top"><span className={`idea-verification is-${topic.verification}`}>{topic.verification === 'reported' ? 'Source reported' : topic.verification === 'disputed' ? 'Disputed claim' : 'Needs verification'}</span><span className="idea-date">{topic.eventDate ? new Date(`${topic.eventDate}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'Date unconfirmed'}</span></span><h3><button className="idea-title-action" disabled={Boolean(busy) || !canWrite} onClick={() => void create(index)}>{topic.title}</button></h3><span className="idea-card-summary">{topic.whatChanged}</span>{topic.keywords?.length > 0 && <span className="idea-card-keywords"><span className="idea-keyword-label">Keywords</span>{topic.keywords.slice(0, 3).map(keyword => <span key={keyword}>{keyword}</span>)}</span>}<span className="idea-card-bottom"><span>{topic.evidenceIds?.length ? `${topic.evidenceIds.length} supporting ${topic.evidenceIds.length === 1 ? 'source' : 'sources'}` : 'Sources unavailable'}</span></span><div className="idea-card-actions"><button className="primary-action" disabled={Boolean(busy) || !canWrite} onClick={() => void create(index)}>{existingDraft(index) ? 'Continue draft' : 'Create content'} <ArrowRight size={15} aria-hidden="true" /></button><button aria-haspopup="dialog" onClick={() => { setDetailSection('idea'); setSelectedTopic(index) }}>Quick details</button><button disabled={Boolean(busy) || !canWrite} onClick={() => void saveForLater(index)}>Save for later</button></div></article>)}</div></>}

        {selectedTopic !== null && report.opportunities[selectedTopic] && (() => {
          const topic = report.opportunities[selectedTopic]
          return <dialog ref={detailsDialog} className="idea-quick-dialog" aria-label="Quick idea details" onClose={() => setSelectedTopic(null)}><article id="discovery-topic-detail" tabIndex={-1} className="idea-workspace">
            <button type="button" className="idea-back" onClick={() => detailsDialog.current?.close()}>Close details</button>
            {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}<header className="idea-detail-heading"><CategoryCover name={niche.name} /><div className="idea-heading-copy"><span className="idea-detail-label">Your content brief</span><h1>{topic.title}</h1><div className="idea-detail-meta"><span className={`idea-verification is-${topic.verification}`}>{topic.verification === 'reported' ? 'Reported in sources' : topic.verification === 'disputed' ? 'Disputed claim' : 'Needs verification'}</span><span>{topic.evidenceIds.length} supporting {topic.evidenceIds.length === 1 ? 'source' : 'sources'}</span></div></div></header>
            <div className="idea-detail-layout"><div className="idea-detail-main">
              <nav className="category-view-nav idea-detail-nav" aria-label="Idea details"><button type="button" aria-pressed={detailSection === 'idea'} onClick={() => setDetailSection('idea')}>Content idea</button><button type="button" aria-pressed={detailSection === 'evidence'} onClick={() => setDetailSection('evidence')}>Evidence & checks</button></nav>
              {detailSection === 'idea' ? <div className="idea-detail-sections">
                <section className="idea-info-card idea-summary-card"><h2>The idea at a glance</h2><p>{topic.whatChanged}</p></section>
                <section className="idea-info-card idea-opening-card"><h2><Sparkles size={17} aria-hidden="true" />Suggested opening</h2><blockquote>{topic.hook}</blockquote><span className="idea-card-hint">A starting line you can adapt for your audience.</span></section>
                <section className="idea-info-card idea-angle-card"><h2>What to focus on</h2><p>{topic.angle}</p><h3>Why your audience might care</h3><p>{topic.whyItMatters}</p><p className="idea-card-hint">{topic.opportunityReason}</p></section>
              </div> : <div id="idea-evidence-view" tabIndex={-1} className="idea-detail-sections">
                <section className="idea-info-card"><h2>Evidence & limitations</h2>{citations(topic.evidenceIds)}<p>{topic.whatChanged}</p><h3>A different perspective</h3><p>{topic.counterpoint}</p><div className="reaction-columns"><div><h3>Positive signals</h3>{topic.positive.length ? topic.positive.map((item, i) => <p key={i}>{item.text} {citations(item.evidenceIds)}</p>) : <p>No supported positive observations.</p>}</div><div><h3>Concerns</h3>{topic.negative.length ? topic.negative.map((item, i) => <p key={i}>{item.text} {citations(item.evidenceIds)}</p>) : <p>No supported criticism.</p>}</div></div><h3>Audience reaction · {topic.audienceReaction.status.replaceAll('-', ' ')}</h3><p>{topic.audienceReaction.summary} {citations(topic.audienceReaction.evidenceIds)}</p><p>{topic.audienceReaction.limitations}</p>{report.changes?.topics[selectedTopic] && <p>{report.changes.topics[selectedTopic].status.replaceAll('-', ' ')} · {report.changes.topics[selectedTopic].disposition.replaceAll('-', ' ')}</p>}</section>
                <section className="idea-info-card idea-questions-card"><h2>Reader questions & keyword notes</h2><TopicResearchDetails topic={topic} /></section>
                <button type="button" className="idea-source-button" onClick={() => { setSelectedTopic(null); setCategorySection('research'); document.getElementById('main-content')?.focus(); document.getElementById('main-content')?.scrollIntoView({ behavior: 'instant' }) }}>View all research sources <ArrowRight size={16} aria-hidden="true" /></button>
              </div>}
            </div><aside className="idea-detail-aside" aria-label="Create content and keywords">
              <section className="idea-create-card"><h2>Make this idea yours</h2><p>Turn this research into a post, carousel or script.</p><button type="button" className="primary-action" disabled={Boolean(busy) || !canWrite} onClick={() => void create(selectedTopic)}>{busy ? 'Opening Studio…' : existingDraft(selectedTopic) ? 'Continue draft' : 'Create content'} <ArrowRight size={17} aria-hidden="true" /></button><button type="button" disabled={Boolean(busy) || !canWrite} onClick={() => void run('Saving to Planner', async () => { await studioRequest('/planning/shortlist', { reportId: report.id, index: selectedTopic }, 'POST'); setNotice('Saved to Planner. No content was generated.') })}>Save for later</button><Link to="/planning">Open Planner</Link><p className="idea-card-hint">Next: choose your platforms and formats. Generation starts after you confirm.</p>{!canWrite && <p className="idea-card-hint">An owner or editor can create drafts in this workspace.</p>}</section>
              <section className="idea-info-card idea-keyword-card"><h2>Suggested keywords</h2><div className="keyword-list">{topic.keywords?.length ? topic.keywords.map(keyword => <span key={keyword}>{keyword}</span>) : <p>No keywords suggested yet.</p>}</div><p className="idea-card-hint">Suggested terms, not measured search demand.</p></section>
              {detailSection === 'idea' && <button type="button" className="idea-review-link" onClick={() => setDetailSection('evidence')}>Check evidence & limitations <ArrowRight size={16} aria-hidden="true" /></button>}
            </aside></div>
          </article></dialog>
        })()}
        {categorySection === 'research' && selectedTopic === null && <div className="category-research">
          <section className="studio-panel"><h2>Research overview</h2><p className="briefing-summary">{report.summary}</p><dl className="research-facts"><div><dt>Researched</dt><dd>{new Date(report.researchedAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' })} (India time)</dd></div><div><dt>Coverage</dt><dd>Last {report.niche.windowDays} days · {report.niche.sourceLocale || 'Edition not recorded'}</dd></div><div><dt>Selection</dt><dd>{report.niche.mode === 'recommended' ? 'Editorial recommendations' : report.niche.mode || 'Latest news'}</dd></div></dl>{report.opportunities.length < 10 && <p className="category-research-note">This saved collection has fewer than 10 ideas. New research aims for 10–12; we never invent stories to fill the gaps.</p>}</section>
          {report.changes && <section className="studio-panel"><h2>Changes since the previous research</h2><p>{Object.entries(report.changes.counts).map(([status, count]) => `${count} ${status.replaceAll('-', ' ')}`).join(' · ')}</p><p className="studio-muted">{report.changes.limitations}</p></section>}
        {report.unknowns.length > 0 && <section className="studio-panel"><h2>What the research could not establish</h2><ul>{report.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
        {!!report.sourceStates?.length && <section className="studio-panel"><h2>Reference availability</h2>{report.sourceStates.map((source, index) => <p key={index}><strong>{source.status}</strong> · {source.url}<br />{source.reason}</p>)}</section>}
        <section className="studio-panel"><h2>Sources & research method ({report.evidence.length})</h2><p>{report.methodology}</p>{report.evidence.map(item => <article className="studio-evidence" key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.id} · {item.title} ↗</a><p className="studio-muted">{item.type} · Retrieved {new Date(item.retrievedAt).toLocaleString()}</p><p>{item.limitations.join(' ')}</p><details><summary>Read captured evidence</summary><blockquote>{item.excerpt}</blockquote></details></article>)}<p className="studio-muted">Searches: {report.searchQueries.join(' · ')}</p></section>
        {report.searchEntryPoint && <iframe title="Google Search suggestions" className="search-suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={report.searchEntryPoint} />}
        </div>}
      </>}
    </div>}</div>
  </section>
}

