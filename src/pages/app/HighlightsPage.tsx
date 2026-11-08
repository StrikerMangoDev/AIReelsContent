import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, Sparkles, RefreshCw, ExternalLink } from 'lucide-react'
import { useAuth } from '@/context/auth-state'
import { studioRead, studioRequest, type StudioPackage } from '@/services/studio-api'
import { cleanCopy } from './ContentPreview'
import { CategoryCover } from './IdeaLibrary'
import '@/styles/studio.css'
import '@/styles/workspace-settings.css'
import '@/styles/highlights.css'

type Idea = { reportId: string; categoryId: string; category: string; index: number; title: string; summary: string; angle: string; whyItMatters: string; keywords: string[]; researchedAt: string; fresh: boolean; reasons: string[]; sources: { id: string; title: string; url: string; publisher: string; limitations?: string[] }[] }
type Picks = { ideas: Idea[]; considered: number; categoryCount: number; role: string }
type Publication = { id: string; title: string; publishedAt: string; correctionRequired?: boolean }
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function TopIdeasPage() {
  const { identity, loading } = useAuth()
  return loading ? <p role="status">Checking account…</p> : !identity ? <Link to="/login?next=%2Fdashboard">Sign in to see your top ideas</Link> : <TopIdeas key={identity.uid} />
}
function TopIdeas() {
  const navigate = useNavigate()
  const [data, setData] = useState<Picks | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [category, setCategory] = useState('all')
  const [busy, setBusy] = useState('')
  useEffect(() => { let active = true; studioRead<Picks>('/intelligence/top-ideas').then(value => { if (active) setData(value) }).catch(cause => { if (active) setError(cause.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [reload])
  function refresh() { setLoading(true); setError(''); setData(null); setReload(value => value + 1) }
  async function open(idea: Idea) {
    setBusy(`${idea.reportId}:${idea.index}`); setError('')
    try { const pack = await studioRequest<StudioPackage>('/packages', { reuseExisting: true, researchId: idea.reportId, opportunityIndex: idea.index, requestId: crypto.randomUUID() }, 'POST'); navigate(`/studio/${pack.id}`) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open this idea. Try again.') } finally { setBusy('') }
  }
  const visible = data?.ideas.filter(idea => category === 'all' || idea.categoryId === category) || []
  return <section className="studio settings-page highlights-page" aria-busy={loading}>
    <header className="settings-heading"><div><h1>Top ideas</h1><p>The strongest starting points from your saved category research.</p></div><button disabled={loading || Boolean(busy)} onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Refresh picks</button></header>
    <div className="highlights-intro"><Sparkles size={24} aria-hidden="true" /><div><strong>Less browsing. A better place to start.</strong><p>Explore a shortlist, check why it was selected, then open it in Studio. Existing drafts are continued automatically.</p></div><Link to="/ideas">All categories <ArrowRight size={16} aria-hidden="true" /></Link></div>
    <details className="highlights-method"><summary>How are ideas selected?</summary><p>We compare the latest saved research from every category in this workspace. Only source-reported ideas with usable source excerpts and a content angle qualify. Source diversity, research freshness and editorial context determine priority. We show up to 30% of qualifying ideas (rounded up), at most 12 overall and 3 per category, with repeated titles removed.</p><p>This is an editorial shortlist, not a popularity score or independent fact-check. Older research is marked. Refresh picks rereads saved data; it does not run AI or refresh category research.</p></details>
    {error && <div role="alert" className="settings-message error">{error} {!busy && <button onClick={refresh}>Reload picks</button>}</div>}
    {loading ? <div className="settings-surface settings-loading" role="status"><span />Selecting from saved research…<span /><span /></div> : data && <>
      <div className="highlights-toolbar"><p><strong>{data.ideas.length} selected</strong> from {data.considered} ideas across {data.categoryCount} categories</p><label>Category<select name="selected-category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All selected categories</option>{[...new Map(data.ideas.map(idea => [idea.categoryId, idea.category])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      {!visible.length ? <div className="settings-surface settings-empty"><Sparkles size={28} aria-hidden="true" /><h2>{data.ideas.length ? 'No picks in this category' : 'Your shortlist is waiting for research'}</h2><p>{data.ideas.length ? 'Choose another category to see your selected ideas.' : 'Research a category in Topic Library. Ideas need source support and a clear angle before they appear here.'}</p><Link to="/ideas">Open Topic Library →</Link></div> : <div className="highlights-list">{visible.map(idea => <article className="highlight-idea" key={`${idea.reportId}:${idea.index}`}><div className="highlight-cover"><CategoryCover name={idea.category} /><span>{idea.category}</span></div><div className="highlight-body"><div className="highlight-meta"><span>Source reported</span><span>Researched {date(idea.researchedAt)}</span>{!idea.fresh && <strong>Check freshness</strong>}</div><h2>{idea.title}</h2><p>{idea.summary}</p><div className="highlight-reasons" aria-label="Why selected">{idea.reasons.map(reason => <span key={reason}>{reason}</span>)}</div><div className="highlight-angle"><strong>Your content angle</strong><p>{idea.angle}</p></div><footer><button className="settings-primary" disabled={Boolean(busy) || !['owner','editor'].includes(data.role)} onClick={() => void open(idea)}>{busy === `${idea.reportId}:${idea.index}` ? 'Opening Studio…' : 'Open in Studio'} <ArrowRight size={16} aria-hidden="true" /></button><Link to={`/ideas/${idea.categoryId}`}>Explore category</Link>{!['owner','editor'].includes(data.role) && <small>An editor can create content from this idea.</small>}</footer><details className="highlight-sources"><summary>View {idea.sources.length} supporting {idea.sources.length === 1 ? 'source' : 'sources'}</summary>{idea.sources.map(source => <div key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={13} aria-hidden="true" /></a><p>{source.publisher}</p>{source.limitations?.map((limit, i) => <small key={i}>{limit}</small>)}</div>)}</details></div></article>)}</div>}
    </>}
  </section>
}

export function WebsiteInsightsPage() {
  const { identity, loading } = useAuth()
  return loading ? <p role="status">Checking account…</p> : !identity ? <Link to="/login?next=%2Finsights">Sign in to see website articles</Link> : <WebsiteInsights key={identity.uid} />
}
function WebsiteInsights() {
  const [drafts, setDrafts] = useState<StudioPackage[]>([])
  const [published, setPublished] = useState<Publication[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState('drafts')
  useEffect(() => { let active = true; Promise.all([studioRead<{packages: StudioPackage[]}>('/packages'), studioRead<{publications: Publication[]}>('/publications', false)]).then(([saved, publicData]) => { if (active) { setDrafts(saved.packages.filter(pack => pack.content?.website || pack.settings.outputs?.includes('website')).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); setPublished(publicData.publications.sort((a,b) => b.publishedAt.localeCompare(a.publishedAt))) } }).catch(cause => { if (active) setError(cause.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [reload])
  function refresh() { setLoading(true); setError(''); setReload(value => value + 1) }
  return <section className="studio settings-page highlights-page" aria-busy={loading}>
    <header className="settings-heading"><div><h1>Website insights</h1><p>Turn your research into useful articles for your website.</p></div><Link className="studio-button" to="/dashboard">Find a top idea <ArrowRight size={16} aria-hidden="true" /></Link></header>
    <div className="highlights-intro"><FileText size={24} aria-hidden="true" /><div><strong>Your article desk</strong><p>Choose an idea → select Blog / website article in Studio → edit and download. Publishing stays a separate action.</p></div></div>
    <div className="highlights-toolbar"><div className="settings-filters" role="group" aria-label="Article view"><button aria-pressed={view === 'drafts'} onClick={() => setView('drafts')}>Workspace drafts{!loading && !error ? ` (${drafts.length})` : ''}</button><button aria-pressed={view === 'published'} onClick={() => setView('published')}>Public articles{!loading && !error ? ` (${published.length})` : ''}</button></div><button onClick={refresh} disabled={loading}><RefreshCw size={16} aria-hidden="true" /> Refresh</button></div>
    <p className="highlights-scope">{view === 'drafts' ? 'Private to the current workspace. Saved drafts are not live website pages.' : 'Publicly published articles from this application, across workspaces. These are separate from your private drafts.'}</p>
    {error && <div role="alert" className="settings-message error">{error} <button onClick={refresh}>Try again</button></div>}
    {loading ? <div className="settings-surface settings-loading" role="status"><span />Loading saved articles…<span /></div> : !error && <div className="settings-surface article-desk">{view === 'drafts' ? drafts.length ? drafts.map(pack => <article key={pack.id}><span className="settings-icon"><FileText size={21} aria-hidden="true" /></span><div><span className="settings-pill">{pack.error || ['failed', 'dispatch_unknown'].includes(pack.jobStatus || '') ? 'Needs attention' : pack.content?.website ? 'Article draft' : 'Awaiting generation'}</span><h2><Link to={`/studio/${pack.id}`}>{cleanCopy(pack.content?.website?.title || pack.title)}</Link></h2><p>Updated {date(pack.updatedAt)} · {pack.evidence.length} saved {pack.evidence.length === 1 ? 'source' : 'sources'}</p></div><Link className="studio-button" to={`/studio/${pack.id}`}>Continue in Studio →</Link></article>) : <div className="settings-empty"><h2>No website drafts yet</h2><p>Open an idea in Studio and select Blog / website article to start your first draft.</p><Link to="/dashboard">Browse top ideas →</Link></div> : published.length ? published.map(item => <article key={item.id}><span className="settings-icon"><FileText size={21} aria-hidden="true" /></span><div><span className="settings-pill">{item.correctionRequired ? 'Source review needed' : 'Published'}</span><h2><Link to={`/insights/${item.id}`}>{cleanCopy(item.title)}</Link></h2><p>Published {date(item.publishedAt)}</p></div><Link className="studio-button" to={`/insights/${item.id}`}>Read article →</Link></article>) : <div className="settings-empty"><h2>No public articles yet</h2><p>Downloading a draft does not publish it. Your saved articles stay in Workspace drafts.</p><button onClick={() => setView('drafts')}>View workspace drafts</button></div>}</div>}
    <p className="settings-footnote">This is your article workspace, not website traffic analytics. Visitor counts, SEO rankings and conversions are not connected.</p>
  </section>
}
