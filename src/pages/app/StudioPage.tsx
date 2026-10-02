import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/auth-state'
import { studioRequest, type StudioConfig, type StudioContent, type StudioPackage, type StudioProfile } from '@/services/studio-api'
import { trackEvent } from '@/services/analytics'
import type { Article } from '@/types/news'
import { StudioMedia } from './StudioMedia'
import { StudioLibrary } from './StudioLibrary'
import { StudioHistory } from './StudioHistory'
import { ContentPreview, contentMarkdown } from './ContentPreview'
import '@/styles/studio.css'

const initialProfile: StudioProfile = { industry: 'AI', audience: 'Curious professionals', language: 'English', tone: 'Clear and informative', platform: 'Instagram', duration: 45, voice: 'Auto' }
const profileFields = (value: StudioProfile): StudioProfile => ({ industry: value.industry, audience: value.audience, language: value.language, tone: value.tone, platform: value.platform, duration: value.duration, voice: value.voice || 'Auto' })
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Something went wrong. Please retry.'

export function ArticlePage() {
  const { articleId } = useParams()
  const [article, setArticle] = useState<Article | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; studioRequest<{ article: Article }>(`/articles/${encodeURIComponent(articleId ?? '')}`, undefined, 'GET', false).then(data => { if (active) setArticle(data.article) }).catch(cause => { if (active) setError(message(cause)) }); return () => { active = false } }, [articleId])
  return <section className="studio"><Link to="/dashboard">← All updates</Link>{error ? <p role="alert">{error}</p> : !article ? <p role="status">Loading update…</p> : <><header className="studio-heading"><span className="studio-eyebrow">{article.category} · {article.sourceName}</span><h1>{article.title}</h1><p>{article.summary}</p></header><div className="studio-panel"><h2>Source and context</h2><p>Published {new Date(article.publishedAt).toLocaleString()}</p><a href={`/api/articles/${encodeURIComponent(article.id)}/source`} target="_blank" rel="noreferrer">Read original source ↗</a></div><Link className="studio-button" to={`/studio?article=${encodeURIComponent(article.id)}`}>Create content from this update</Link> <Link className="studio-button" to="/">Research the wider conversation</Link></>}</section>
}

export function StudioPage() {
  const { identity } = useAuth()
  const { packageId } = useParams()
  return <StudioWorkspace key={`${identity?.uid ?? 'guest'}:${packageId ?? 'new'}`} />
}

