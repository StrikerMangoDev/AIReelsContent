import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/auth-state'
import { qualityDimensions, studioRead, studioRequest, type StudioConfig, type StudioContent, type StudioPackage, type StudioProfile, type OutputFormat } from '@/services/studio-api'
import { activeWorkspace } from '@/services/workspace-session'
import { trackEvent } from '@/services/analytics'
import type { Article } from '@/types/news'
import { StudioMedia } from './StudioMedia'
import { StudioLibrary } from './StudioLibrary'
import { StudioHistory } from './StudioHistory'
import { cleanCopy, contentMarkdown } from './ContentPreview'
import { InstagramPreview } from './InstagramPreview'
import { ChevronDown, Compass, Link2, X } from 'lucide-react'
import { prepareStoryboard } from '@/services/storyboard'
import '@/styles/studio.css'
import '@/styles/content-workflow.css'

const initialProfile: StudioProfile = { industry: 'AI', audience: 'Curious professionals', language: 'English', tone: 'Clear and informative', platform: 'Instagram', duration: 45, voice: 'Auto' }
const platforms = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']
const allOutputs: OutputFormat[] = ['script', 'captions', 'website', 'platforms', 'production']
const outputLabels: Record<OutputFormat, string> = { script: 'Video script & opening lines', captions: 'Social captions', website: 'Blog / website article', platforms: 'Posts for your selected platforms', production: 'Carousel slides & visual directions' }
const outputDescriptions: Record<OutputFormat, string> = { script: 'A narration script with alternative opening lines.', captions: 'Ready-to-edit text to accompany your posts.', website: 'A longer article with a title and body.', platforms: 'Headlines, post text and calls to action for each platform.', production: 'Slide text and visual directions. Includes a script; images are not generated.' }
const platformMarks: Record<string, string> = { Facebook: 'f', Instagram: 'IG', X: 'X', LinkedIn: 'in', YouTube: 'YT' }
const profileFields = (value: StudioProfile): StudioProfile => ({ industry: value.industry, audience: value.audience, language: value.language, tone: value.tone, platform: value.platform, duration: value.duration, voice: value.voice || 'Auto', outputs: value.outputs || allOutputs })
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Something went wrong. Please retry.'

export function ArticlePage() {
  const { articleId } = useParams()
  const [article, setArticle] = useState<Article | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; studioRead<{ article: Article }>(`/articles/${encodeURIComponent(articleId ?? '')}`, false).then(data => { if (active) setArticle(data.article) }).catch(cause => { if (active) setError(message(cause)) }); return () => { active = false } }, [articleId])
  return <section className="studio"><Link to="/dashboard">← All updates</Link>{error ? <p role="alert">{error}</p> : !article ? <p role="status">Loading update…</p> : <><header className="studio-heading"><span className="studio-eyebrow">{article.category} · {article.sourceName}</span><h1>{article.title}</h1><p>{article.summary}</p></header><div className="studio-panel"><h2>Source and context</h2><p>Published {new Date(article.publishedAt).toLocaleString()}</p><a href={`/api/articles/${encodeURIComponent(article.id)}/source`} target="_blank" rel="noreferrer">Read original source ↗</a></div><Link className="studio-button" to={`/studio?article=${encodeURIComponent(article.id)}`}>Create content from this update</Link> <Link className="studio-button" to="/find-ideas">Research the wider conversation</Link></>}</section>
}

export function StudioPage() {
  const { identity } = useAuth()
  const { packageId } = useParams()
  return <StudioWorkspace key={`${identity?.uid ?? 'guest'}:${packageId ?? 'new'}`} />
}