function StudioWorkspace() {
  const { identity, loading, configured } = useAuth()
  const { packageId } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [config, setConfig] = useState<StudioConfig | null>(null)
  const [profile, setProfile] = useState<StudioProfile>(initialProfile)
  const [packages, setPackages] = useState<StudioPackage[]>([])
  const [item, setItem] = useState<StudioPackage | null>(null)
  const [content, setContent] = useState<StudioContent | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [busy, setBusy] = useState(identity ? 'Loading workspace' : '')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('Preview')
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [checkedAt, setCheckedAt] = useState(Date.now)
  useEffect(() => { studioRequest<StudioConfig>('/config', undefined, 'GET', false).then(setConfig).catch(cause => setError(message(cause))) }, [])
  useEffect(() => {
    if (!identity) return
    let active = true
    Promise.all([studioRequest<StudioProfile>('/profile'), studioRequest<{ packages: StudioPackage[] }>('/packages'), packageId ? studioRequest<StudioPackage>(`/packages/${encodeURIComponent(packageId)}`) : Promise.resolve(null)])
      .then(([saved, list, current]) => { if (active) { setProfile(profileFields(saved)); setPackages(list.packages); setItem(current); setContent(current?.content ?? null) } })
      .catch(cause => { if (active) setError(message(cause)) }).finally(() => { if (active) setBusy('') })
    return () => { active = false }
  }, [identity, packageId])
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])
  useEffect(() => {
    if (item?.status !== 'generating') return
    let active = true
    const timer = window.setInterval(() => { if (active) setCheckedAt(Date.now()); studioRequest<StudioPackage>(`/packages/${item.id}`).then(next => { if (active) { setItem(next); if (next.status !== 'generating') setContent(next.content) } }).catch(() => { /* Transient transport failure; preserve the draft and allow a stale job retry. */ }) }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [item?.id, item?.status])
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setNotice('')
    try { await action() } catch (cause) {
      setError(message(cause))
      if (item && label === 'Writing content') { try { accept(await studioRequest<StudioPackage>(`/packages/${item.id}`)) } catch { /* Keep the current content. */ } }
    } finally { setBusy('') }
  }
  function accept(next: StudioPackage) { setItem(next); setContent(next.content); setDirty(false); setPackages(previous => [next, ...previous.filter(entry => entry.id !== next.id)]) }
  function edit(next: StudioContent) { setContent(next); setDirty(true); setNotice('') }
  async function generate(current = item, revisionInstruction = instruction) {
    if (!current) return
    accept(await studioRequest<StudioPackage>(`/packages/${current.id}/generate`, { requestId: crypto.randomUUID(), ...(revisionInstruction.trim() ? { instruction: revisionInstruction } : {}) }, 'POST'))
    setInstruction(''); setTab('Preview'); void trackEvent('package_generated')
  }
  function download(format: 'json' | 'md') {
    if (!item || !content) return
    const text = format === 'json' ? JSON.stringify({ ...item, content, editorialStatus: dirty ? 'unsaved-draft' : item.editorialStatus }, null, 2) : `Editorial status: ${dirty ? 'Unsaved draft' : item.editorialStatus}\n\n${contentMarkdown(item.title, content, item.evidence)}`
    const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `content-${item.id}.${format}`; anchor.click(); URL.revokeObjectURL(url)
    void trackEvent('package_exported')
  }
  const interrupted = item?.status === 'generating' && checkedAt - Date.parse(item.updatedAt) >= 120000
  const disabled = Boolean(busy) || (item?.status === 'generating' && !interrupted)
  if (loading) return <section className="studio" role="status">Checking your workspace…</section>
  if (!identity) return <section className="studio"><header className="studio-heading"><span className="studio-eyebrow">Content studio</span><h1>Your next story starts here.</h1><p>Research a niche, create platform content and prepare your production team.</p></header>{configured ? <Link className="studio-button" to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in to continue</Link> : <p role="status">Account access is not configured yet.</p>} <Link className="studio-button" to="/">Explore the research desk</Link></section>
  return <section className="studio" aria-busy={Boolean(busy)}>
    <header className="studio-heading"><span className="studio-eyebrow">CONTENT STUDIO</span><h1>{item ? item.title : 'Your content, ready to develop.'}</h1><p>{item ? 'Review the creative direction, refine it in your own words, then hand it to production.' : 'Start with a researched opportunity or bring a source of your own.'}</p></header>
    {error && <div className="studio-alert" role="alert">{error}</div>}{busy && <p role="status">{busy}…</p>}{notice && <p role="status">{notice}</p>}
    {packageId ? item && <>
      <div className="studio-toolbar"><Link to="/studio" onClick={event => { if (dirty && !window.confirm('Leave without saving your edits?')) event.preventDefault() }}>← Content library</Link><span className="studio-badge">{dirty ? 'Unsaved changes' : item.editorialStatus.replaceAll('_', ' ')}</span><span>Revision {item.revision}</span></div>
      {item.error && <p className="studio-alert" role="alert">{item.error}</p>}
      {interrupted && <div className="studio-alert" role="status"><p>Generation did not finish within its recovery window. Your saved content is preserved.</p><button disabled={Boolean(busy) || !config?.capabilities.generation} onClick={() => void run('Writing content', generate)}>Retry interrupted generation</button></div>}
      {!content ? <div className="studio-panel"><h2>Your sources are ready</h2><p>Generate the scripts, platform adaptations and production directions in one step.</p><button disabled={disabled || !config?.capabilities.generation} onClick={() => void run('Writing content', generate)}>Generate content</button></div> : <>
        <div className="studio-toolbar"><button onClick={() => download('md')}>Download team brief</button><button onClick={() => download('json')}>Export production JSON</button><button disabled={disabled || dirty || Boolean(item.review?.issues.length) || item.editorialStatus === 'approved'} onClick={() => void run('Approving', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}`, { revision: item.revision, editorialStatus: 'approved' }, 'PATCH')); setNotice('Content approved. Export the brief or continue to production.'); void trackEvent('package_approved') })}>{item.editorialStatus === 'approved' ? 'Approved' : 'Approve content'}</button></div>
        <form className="refine-form" onSubmit={event => { event.preventDefault(); void run('Writing content', generate) }}><label>Tell your agent what to change<textarea maxLength={2000} required value={instruction} disabled={disabled || dirty} onChange={event => setInstruction(event.target.value)} placeholder="Make the hook more practical, explain the concern fairly, and use conversational Hinglish…" /></label><button disabled={disabled || dirty || !instruction.trim() || !config?.capabilities.generation}>Revise content</button><small>Previous versions are saved. Changes run through evidence checks automatically.</small></form>
        <nav className="studio-tabs" aria-label="Workspace section">{['Preview', 'Production', 'Sources & checks', 'History'].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
        <div className="studio-panel">
          {tab === 'Preview' && <><ContentPreview content={content} /><details><summary>Edit narration manually</summary><p className="studio-muted">Keep [C1] references attached to supported claims. Saving synchronizes the scene plan and platform versions using your generation allowance.</p><label>Narration<textarea className="studio-long" disabled={disabled} value={content.script} onChange={event => edit({ ...content, script: event.target.value })} /></label><button disabled={disabled || !dirty} onClick={() => void run('Writing content', async () => { const saved = await studioRequest<StudioPackage>(`/packages/${item.id}`, { revision: item.revision, content }, 'PATCH'); accept(saved); if (config?.capabilities.generation) { await generate(saved, 'Preserve the manually edited saved script exactly. Synchronize all scene narration and platform adaptations with this script; keep every factual claim supported.'); setNotice('Saved and synchronized. Review the updated package before approval.') } else { setNotice('Draft saved. Generation is unavailable; synchronize the scene plan before approval or video export.') } })}>{config?.capabilities.generation ? 'Save & synchronize' : 'Save draft'}</button></details></>}
          {tab === 'Production' && <><h2>From script to screen</h2>{content.strategy && <details><summary>Full production prompts</summary>{Object.entries(content.strategy.production).map(([key, value]) => <article key={key}><h3>{key.replace(/([A-Z])/g, ' $1')}</h3><p className="preserve-lines">{value}</p></article>)}</details>}<StudioMedia key={`${item.id}:${item.revision}`} packageId={item.id} initialPrompt={content.scenes[0]?.visualPrompt ?? ''} script={content.script} strategy={content.strategy} scenes={content.scenes} disabled={disabled || dirty || Boolean(item.review?.issues.length)} />
            <details><summary>Scene-by-scene handoff ({content.scenes.length})</summary>{content.scenes.map((scene, index) => <article className="studio-evidence" key={index}><h3>Scene {index + 1} · {scene.timing}</h3><p>{scene.narration}</p><p><strong>On screen:</strong> {scene.onScreen}</p><p><strong>Visual direction:</strong> {scene.visualPrompt}</p><p><strong>Voice:</strong> {scene.voiceDirection}</p></article>)}</details></>}
          {tab === 'Sources & checks' && <><h2>Evidence checks</h2><p>Checks validate citation integrity, not factual truth or representative audience sentiment.</p>{item.review?.issues.length ? <ul>{item.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>No citation issues found. Review the claims before publication.</p>}
            {item.evidence.map(source => <article className="studio-evidence" key={source.id}><h3><a href={source.url} target="_blank" rel="noreferrer">{source.id} · {source.title} ↗</a></h3><p className="studio-muted">{source.type} · Retrieved {new Date(source.retrievedAt).toLocaleString()}</p><p>{source.limitations.join(' ')}</p><details><summary>Evidence excerpt</summary><blockquote>{source.excerpt}</blockquote></details></article>)}
            <details><summary>Claim references</summary>{content.claims.map(claim => <article key={claim.id}><h3>{claim.id} · {claim.text}</h3><p>{claim.evidenceId}</p><blockquote>{claim.quote}</blockquote></article>)}</details>
            <button disabled={disabled || dirty} onClick={() => void run('Refreshing evidence', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/refresh-evidence`, {}, 'POST')); setNotice('Evidence refreshed. Regenerate if the source changed.') })}>Refresh original sources</button>
            {identity.role === 'admin' && <button disabled={disabled || dirty || item.editorialStatus !== 'approved'} onClick={() => { if (window.confirm('Publish this approved article publicly on this website?')) void run('Publishing', async () => { const result = await studioRequest<{ id: string }>(`/packages/${item.id}/publish`, {}, 'POST'); navigate(`/insights/${result.id}`) }) }}>Publish website article</button>}
          </>}
          {tab === 'History' && <StudioHistory item={item} onRestore={accept} disabled={disabled || dirty} />}
        </div>
      </>}
    </> : <><div className="studio-panel"><h2>Find your next content opportunity</h2><p>Let your niche agent research the market, compare reactions and suggest a strong angle.</p><Link className="studio-button primary-action" to="/">Open research desk →</Link></div>
      <div className="studio-panel"><h2>Your content library</h2>{!packages.length ? <p>Your first researched package will appear here.</p> : <div className="studio-package-list">{packages.map(entry => <Link key={entry.id} to={`/studio/${entry.id}`}><strong>{entry.title}</strong><span>{entry.editorialStatus.replaceAll('_', ' ')} · {new Date(entry.updatedAt).toLocaleString()}</span></Link>)}</div>}</div>
      <details className="studio-panel" open={Boolean(params.get('article'))}><summary>Bring your own source</summary>
        <form onSubmit={event => { event.preventDefault(); void run('Creating your content', async () => { const created = await studioRequest<StudioPackage>('/packages', { ...(selectedSources.length ? { sourceIds: selectedSources } : params.get('article') ? { articleId: params.get('article') } : { sourceUrl }), settings: profile, requestId: crypto.randomUUID() }, 'POST'); try { await studioRequest(`/packages/${created.id}/generate`, { requestId: crypto.randomUUID() }, 'POST') } finally { navigate(`/studio/${created.id}`) } }) }}>
          {params.get('article') ? <p>Selected update ready. <Link to="/studio">Choose another source</Link></p> : <label>Source URL<input type="url" required={!selectedSources.length} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://publisher.com/article" /></label>}
          <div className="studio-fields">{(['industry', 'audience', 'language', 'tone'] as const).map(key => <label key={key}>{key}<input required maxLength={key === 'audience' ? 300 : key === 'language' ? 80 : 100} value={profile[key]} onChange={event => setProfile({ ...profile, [key]: event.target.value })} /></label>)}<label>Duration (seconds)<input type="number" min={15} max={180} value={profile.duration} onChange={event => setProfile({ ...profile, duration: Number(event.target.value) })} /></label></div>
          <div className="studio-toolbar"><button disabled={Boolean(busy) || !config?.capabilities.generation}>Create content</button><button type="button" disabled={Boolean(busy)} onClick={() => void run('Saving defaults', async () => { setProfile(profileFields(await studioRequest<StudioProfile>('/profile', profileFields(profile), 'PUT'))); setNotice('Defaults saved.') })}>Save preferences</button></div>
        </form><StudioLibrary industry={profile.industry} selected={selectedSources} onSelect={setSelectedSources} />
      </details></>}
  </section>
}