function StudioWorkspace() {
  const { identity, loading, configured } = useAuth()
  const uid = identity?.uid
  const { packageId } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [config, setConfig] = useState<StudioConfig | null>(null)
  const [profile, setProfile] = useState<StudioProfile>(initialProfile)
  const [packages, setPackages] = useState<StudioPackage[]>([])
  const [draftsLoading, setDraftsLoading] = useState(true)
  const [draftsError, setDraftsError] = useState('')
  const [item, setItem] = useState<StudioPackage | null>(null)
  const [content, setContent] = useState<StudioContent | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [busy, setBusy] = useState(identity ? 'Loading workspace' : '')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState('write')
  const [mobileView, setMobileView] = useState('editor')
  const [activeSlide, setActiveSlide] = useState(0)
  const [previewMode, setPreviewMode] = useState<'post' | 'carousel'>('post')
  const [previewSection, setPreviewSection] = useState('')
  const [showIdeaResearch, setShowIdeaResearch] = useState(false)
  const [sourceEntry, setSourceEntry] = useState(Boolean(params.get('article')))
  const articleLinkInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (sourceEntry) articleLinkInput.current?.focus() }, [sourceEntry])
  const [showReferences, setShowReferences] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [generationConfirmation, setGenerationConfirmation] = useState<{ packageId: string; revision: number; settings: StudioProfile; instruction: string } | null>(null)
  const downloadDispatch = useRef(false)
  const generationDispatch = useRef(false)
  const generationTrigger = useRef<HTMLElement | null>(null)
  const confirmationPanel = useRef<HTMLElement>(null)
  useEffect(() => { if (generationConfirmation) { confirmationPanel.current?.focus(); confirmationPanel.current?.scrollIntoView({ block: 'start', behavior: 'instant' }) } }, [generationConfirmation])
  const [job, setJob] = useState<{ id: string; status: string } | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [reviewNow, setReviewNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setReviewNow(Date.now()), 30000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { studioRead<StudioConfig>('/config', false).then(setConfig).catch(cause => setError(message(cause))) }, [])
  useEffect(() => {
    if (!uid) return
    let active = true
    if (packageId) {
      studioRead<StudioPackage>(`/packages/${encodeURIComponent(packageId)}`)
        .then(async current => {
          if (!active) return
          setProfile(profileFields(current.settings)); setItem(current); setContent(current.content ?? null)
          if (current.researchId && !current.content && !current.jobId && current.status === 'draft' && !current.evidence.some(source => source.excerpt.trim().length >= 100)) {
            setBusy('Reading sources from your selected idea')
            const prepared = await studioRequest<StudioPackage>(`/packages/${current.id}/prepare-sources`, {}, 'POST')
            if (active) { setItem(prepared); setNotice(prepared.evidence.some(source => source.type === 'alternative-publisher-article') ? 'The original article was unavailable. Matching coverage from another publisher is attached and saved. View research to see the sources.' : 'Sources attached automatically from your selected idea.') }
          }
        })
        .catch(cause => { if (active) setError(message(cause)) }).finally(() => { if (active) setBusy('') })
    } else {
      // Show saved drafts as soon as they arrive; preferences must not delay the list.
      const drafts = studioRead<{ packages: StudioPackage[] }>('/packages')
        .then(list => { if (active) setPackages(list.packages) })
        .catch(cause => { if (active) setDraftsError(message(cause)) })
        .finally(() => { if (active) setDraftsLoading(false) })
      const preferences = studioRead<StudioProfile>('/profile')
        .then(saved => { if (active) setProfile(profileFields(saved)) })
        .catch(cause => { if (active) setError(message(cause)) })
      Promise.all([drafts, preferences]).finally(() => { if (active) setBusy('') })
    }
    return () => { active = false }
  }, [uid, packageId, loadAttempt])
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])
  useEffect(() => {
    if (!item?.jobId || !['generating', 'dispatch_unknown'].includes(item.status)) return
    let active = true; let checking = false; let terminal = false; let lastPollError = ''
    const jobId = item.jobId; const id = item.id
    async function poll() {
      if (checking || terminal) return
      checking = true
      try {
        const [nextJob, next] = await Promise.all([studioRead<{ id: string; status: string }>(`/jobs/${encodeURIComponent(jobId)}`), studioRead<StudioPackage>(`/packages/${id}`)])
        if (!active) return
        if (lastPollError) { const recovered = lastPollError; setError(previous => previous === recovered ? '' : previous); lastPollError = '' }
        setJob(nextJob); setItem(next)
        if (nextJob.status === 'running') setNotice('')
        // Job and package reads can straddle the worker's two durable writes.
        terminal = !['reserved', 'running'].includes(nextJob.status) && next.status !== 'generating'
        if (terminal) { setPreviewMode('post'); setActiveSlide(0); setContent(next.content); setNotice(next.content ? 'Your content is ready. Edit it, preview it, then download.' : '') }
      } catch (cause) { if (active) { lastPollError = message(cause); setError(lastPollError) } } finally { checking = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [item?.id, item?.jobId, item?.status])
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setNotice('')
    try { await action() } catch (cause) {
      setError(message(cause))
      if (item && label === 'Writing content') { try { accept(await studioRead<StudioPackage>(`/packages/${item.id}`)) } catch { /* Keep the current content. */ } }
    } finally { setBusy('') }
  }
  function accept(next: StudioPackage) { setGenerationConfirmation(null); setPreviewMode('post'); setPreviewSection(''); setActiveSlide(0); setItem(next); setContent(next.content); setProfile(profileFields(next.settings)); setDirty(false); setPackages(previous => [next, ...previous.filter(entry => entry.id !== next.id)]) }
  function edit(next: StudioContent) { setGenerationConfirmation(null); setContent(next); setDirty(true); setNotice('') }
  function requestGeneration() {
    if (!item || busy || dirty || item.status === 'generating') return
    generationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError('')
    setGenerationConfirmation({ packageId: item.id, revision: item.revision, settings: structuredClone(profileFields(profile)), instruction })
  }
  async function confirmGeneration() {
    const confirmed = generationConfirmation
    if (!confirmed || !item || busy || generationDispatch.current) return
    if (dirty || item.id !== confirmed.packageId || item.revision !== confirmed.revision || JSON.stringify(profileFields(profile)) !== JSON.stringify(confirmed.settings) || instruction !== confirmed.instruction) {
      setGenerationConfirmation(null); setError('Your draft or selections changed. Review the generation scope again.'); return
    }
    setGenerationConfirmation(null)
    generationDispatch.current = true
    try { await run('Writing content', async () => {
      let current = item
      if (JSON.stringify(profileFields(current.settings)) !== JSON.stringify(confirmed.settings)) {
        current = await studioRequest<StudioPackage>(`/packages/${current.id}`, { revision: confirmed.revision, settings: confirmed.settings }, 'PATCH')
        accept(current)
      }
      accept(await studioRequest<StudioPackage>(`/packages/${current.id}/generate`, { requestId: crypto.randomUUID(), confirmed: true, revision: current.revision, ...(confirmed.instruction.trim() ? { instruction: confirmed.instruction } : {}) }, 'POST'))
      setInstruction(''); setPanel('write'); setNotice('Your draft is queued. You can leave and return to check its progress.')
    }) } finally { generationDispatch.current = false }
  }
  async function download(format: 'json' | 'md') {
    if (!item || !content || busy || dirty || item.status === 'generating' || item.review?.issues.length || !reviewReady || item.editorialStatus !== 'approved' || item.approval?.method !== 'independent-human' || downloadDispatch.current) return
    downloadDispatch.current = true
    try { await run('Preparing your download', async () => {
      const ready = item
      const exported = await studioRead<{ manifest: Record<string, unknown>; package: StudioPackage }>(`/packages/${item.id}/export`)
      const saved = exported.package
      if (!saved.content) throw new Error('Saved content is unavailable.')
      if (saved.id !== ready.id || saved.revision !== ready.revision) throw new Error('The content changed while preparing your download. Check the saved version and try again.')
      const text = format === 'json' ? JSON.stringify(exported, null, 2) : `Editorial status: Ready\n\n${contentMarkdown(saved.title, saved.content, saved.evidence)}\n\n## Export manifest\n\n${JSON.stringify(exported.manifest, null, 2)}`
      const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `content-${item.id}.${format}`; anchor.click(); URL.revokeObjectURL(url)
      setNotice('Your download is ready.')
      void trackEvent('package_exported')
    }) } finally { downloadDispatch.current = false }
  }
  const jobStatus = job?.id === item?.jobId ? job?.status : item?.jobStatus
  const disabled = Boolean(busy) || item?.status === 'generating'
  const needsSource = Boolean(item && !content && !item.evidence.some(source => source.excerpt.length >= 100))
  const canAddSource = needsSource && !item?.researchId && item?.status === 'draft' && !item.jobId && !item.sourceIds?.length && item.evidence.length < 12
  const generationHint = busy ? `${busy}...` : error || (needsSource ? (item?.researchId ? 'Reading the sources linked to your idea is required before generation. Retry if the publisher was unavailable.' : canAddSource ? 'Add and save a readable original article below before generating. This draft currently has only short headlines.' : 'This draft needs more source evidence. Start a new draft with a readable original article or approved library sources.') : !profile.platform ? 'Select at least one platform.' : !(profile.outputs || allOutputs).length ? 'Select at least one content format.' : !config?.capabilities.generation ? 'Generation is unavailable. Your choices are saved in this session.' : 'Sources are ready. Check the scope before generation starts.')
  const quality = item?.independentReview?.quality
  const reviewReady = Boolean(!dirty && item?.independentReview?.status === 'passed' && quality?.policyVersion === 'content-finalization-v1' && quality.eligible && item.independentReview.reviewerId === item.reviewerId && Date.parse(item.independentReview.expiresAt || '') > Math.max(reviewNow, Date.now()))
  const finalized = reviewReady && item?.editorialStatus === 'approved' && item.approval?.method === 'independent-human'
  const exportDisabled = disabled || dirty || !content || Boolean(item?.review?.issues.length) || !finalized
  const reviewOwner = activeWorkspace() === 'personal' ? uid : activeWorkspace()
  if (loading) return <section className="studio content-workflow"><StudioLoading label="Checking your workspace" /></section>
  if (!identity) return <section className="studio"><header className="studio-heading"><span className="studio-eyebrow">Content studio</span><h1>Your next story starts here.</h1><p>Research a niche, create platform content and prepare your production team.</p></header>{configured ? <Link className="studio-button" to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in to continue</Link> : <p role="status">Account access is not configured yet.</p>} <Link className="studio-button" to="/">Explore the research desk</Link></section>
  if (packageId && !item && busy) return <section className="studio content-workflow studio-loading" aria-busy="true" role="status"><h1>Opening your draft…</h1><p>Loading your saved content and source checks.</p><div className="studio-loading-block" aria-hidden="true" /><div className="studio-loading-block" aria-hidden="true" /></section>
  return <section className={`studio content-workflow${item ? ' studio-composer' : ' studio-home'}`} aria-busy={Boolean(busy)} onChange={() => { setGenerationConfirmation(null) }}>
    {!item ? <>
      <header className="studio-home-heading"><div><h1>Content Studio</h1><p>Continue a draft or create content from a researched topic.</p></div><div className="studio-home-actions"><Link className="studio-button primary-action" to="/ideas"><Compass size={18} aria-hidden="true" /><span>Choose a topic</span></Link><button type="button" className="studio-article-action" aria-expanded={sourceEntry} aria-controls="studio-source-entry" onClick={() => setSourceEntry(value => !value)}>{sourceEntry ? <X size={18} aria-hidden="true" /> : <Link2 size={18} aria-hidden="true" />}<span>{sourceEntry ? 'Close article form' : 'Paste article link'}</span></button></div></header>
    </> : <header className="studio-editorial-header">
      <div className="studio-editorial-header-main">
        <nav className="idea-breadcrumbs" aria-label="Breadcrumb"><Link to="/ideas">Topic Library</Link><span aria-hidden="true">/</span><Link to="/studio">Content Studio</Link><span aria-hidden="true">/</span><span>{item.title}</span></nav>
        <div className="studio-title-lockup">
          <h1 className="studio-main-title">{item.title}</h1>
          <span className="studio-editorial-badge" data-status={dirty ? 'unsaved' : finalized ? 'approved' : 'needs_review'}>{dirty ? 'Unsaved changes' : finalized ? 'Ready' : item.editorialStatus === 'approved' ? 'Needs review' : 'Draft'}</span>
        </div>
        {item.researchContext && <div className="studio-research-strip">
          <button type="button" className="studio-research-pill" aria-expanded={showIdeaResearch} aria-controls="composer-research" onClick={() => setShowIdeaResearch(value => !value)}>
            <span className="studio-research-indicator" aria-hidden="true" />
            {showIdeaResearch ? 'Hide research briefing' : 'View research briefing'}
          </button>
          <span className="studio-research-divider" aria-hidden="true">·</span>
          <Link to="/ideas" className="studio-research-alt" onClick={event => { if (dirty && !window.confirm('Leave without saving your edits?')) event.preventDefault() }}>Choose another idea</Link>
        </div>}
      </div>
      <div className="studio-editorial-actions">
        <Link to="/studio" className="studio-action-back" onClick={event => { if (dirty && !window.confirm('Leave without saving your edits?')) event.preventDefault() }}>← Content library</Link>
        <button type="button" className="studio-planner-btn" disabled={disabled || dirty} onClick={() => void run('Adding to Planner', async () => { try { await studioRequest('/planning/board', { packageId: item.id, status: item.editorialStatus === 'approved' ? 'ready' : 'drafting' }, 'POST') } catch (cause) { if (!(cause instanceof Error && cause.message === 'This package is already on your board')) throw cause } setNotice('Saved to Content Planner. You can keep editing here.') })}>Add to Planner</button>
        <Link to="/planning" className="studio-planner-link">Open Planner →</Link>
      </div>
    </header>}

    {error && <div className="studio-alert" role="alert">{error}</div>}{busy && (busy === 'Loading workspace' ? packageId && <StudioLoading label="Opening your saved draft" /> : <p role="status">{busy}…</p>)}{notice && <p className="studio-save-notice" role="status">{notice}</p>}
    {packageId && !item && !busy && error && <button type="button" onClick={() => { setError(''); setBusy('Loading workspace'); setLoadAttempt(value => value + 1) }}>Try loading draft again</button>}
    {packageId ? item && <>


      {item.researchContext && showIdeaResearch && <section id="composer-research" className="studio-research-drawer" aria-label="Research briefing"><div className="studio-research-drawer-header"><h3>Research briefing</h3><p>{item.researchContext.opportunity.whatChanged}</p></div><div className="studio-research-drawer-body"><p className="studio-research-angle"><strong>Suggested editorial angle:</strong> {item.researchContext.opportunity.angle}</p><div className="studio-research-sources-grid">{item.evidence.map(source => <article key={source.id} className="studio-research-source-item"><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><p>{source.limitations.join(' ')}</p></article>)}</div></div></section>}
      <div className="composer-navigation">
        <nav className="studio-section-nav" aria-label="Content workspace sections">
          {[
            ['setup', '1 · Setup'],
            ['write', '2 · Edit & preview'],
            ['sources', `3 · Sources & checks (${item.evidence.length})`],
            ['download', '4 · Download']
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={!content && value !== 'setup'}
              aria-pressed={panel === value}
              onClick={() => setPanel(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        {content && <div className="composer-tools">
          <label htmlFor="studio-supporting-tools" className="composer-tools-label">More tools</label>
          <div className="studio-custom-select-wrapper">
            <select
              id="studio-supporting-tools"
              aria-label="More editorial tools"
              value={['revise', 'production', 'history'].includes(panel) ? panel : ''}
              onChange={event => { if (event.target.value) setPanel(event.target.value) }}
              className="studio-custom-select"
            >
              <option value="">Choose tool…</option>
              <option value="revise">✨ Ask AI to revise</option>
              {content.scenes && content.script && <option value="production">🎬 Production directions</option>}
              <option value="history">🕒 Version history</option>
            </select>
            <ChevronDown size={14} className="studio-select-chevron" aria-hidden="true" />
          </div>
        </div>}
      </div>
      <section hidden={Boolean(generationConfirmation) || busy === 'Writing content' || item.status === 'generating' || (Boolean(content) && panel !== 'setup')} className="studio-panel workflow-options studio-setup"><div className="setup-intro"><h2>Choose what to create</h2><p>Choose your platforms and formats. Start with a post and caption; add a carousel, script or article when you need one.</p></div><div className="studio-choice-grid"><fieldset disabled={disabled || dirty}><legend>Where you’ll share</legend>{platforms.map(platform => <label key={platform}><input type="checkbox" checked={profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).includes(platform)} onChange={event => { const selected = new Set(profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).filter(Boolean)); if (event.target.checked) selected.add(platform); else selected.delete(platform); setProfile({ ...profile, platform: platforms.filter(value => selected.has(value)).join(', ') }) }} /><span className="platform-mark" data-platform={platform} aria-hidden="true">{platformMarks[platform]}</span><span>{platform}</span></label>)}</fieldset><OutputPicker outputs={profile.outputs || allOutputs} disabled={disabled || dirty} onChange={outputs => setProfile({ ...profile, outputs })} /><p className="studio-muted">{profile.platform || 'No platforms selected'} · {(profile.outputs || allOutputs).length} content formats selected. Changes apply to your next generation.</p></div>{content && (profile.platform !== item.settings.platform || JSON.stringify(profile.outputs || allOutputs) !== JSON.stringify(item.settings.outputs || allOutputs)) && <button type="button" disabled={disabled || dirty || !profile.platform || !(profile.outputs || allOutputs).length || !config?.capabilities.generation} onClick={requestGeneration}>Generate selected content</button>}{content && profile.platform === item.settings.platform && JSON.stringify(profile.outputs || allOutputs) === JSON.stringify(item.settings.outputs || allOutputs) && <div className="studio-toolbar"><button type="button" className="workflow-primary" onClick={() => setPanel('write')}>Continue editing</button><span>Your selected formats are already generated. Change a choice above to generate a different set.</span></div>}{!content && !['generating', 'dispatch_unknown'].includes(item.status) && <div className="studio-toolbar"><button className="workflow-primary" aria-describedby="generation-feedback" disabled={disabled || needsSource || !profile.platform || !(profile.outputs || allOutputs).length || !config?.capabilities.generation} onClick={requestGeneration}>Generate content</button><span id="generation-feedback" role={error ? 'alert' : 'status'}>{generationHint}{canAddSource && <> <a href="#studio-add-source">Add article</a></>}</span></div>}</section>
      {canAddSource && <section id="studio-add-source" className="studio-panel workflow-next"><h2>Add the original article</h2><p>This topic has only a short headline. Add a readable source before generating so your draft has evidence to work from.</p><form onSubmit={event => { event.preventDefault(); void run('Reading the source', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/sources`, { revision: item.revision, sourceUrl: sourceUrl.trim() }, 'POST')); setSourceUrl(''); setNotice('Source added. Review your output choices, then generate your draft.') }) }}><label>Original article URL<input type="url" required value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://publisher.com/article" disabled={disabled} /></label><button disabled={disabled || !sourceUrl.trim()}>Add source to this draft</button></form></section>}
      {needsSource && item.researchId && <button disabled={disabled} onClick={() => { setError(''); setBusy('Reading sources from your selected idea'); setLoadAttempt(value => value + 1) }}>Retry source retrieval</button>}
      {needsSource && !item.researchId && !canAddSource && !['generating', 'dispatch_unknown'].includes(item.status) && <p role="status">This package needs more source evidence, but its existing job or source selection cannot be changed here. Start a new draft with a readable original article or approved library sources.</p>}
      {generationConfirmation && generationConfirmation.packageId === item.id && generationConfirmation.revision === item.revision && <section ref={confirmationPanel} tabIndex={-1} className="studio-panel workflow-next generation-confirmation" role="region" aria-labelledby="generation-confirm-title"><h2 id="generation-confirm-title">Ready to create your content?</h2><p>Revision {generationConfirmation.revision} · {generationConfirmation.settings.platform}</p><p>Outputs: {(generationConfirmation.settings.outputs || allOutputs).map(output => outputLabels[output]).join(', ')}</p><p>Audience: {generationConfirmation.settings.audience}. Language: {generationConfirmation.settings.language}. Duration: {generationConfirmation.settings.duration} seconds.</p>{generationConfirmation.instruction.trim() && <p>Requested changes: {generationConfirmation.instruction}</p>}<p>We’ll write your selected formats using the saved research. This uses your generation allowance. When ready, your draft opens in the editor for preview and download.</p><div className="studio-toolbar"><button type="button" className="workflow-primary" disabled={disabled || dirty} onClick={() => void confirmGeneration()}>Confirm & generate</button><button type="button" disabled={Boolean(busy)} onClick={() => { setGenerationConfirmation(null); generationTrigger.current?.focus() }}>Cancel</button></div></section>}

      {item.error && busy !== 'Writing content' && !generationConfirmation && item.status !== 'generating' && item.status !== 'dispatch_unknown' && <p className="studio-alert" role="alert">{item.error.includes('API key') ? 'Generation is unavailable because the free AI connection needs attention. A workspace administrator must update the provider key before you try again. Your saved work is safe.' : 'The last writing attempt could not finish. Your saved draft is unchanged. You can keep editing or request a new attempt.'}</p>}
      {item.status === 'dispatch_unknown' && item.error?.includes('"httpStatus":504') && <section className="studio-panel"><h2>Prepare another attempt</h2><p>No content was received. The previous attempt may still be charged, so its budget reservation will remain. Preparing a retry does not call AI; you will choose your outputs and confirm generation again.</p><button disabled={disabled || dirty} onClick={() => { if (window.confirm('Keep the previous cost reserved and prepare another attempt? A new generation may incur another charge within your remaining budget.')) void run('Preparing retry', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/recover-generation`, { revision: item.revision, acknowledgeTimeoutCost: true }, 'POST')); setNotice('Retry prepared. Previous cost remains reserved. Choose the outputs you need, then confirm generation.'); setPanel('setup') }) }}>Prepare retry — keep previous cost reserved</button></section>}
      {item.jobId && ['generating', 'dispatch_unknown'].includes(item.status) && <div className="studio-job-notice" role="status">{item.status === 'dispatch_unknown' && !item.error?.includes('"httpStatus":504') && <button disabled={disabled || dirty} onClick={() => void run('Checking last attempt', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/recover-generation`, { revision: item.revision }, 'POST')); setNotice('The previous attempt produced no usable content. Your saved draft is preserved. You may request a new attempt.') })}>Check last attempt</button>}<strong>{jobStatus === 'reserved' ? 'Your draft is queued' : jobStatus === 'running' ? 'Creating your content' : item.error?.includes('"httpStatus":504') ? 'Gemini timed out — no content received' : 'Generation needs attention'}</strong><p>{jobStatus === 'reserved' ? 'Waiting to start. You can safely leave this page; returning will not create another draft.' : jobStatus === 'running' ? 'Writing your selected formats and checking source references. Your editor will appear here when the draft is ready.' : item.error?.includes('"httpStatus":504') ? 'Gemini returned a gateway timeout. Your selected idea, sources and settings are saved, but this attempt returned no content. Its possible charge is still reserved; automatic retry is blocked to avoid repeat charges.' : 'The previous request has an unconfirmed outcome. Your idea and settings are saved; checking its status does not generate content.'}</p>{jobStatus === 'reserved' && <button disabled={Boolean(busy)} onClick={() => { if (window.confirm('Cancel this queued generation before dispatch?')) void run('Cancelling queued generation', async () => { await studioRequest(`/jobs/${encodeURIComponent(item.jobId || '')}/cancel`, {}, 'POST'); accept(await studioRead<StudioPackage>(`/packages/${item.id}`)); setNotice('Queued generation cancelled. No new provider attempt was started by this action.') }) }}>Cancel queued generation</button>}</div>}
      {item.status === 'generating' && jobStatus === 'failed' && <section className="studio-panel"><h2>The previous attempt stopped</h2><p>Check the saved attempt before trying again. This check does not call AI or release an uncertain cost.</p><button disabled={Boolean(busy) || dirty} onClick={() => void run('Checking last attempt', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/recover-generation`, { revision: item.revision }, 'POST')); setNotice('The stopped attempt was reconciled. Review your scope before requesting another generation.') })}>Check stopped attempt</button></section>}
      {content && <>


        <div>
          <section hidden={panel !== 'write'} aria-label="Write and preview">
            <div className="studio-mobile-switch" aria-label="Editor or preview">{['editor', 'preview'].map(value => <button key={value} type="button" aria-pressed={mobileView === value} onClick={() => setMobileView(value)}>{value === 'editor' ? 'Edit content' : 'See preview'}</button>)}</div>
            <div className="studio-compose-grid" data-mobile-view={mobileView}>
              <section className="studio-panel studio-editor-column" aria-label="Content editor"><div className="composer-editor-heading"><div><h2>Your content</h2></div><span className="composer-channel">{item.settings.platform}</span></div><DraftTextEditor key={`${item.id}:${item.revision}`} content={content} evidence={item.evidence} profile={profile} disabled={disabled} onChange={edit} onSectionChange={section => { setPreviewSection(section); setPreviewMode(section === 'slides' ? 'carousel' : 'post') }} activeSlide={activeSlide} onSlideSelect={index => { setActiveSlide(index); setPreviewMode('carousel') }} /><div className="studio-save-row"><button className="workflow-primary" disabled={disabled || !dirty} onClick={() => void run('Saving draft', async () => { const saved = await studioRequest<StudioPackage>(`/packages/${item.id}`, { revision: item.revision, content }, 'PATCH'); accept(saved); setNotice('Draft saved. You can continue editing or download when ready.') })}>Save draft</button><button type="button" className="studio-continue-btn" onClick={() => setPanel('download')}>Continue to download →</button><span role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span></div></section>
              <aside className="studio-preview-column" aria-label="Post preview"><InstagramPreview content={content} selectedSection={previewSection} title={item.title} activeSlide={activeSlide} onSlideSelect={setActiveSlide} previewMode={previewMode} onModeChange={setPreviewMode} /></aside>
            </div>
    
          </section>
          {content.scenes && content.script && <section hidden={panel !== 'production'} className="studio-panel"><h2>Production directions & media</h2><div className="studio-panel-back-row"><button type="button" className="studio-panel-back-btn" onClick={() => setPanel('write')}>← Back to Edit & preview</button></div>{panel === 'production' && <><h2>From script to screen</h2>{content.strategy?.production && <section className="studio-readable-section"><h3>Full production prompts</h3>{Object.entries(content.strategy.production).map(([key, value]) => <article key={key}><h3>{key.replace(/([A-Z])/g, ' $1')}</h3><p className="preserve-lines">{value}</p></article>)}</section>}<StudioMedia key={`${item.id}:${item.revision}`} packageId={item.id} initialPrompt={content.scenes[0]?.visualPrompt ?? ''} script={content.script} strategy={content.strategy} scenes={content.scenes} disabled={disabled || dirty || Boolean(item.review?.issues.length)} />
            <section className="studio-readable-section"><h3>Scene-by-scene handoff ({content.scenes.length})</h3>{content.scenes.map((scene, index) => <article className="studio-evidence" key={index}><h3>Scene {index + 1} · {scene.timing}</h3><p>{scene.narration}</p><p><strong>On screen:</strong> {scene.onScreen}</p><p><strong>Visual direction:</strong> {scene.visualPrompt}</p><p><strong>Voice:</strong> {scene.voiceDirection}</p></article>)}</section></>}</section>}
          <section hidden={panel !== 'sources'} className="studio-panel"><h2>Sources & evidence checks</h2><><h3>Evidence checks</h3><p>Checks validate citation integrity, not factual truth or representative audience sentiment.</p>{item.review?.issues.length ? <ul>{item.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>No citation issues found. Check the claims, original sources and reuse rights before downloading; automatic checks cannot establish factual truth.</p>}
            {item.evidence.map(source => <article className="studio-evidence" key={source.id}><h3><a href={source.url} target="_blank" rel="noreferrer">{source.id} · {source.title} ↗</a></h3><p className="studio-muted">{source.type} · Retrieved {new Date(source.retrievedAt).toLocaleString()}</p><p>{source.limitations.join(' ')}</p><section className="studio-readable-section"><h3>Evidence excerpt</h3><blockquote>{source.excerpt}</blockquote></section></article>)}

            <section className="studio-readable-section"><h3>Claim references</h3>{content.claims.map(claim => <article key={claim.id}><h3>{claim.id} · {claim.text}</h3><p>{claim.evidenceId}</p><blockquote>{claim.quote}</blockquote></article>)}</section>
            <button disabled={disabled || dirty} onClick={() => void run('Refreshing evidence', async () => { if (!window.confirm('Refresh the original sources now? This fetches each source again and may invalidate approval if evidence changed.')) return; accept(await studioRequest<StudioPackage>(`/packages/${item.id}/refresh-evidence`, { confirmed: true }, 'POST')); setNotice('Evidence refreshed. Regenerate if the source changed.') })}>Refresh original sources</button>
            {identity.role === 'admin' && config?.capabilities.publishing && <button disabled={disabled || dirty || !finalized} onClick={() => { if (window.confirm('Publish this approved article publicly on this website?')) void run('Publishing', async () => { const result = await studioRequest<{ id: string }>(`/packages/${item.id}/publish`, {}, 'POST'); navigate(`/insights/${result.id}`) }) }}>Publish website article</button>}
          </></section>
          <section hidden={panel !== 'history'} className="studio-panel"><div className="studio-panel-back-row"><button type="button" className="studio-panel-back-btn" onClick={() => setPanel('write')}>← Back to Edit & preview</button></div>{panel === 'history' && <StudioHistory item={item} onRestore={accept} disabled={disabled || dirty} />}</section>
        </div>

<section hidden={panel !== 'revise'} className="studio-panel"><div className="studio-panel-back-row"><button type="button" className="studio-panel-back-btn" onClick={() => setPanel('write')}>← Back to Edit & preview</button></div><h2>Ask AI to revise</h2><form className="refine-form" onSubmit={event => { event.preventDefault(); requestGeneration() }}><label>What would you like to change?<textarea maxLength={2000} required value={instruction} disabled={disabled || dirty} onChange={event => setInstruction(event.target.value)} placeholder="Make the hook more practical, explain the concern fairly, and use conversational Hinglish…" /></label><button disabled={disabled || dirty || !instruction.trim() || !config?.capabilities.generation}>Revise content</button><small>Previous versions are saved. Changes run through evidence checks automatically.</small></form></section>
<section id="studio-download" hidden={panel !== 'download'} className="studio-panel studio-download-panel">
  <div><h2>Finalize & download</h2><p>Independent evidence review → quality threshold → your final approval → download. Nothing is posted automatically.</p>
    {dirty ? <p role="status">Save your edits before requesting review. <button type="button" onClick={() => setPanel('write')}>Return to editor</button></p> : Boolean(item.review?.issues.length) && <p role="status">Fix source or citation issues first. <button type="button" onClick={() => setPanel('sources')}>View issues</button></p>}
  </div>
  <section className="studio-readable-section"><h3>1. Assign an independent reviewer</h3><p>Choose a person who has not contributed to this package. The reviewer must sign in with that account; workspace reviewers must have review access.</p>
    <form key={`${item.id}:${item.reviewerId || ''}`} onSubmit={event => { event.preventDefault(); const reviewerId = String(new FormData(event.currentTarget).get('reviewerId') || '').trim(); if (reviewerId) void run('Assigning reviewer', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/assign-reviewer`, { revision: item.revision, reviewerId }, 'POST')); setNotice('Reviewer assigned. Share the review link with that person.') }) }}><label>Reviewer account ID<input name="reviewerId" required maxLength={128} defaultValue={item.reviewerId || ''} disabled={disabled || dirty} autoComplete="off" /></label><button disabled={disabled || dirty}>Assign reviewer</button></form>
    {item.reviewerId && <p><Link to={`/studio-review/${encodeURIComponent(reviewOwner || '')}/${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">Open assigned review ↗</Link> · Reviewer: {item.reviewerId}</p>}
    <button type="button" disabled={disabled || dirty} onClick={() => void run('Checking review', async () => { accept(await studioRead<StudioPackage>(`/packages/${item.id}`)); setReviewNow(Date.now()); setNotice('Latest review loaded.') })}>Refresh review status</button>
  </section>
  <section className="studio-readable-section"><h3>2. Check the quality filter</h3><p>Average ≥8/10 · every dimension ≥6/10 · factual support ≥8/10. Missing evidence, unresolved rights, contradictions or accessibility issues block finalization regardless of score. These are editorial judgments, not a reach forecast.</p>
    {!quality ? <p role="status">Unrated. An independent reviewer must record evidence and ratings for this saved version.</p> : <><p role="status">{reviewReady ? 'Quality review passed' : item.independentReview?.status === 'needs_revision' ? 'Needs revision' : 'Review needs renewal'} · Average {quality.overall.toFixed(2)}/10</p><details><summary>View ratings and evidence</summary>{(Object.entries(qualityDimensions) as [keyof typeof qualityDimensions, string][]).map(([key, label]) => { const rating = quality.ratings[key]; return <article className="studio-evidence" key={key}><h4>{label}: {rating ? `${rating.score}/10` : 'Unrated'}</h4>{rating && <><p>{rating.note}</p><p>Sources: {rating.evidenceIds.map(id => { const source = item.evidence.find(value => value.id === id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id} · {source.title} </a> : <span key={id}>{id} (unavailable) </span> })}</p></>}</article> })}</details><p>Review expires: {item.independentReview?.expiresAt ? new Date(item.independentReview.expiresAt).toLocaleString() : 'Unavailable'}. Content or source changes require a new review.</p></>}
    {!reviewReady && <p>Revise any failing dimension, resolve blockers and obtain a current independent review before approval.</p>}
  </section>
  <section className="studio-readable-section"><h3>3. Approve this version</h3><p>This approves the saved writing and production directions. Rendered media needs its own checks before use.</p><button type="button" className="workflow-primary" disabled={disabled || dirty || !reviewReady || Boolean(item.review?.issues.length) || finalized || item.reviewerId === uid} onClick={() => void run('Approving saved version', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}`, { revision: item.revision, editorialStatus: 'approved' }, 'PATCH')); setNotice('This reviewed version is approved for download.') })}>Approve reviewed version</button>{item.reviewerId === uid && <p>The final approver must be a different person from the independent reviewer.</p>}{finalized && <p role="status">This version is approved for download.</p>}</section>
  <div><h3>4. Download your content</h3>{exportDisabled && <p>Downloads become available after source checks, a current passing quality review and final approval.</p>}<div className="studio-toolbar"><button className="workflow-primary" disabled={exportDisabled} onClick={() => void download('md')}>Download content</button><button disabled={exportDisabled} onClick={() => void download('json')}>Download production file (JSON)</button></div></div>
</section>
      </>}
    </> : <>
      <section id="studio-source-entry" hidden={!sourceEntry} className="studio-panel workflow-options"><h2>Start with your article</h2><p>Paste a public article link, then choose the content you need.</p>
        <form onSubmit={event => { event.preventDefault(); void run('Creating your content', async () => { const created = await studioRequest<StudioPackage>('/packages', { ...(selectedSources.length ? { sourceIds: selectedSources } : params.get('article') ? { articleId: params.get('article') } : { sourceUrl }), settings: profile, requestId: crypto.randomUUID() }, 'POST'); navigate(`/studio/${created.id}`) }) }}>
          {params.get('article') ? <p>Selected update ready. <Link to="/studio">Choose another source</Link></p> : <label>Article link<input ref={articleLinkInput} type="url" required={!selectedSources.length} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://publisher.com/article" /></label>}
          <div className="studio-fields">{(['industry', 'audience', 'language', 'tone'] as const).map(key => <label key={key}>{{ industry: 'Topic / industry', audience: 'Who is this for?', language: 'Language', tone: 'Writing style' }[key]}<input required maxLength={key === 'audience' ? 300 : key === 'language' ? 80 : 100} value={profile[key]} onChange={event => setProfile({ ...profile, [key]: event.target.value })} /></label>)}<label>Duration (seconds)<input type="number" min={15} max={180} value={profile.duration} onChange={event => setProfile({ ...profile, duration: Number(event.target.value) })} /></label></div>
          <fieldset disabled={Boolean(busy)}><legend>Selected platforms</legend><p>Only selected platform adaptations will be generated.</p>{platforms.map(platform => <label key={platform}><input type="checkbox" checked={profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).includes(platform)} onChange={event => { const selected = new Set(profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).filter(Boolean)); if (event.target.checked) selected.add(platform); else selected.delete(platform); setProfile({ ...profile, platform: platforms.filter(value => selected.has(value)).join(', ') }) }} /><span className="platform-mark" data-platform={platform} aria-hidden="true">{platformMarks[platform]}</span><span>{platform}</span></label>)}</fieldset>
          <OutputPicker outputs={profile.outputs || allOutputs} disabled={Boolean(busy)} onChange={outputs => setProfile({ ...profile, outputs })} />
          <div className="studio-toolbar"><button disabled={Boolean(busy) || (profile.outputs !== undefined && !profile.outputs.length) || !profile.platform}>Prepare content brief</button><button type="button" disabled={Boolean(busy)} onClick={() => void run('Saving defaults', async () => { setProfile(profileFields(await studioRequest<StudioProfile>('/profile', profileFields(profile), 'PUT'))); setNotice('Defaults saved.') })}>Save preferences</button></div>
        </form><button type="button" aria-expanded={showReferences} aria-controls="studio-saved-references" onClick={() => setShowReferences(value => !value)}>{showReferences ? 'Hide saved references' : 'Use saved references'}{selectedSources.length ? ` (${selectedSources.length} selected)` : ''}</button><div id="studio-saved-references" hidden={!showReferences}>{showReferences && <StudioLibrary industry={profile.industry} selected={selectedSources} onSelect={setSelectedSources} />}</div>
      </section><section className="studio-panel studio-saved-work"><div className="studio-library-heading"><div><h2>Your drafts</h2></div><span className="studio-badge">{draftsLoading ? 'Loading' : `${packages.length} saved`}</span></div>{draftsLoading ? <StudioLoading label="Loading your saved drafts" /> : draftsError ? <div role="alert"><p>{draftsError}</p><button type="button" onClick={() => { setDraftsLoading(true); setDraftsError(''); setLoadAttempt(value => value + 1) }}>Try loading drafts again</button></div> : !packages.length ? <p>No drafts yet. Choose an idea from the Topic Library to get started.</p> : <div className="studio-package-list">{packages.map(entry => <Link key={entry.id} to={`/studio/${entry.id}`}><span className="studio-draft-status" data-status={entry.editorialStatus}>{entry.editorialStatus === 'approved' ? 'Ready' : 'Draft'}</span><strong>{entry.title}</strong><span>Updated {new Date(entry.updatedAt).toLocaleString()}</span><span className="studio-draft-open">{entry.content ? 'Open draft' : 'Finish setup'} →</span></Link>)}</div>}</section></>}
  </section>
}

function StudioLoading({ label }: { label: string }) {
  return <div className="studio-loading" role="status" aria-live="polite"><p><span className="studio-loading-spinner" aria-hidden="true" />{label}…</p><div className="studio-package-list" aria-hidden="true">{[0, 1, 2, 3].map(index => <div className="studio-loading-card" key={index}><span /><span /><span /></div>)}</div></div>
}

function OutputPicker({ outputs, disabled, onChange }: { outputs: OutputFormat[]; disabled: boolean; onChange: (outputs: OutputFormat[]) => void }) {
  return <fieldset disabled={disabled}><legend>What you’ll get</legend>{allOutputs.map(output => <label key={output}><input type="checkbox" checked={outputs.includes(output)} onChange={event => { const selected = new Set(outputs); if (event.target.checked) { selected.add(output); if (output === 'production') selected.add('script') } else { selected.delete(output); if (output === 'script') selected.delete('production') } onChange(allOutputs.filter(value => selected.has(value))) }} /><span className="output-choice-copy"><strong>{outputLabels[output]}</strong><small>{outputDescriptions[output]}</small></span></label>)}<p>Carousel slides include a script. Turning off the script also turns off slides.</p></fieldset>
}

function DraftTextEditor({ content, evidence, profile, disabled, onChange, activeSlide, onSlideSelect, onSectionChange }: { content: StudioContent; evidence: StudioPackage['evidence']; onSectionChange: (section: string) => void; profile: StudioProfile; disabled: boolean; onChange: (value: StudioContent) => void; activeSlide: number; onSlideSelect: (index: number) => void }) {
  const [briefSection, setBriefSection] = useState('')
  const [section, setSection] = useState(content.strategy?.platforms?.length ? 'posts' : content.captions ? 'captions' : content.script !== undefined ? 'script' : 'website')
  const [platformIndex, setPlatformIndex] = useState(0)
  const [captionChannel, setCaptionChannel] = useState(profile.platform.split(',').map(value => value.trim()).includes('Instagram') ? 'reel' : profile.platform === 'LinkedIn' ? 'linkedin' : 'reel')
  const [copyNotice, setCopyNotice] = useState('')
  const [editingField, setEditingField] = useState('')
  const [sourceField, setSourceField] = useState('')
  const slideIndex = Math.min(activeSlide, Math.max(0, (content.scenes?.length || 1) - 1))
  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(cleanCopy(value)); setCopyNotice('Text copied. Supporting sources stay in your saved draft and download.') }
    catch { setCopyNotice('Could not copy. Select the text and copy it manually.') }
  }
  function update(path: (string | number)[], value: string) {
    const next = structuredClone(content)
    let target: Record<string | number, unknown> = next as unknown as Record<string | number, unknown>
    for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>
    target[path[path.length - 1]] = value
    onChange(next)
  }
  const field = (label: string, value: string, path: (string | number)[]) => {
    const key = path.join('.')
    const editing = editingField === key
    // Edit only text segments; immutable reference tokens retain their original sentence positions.
    const parts = value.split(/(\[C\d+\])/g)
    const references = [...new Set(value.match(/\[C\d+\]/g) || [])]
    return <div className="composer-field composer-read-card" key={key}>
      <div className="composer-field-heading"><div className="composer-field-title-group"><strong>{label}</strong>{editing && <span className="composer-field-count">{cleanCopy(value).length.toLocaleString()} characters</span>}</div><div className="composer-field-actions">{editing ? <button type="button" className="composer-action-btn" aria-label={`Done editing ${label}`} onClick={() => setEditingField('')}>Done</button> : <details className="studio-options composer-field-options"><summary aria-label={`Options for ${label}`}>Options</summary><div className="studio-options-list"><button type="button" disabled={disabled} aria-label={`Edit ${label}`} onClick={event => { setEditingField(key); event.currentTarget.closest('details')?.removeAttribute('open') }}>Edit text</button><button type="button" aria-label={`Copy ${label}`} onClick={event => { void copyText(value); event.currentTarget.closest('details')?.removeAttribute('open') }}>Copy text</button>{references.length > 0 && <button type="button" aria-label={`View sources for ${label}`} aria-expanded={sourceField === key} onClick={event => { setSourceField(sourceField === key ? '' : key); event.currentTarget.closest('details')?.removeAttribute('open') }}>{sourceField === key ? 'Hide sources' : 'View sources'} · {references.length}</button>}</div></details>}</div></div>
      <p className="composer-readable-copy" hidden={editing}>{cleanCopy(value) || 'No text yet. Choose Edit to add your words.'}</p>
      <div hidden={!editing} className="composer-text-passages">{parts.map((part, index) => /^\[C\d+\]$/.test(part) ? null : (/[\p{L}\p{N}]/u.test(part) || parts.length === 1) ? <div key={index}><label htmlFor={`draft-${path.join('-')}-${index}`}>{references.length > 0 ? `${label} · passage ${Math.floor(index / 2) + 1}` : label}</label><textarea id={`draft-${path.join('-')}-${index}`} disabled={disabled} rows={part.length < 120 ? 2 : part.length < 500 ? 4 : 8} maxLength={12000} value={part} onChange={event => { const edited = [...parts]; edited[index] = event.target.value; update(path, edited.join('')) }} /></div> : null)}<p className="studio-muted">Check your edits against the sources before saving.</p></div>

      {sourceField === key && <div className="composer-source-list" role="region" aria-label={`Sources for ${label}`}><strong>Where this information comes from</strong>{references.map(reference => { const claim = content.claims.find(entry => entry.id === reference.slice(1, -1)); const source = evidence.find(entry => entry.id === claim?.evidenceId); return <div key={reference}><p>{claim?.text || 'This source link needs checking.'}</p>{source ? <><a href={source.url} target="_blank" rel="noreferrer">{source.publisher || source.title || 'Read original source'} ↗</a><blockquote>{claim?.quote}</blockquote>{source.limitations?.map(limit => <p className="studio-muted" key={limit}>{limit}</p>)}</> : <p>Source unavailable. Check sources before downloading.</p>}</div>})}<small>Sources provide context; a linked source is not a guarantee of factual accuracy.</small></div>}
    </div>
  }

  const strategyFields = { angle: 'Content angle', audience: 'Audience description', whyNow: 'Why this matters now', factCheck: 'Fact-check notes', delivery: 'Delivery direction', languageReason: 'Language rationale', voiceReason: 'Voice rationale' } as const
  const platformFields = { headline: 'Headline', hook: 'Hook', body: 'Post body', cta: 'Call to action', thumbnail: 'Thumbnail brief', format: 'Format description', retentionPlan: 'Retention plan', alternativeHook: 'Alternative hook', testPlan: 'Test plan' } as const
  const experimentFields = { variable: 'Test variable', variantA: 'Variant A', variantB: 'Variant B', metric: 'Observed metric', decisionRule: 'Decision rule' } as const
  const sections = [
    ...(content.strategy?.platforms?.length ? [{ id: 'posts', label: 'Post', hint: 'Title & body' }] : []),
    ...(content.captions ? [{ id: 'captions', label: 'Caption', hint: 'Text below the post' }] : []),
    ...(content.scenes?.length || profile.outputs?.includes('production') && content.script?.trim() ? [{ id: 'slides', label: 'Carousel', hint: `${content.scenes?.length || 0} slides` }] : []),
    ...(content.script !== undefined ? [{ id: 'script', label: 'Script', hint: 'What to say' }] : []),
    ...(content.hooks?.length ? [{ id: 'hooks', label: 'Hooks', hint: 'Opening lines' }] : []),
    ...(content.strategy?.keywords ? [{ id: 'keywords', label: 'Keywords', hint: 'Phrases to include' }] : []),
    ...(content.website ? [{ id: 'website', label: 'Article', hint: 'Title & text' }] : []),
  ]
  return <div className="draft-text-editor"><nav className="composer-content-nav" aria-label="Content sections">{sections.map(entry => <button type="button" key={entry.id} aria-pressed={section === entry.id} onClick={() => { setSection(entry.id); onSectionChange(entry.id === 'captions' && captionChannel === 'linkedin' ? 'captions-linkedin' : entry.id); setEditingField(''); setSourceField(''); setCopyNotice('') }}><strong>{entry.label}</strong><span>{entry.hint}</span></button>)}</nav>
    {content.captions && <section hidden={section !== 'captions'} id="editor-caption" className="editor-block editor-block--caption"><h3>Your caption</h3><p>The text people read underneath your post.</p><div className="composer-channel-switch" role="group" aria-label="Caption version"><button type="button" aria-pressed={captionChannel === 'reel'} onClick={() => { setCaptionChannel('reel'); onSectionChange('captions') }}>Instagram / Reel</button><button type="button" aria-pressed={captionChannel === 'linkedin'} onClick={() => { setCaptionChannel('linkedin'); onSectionChange('captions-linkedin') }}>LinkedIn version</button></div>{captionChannel === 'reel' ? field('Instagram / Reel caption', content.captions.reel, ['captions', 'reel']) : field('LinkedIn caption', content.captions.linkedin, ['captions', 'linkedin'])}</section>}
    {content.script !== undefined && <section hidden={section !== 'script'} id="editor-script" className="editor-block editor-block--script"><h3>Script <span>Words to say aloud</span></h3><p>Use this for a voiceover or a presenter. It is separate from your caption.</p>{field('Narration', content.script, ['script'])}</section>}
    {Boolean(content.hooks?.length) && <section hidden={section !== 'hooks'} id="editor-hooks" className="editor-block editor-block--hook"><h3>Opening hooks <span>Grab attention first</span></h3><p>Choose an opening line for your post or video. These are alternatives, not one long caption.</p>{content.hooks?.map((hook, index) => field(`Opening hook ${index + 1}`, hook, ['hooks', index]))}</section>}
    {(!content.scenes || !content.strategy?.production) && profile.outputs?.includes('production') && content.script?.trim() && <section hidden={section !== 'slides'} className="studio-readable-section"><h3>Carousel slides</h3><p>Turn your script into editable text slides. Images are not generated.</p><button type="button" disabled={disabled} onClick={() => onChange(prepareStoryboard(content, profile))}>Create slides from this script</button></section>}
    {Boolean(content.scenes?.length) && <section hidden={section !== 'slides'} className="composer-slides"><div className="composer-slide-picker" aria-label="Choose a slide">{content.scenes?.map((scene, index) => <button type="button" key={index} aria-label={`Edit slide ${index + 1}`} aria-pressed={slideIndex === index} onClick={() => onSlideSelect(index)}><span>{index + 1}</span><strong>{cleanCopy(scene.onScreen)}</strong></button>)}</div>{content.scenes?.map((scene, index) => <section hidden={slideIndex !== index} id={`editor-slide-${index}`} className="editor-block editor-block--slide" key={index}><h3>Build slide {index + 1} of {content.scenes?.length}</h3><p>A carousel is a set of images people swipe through. Each slide combines a picture with a short message.</p><div className="slide-use-guide"><figure className="slide-placement-guide"><div className="slide-placement-image"><span>Picture or illustration</span><strong>{cleanCopy(scene.onScreen)}</strong></div><figcaption>Placement example · no image created</figcaption></figure><div><strong>How to use this slide</strong><ol><li><b>Copy the words</b> into a text box in your design tool.</li><li><b>Create or choose a picture</b> using the image brief below.</li><li><b>Combine them</b> in Canva or your preferred editor. Export each slide as an image, then upload them in order.</li></ol><p>Download here saves your content and instructions. It does not create finished carousel images.</p></div></div><div className="slide-purpose slide-purpose--words"><span className="slide-purpose-number" aria-hidden="true">1</span><div><h4>Put these words on the slide</h4><p>Your audience will read this on the image. Use <b>Copy</b> to paste it into your design, or <b>Edit</b> to change it.</p><span className="slide-purpose-tag">Visible to your audience</span></div></div>{field(`Slide ${index + 1} text`, scene.onScreen, ['scenes', index, 'onScreen'])}<div className="slide-purpose slide-purpose--image"><span className="slide-purpose-number" aria-hidden="true">2</span><div><h4>Use this brief to create the image</h4><p>This describes the picture to make or find. Copy it for your designer or use it as a guide in your design tool.</p><span className="slide-purpose-tag">Instructions for you or your designer · do not publish as caption</span></div></div>{field(`Slide ${index + 1} visual direction`, scene.visualPrompt, ['scenes', index, 'visualPrompt'])}</section>)}</section>}

    {content.website && <section hidden={section !== 'website'} className="editor-block editor-block--script"><h3>Website article <span>Title and main text</span></h3>{field('Website title', content.website.title, ['website', 'title'])}{field('Website body', content.website.body, ['website', 'body'])}</section>}

    {content.strategy?.keywords && <section hidden={section !== 'keywords'} id="editor-keywords" className="editor-block editor-block--keywords"><h3>Keywords <span>Topics to include naturally</span></h3><p>These are suggested phrases, not measured search rankings or hashtags.</p><button type="button" onClick={() => setEditingField(editingField === 'keywords' ? '' : 'keywords')}>{editingField === 'keywords' ? 'Done editing keywords' : 'Edit keywords'}</button><div className="composer-keyword-chips" hidden={editingField === 'keywords'}>{content.strategy.keywords.map((keyword, index) => <span key={index}>{cleanCopy(keyword)}</span>)}</div><div className="editor-keyword-list" hidden={editingField !== 'keywords'}>{content.strategy.keywords.map((keyword, index) => <label key={index}><span>Keyword {index + 1}</span><input disabled={disabled} maxLength={100} value={keyword} onChange={event => update(['strategy', 'keywords', index], event.target.value)} /></label>)}</div></section>}
    {(content.strategy?.platforms?.length || 0) > 1 && <div className="studio-select-inline" hidden={section !== 'posts'}><label htmlFor="editing-platform-select">Editing platform</label><div className="studio-custom-select-wrapper"><select id="editing-platform-select" aria-label="Editing platform" value={platformIndex} onChange={event => setPlatformIndex(Number(event.target.value))} className="studio-custom-select">{content.strategy?.platforms?.map((platform, index) => <option key={platform.platform} value={index}>{platform.platform}</option>)}</select><ChevronDown size={14} className="studio-select-chevron" aria-hidden="true" /></div></div>}
    {content.strategy?.platforms?.map((platform, index) => <section hidden={section !== 'posts' || index !== platformIndex} className="editor-block editor-block--caption" key={platform.platform}><h3>{platform.platform} post</h3>{Object.entries(platformFields).filter(([key]) => ['headline', 'hook', 'body', 'cta'].includes(key)).map(([key, label]) => <div key={key}>{field(label, platform[key as keyof typeof platformFields], ['strategy', 'platforms', index, key])}</div>)}</section>)}

    {content.strategy && <details className="composer-creative-brief"><summary>Creative brief <span>Optional · guidance for you or your team</span></summary><p>Use this to plan your message, brief a designer, or compare two versions. These notes are not the text you publish.</p><div className="composer-notes-picker"><label htmlFor="creative-brief-select">What do you need help with?</label><div className="studio-custom-select-wrapper"><select id="creative-brief-select" aria-label="Creative brief guidance" value={briefSection} onChange={event => { if (event.target.value) { setBriefSection(event.target.value); setEditingField(''); setSourceField('') } }} className="studio-custom-select"><option value="">Choose guidance</option><option value="notes">Understand the audience & message</option>{Boolean(content.strategy.platforms?.length) && <option value="post-plan">Brief a designer & plan the post</option>}{Boolean(content.strategy.experiments?.length) && <option value="experiments">Compare two content versions</option>}</select><ChevronDown size={14} className="studio-select-chevron" aria-hidden="true" /></div></div>
    {content.strategy && <section hidden={briefSection !== 'notes'} className="editor-block editor-block--notes"><h3>Planning notes <span>For your team, not the post</span></h3>{Object.entries(strategyFields).map(([key, label]) => field(label, content.strategy![key as keyof typeof strategyFields], ['strategy', key]))}</section>}
    {(content.strategy.platforms?.length || 0) > 1 && <div className="studio-select-inline" hidden={briefSection !== 'post-plan'}><label htmlFor="planning-platform-select">Platform to plan</label><div className="studio-custom-select-wrapper"><select id="planning-platform-select" aria-label="Planning platform" value={platformIndex} onChange={event => setPlatformIndex(Number(event.target.value))} className="studio-custom-select">{content.strategy.platforms?.map((platform, index) => <option key={platform.platform} value={index}>{platform.platform}</option>)}</select><ChevronDown size={14} className="studio-select-chevron" aria-hidden="true" /></div></div>}
    {content.strategy.platforms?.map((platform, index) => <section hidden={briefSection !== 'post-plan' || index !== platformIndex} className="editor-block editor-block--caption" key={platform.platform}><h3>Design & posting instructions</h3><p>Share the thumbnail brief with your designer. Use the format and opening-line ideas when preparing your {platform.platform} post.</p>{Object.entries(platformFields).filter(([key]) => !['headline', 'hook', 'body', 'cta'].includes(key)).map(([key, label]) => field(label, platform[key as keyof typeof platformFields], ['strategy', 'platforms', index, key]))}</section>)}
    {content.strategy?.experiments?.map((experiment, index) => <section hidden={briefSection !== 'experiments'} className="studio-readable-section" key={index}><h3>Editorial test {index + 1}</h3>{Object.entries(experimentFields).map(([key, label]) => field(`Test ${index + 1} ${label}`, experiment[key as keyof typeof experimentFields], ['strategy', 'experiments', index, key]))}</section>)}
    </details>}
    {copyNotice && <p className="composer-copy-notice" role="status">{copyNotice}</p>}
  </div>
}
