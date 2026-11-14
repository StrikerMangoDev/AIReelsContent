import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/auth-state'
import { studioRead, studioRequest, type StudioConfig, type StudioContent, type StudioPackage, type StudioProfile, type OutputFormat } from '@/services/studio-api'
import { trackEvent } from '@/services/analytics'
import type { Article } from '@/types/news'
import { StudioMedia } from './StudioMedia'
import { StudioProductionPrompts } from './StudioProductionPrompts'
import { StudioCompletePackage } from './StudioCompletePackage'
import { StudioStartCards, StudioWorkspaceGuide } from './StudioFlowCards'
import { StudioDraftList } from './StudioDraftList'
import { StudioKeywordUsage } from './StudioKeywordUsage'
import { buildExportFile, allExportSections, type ExportFormat, type ExportSection } from '@/services/studio-export'
import { StudioExport } from './StudioExport'
import { activeWorkspace, workspaceIdentity } from '@/services/workspace-session'
import { StudioPublishing } from './StudioPublishing'
import { StudioLibrary } from './StudioLibrary'
import { StudioHistory } from './StudioHistory'
import { cleanCopy } from './ContentPreview'
import { ConnectedPostPreview } from './ConnectedPostPreview'
import { ChevronDown, SlidersHorizontal, PenLine, Download, Clock3, Copy, Check, BookOpen, Save, Undo2, Images, Settings2 } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { StudioPackageSetup } from './StudioPackageSetup'
import { StudioSetupPreview } from './StudioSetupPreview'
import { initialContentSection, initialContentFormat, savedContentFormats, formatContentSection, formatSections, formatLabels, scriptReadingEstimate, type ContentFormat } from '@/services/studio-package'
import { prepareStoryboard } from '@/services/storyboard'
import '@/styles/studio.css'
import '@/styles/content-workflow.css'
import '@/styles/studio-desk.css'
import '@/styles/studio-flow.css'
import '@/styles/studio-home.css'
import '@/styles/studio-setup.css'
import '@/styles/studio-editor.css'

const initialProfile: StudioProfile = { industry: 'AI', audience: 'Curious professionals', language: 'English', tone: 'Clear and informative', platform: 'Instagram', duration: 45, voice: 'Auto' }
const platforms = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']
const allOutputs: OutputFormat[] = ['script', 'captions', 'website', 'platforms', 'production']
const outputLabels: Record<OutputFormat, string> = { script: 'Video script & opening lines', captions: 'Social captions', website: 'Blog / website article', platforms: 'Posts for your selected platforms', production: 'Scenes, slides & visual directions' }
const outputDescriptions: Record<OutputFormat, string> = { script: 'A narration script with alternative opening lines.', captions: 'Ready-to-edit text to accompany your posts.', website: 'A longer article with a title and body.', platforms: 'Headlines, post text and calls to action for each platform.', production: 'Scene narration, slide text and visual directions. Includes a script; finished media is separate.' }
const platformMarks: Record<string, string> = { Facebook: 'f', Instagram: 'IG', X: 'X', LinkedIn: 'in', YouTube: 'YT' }
const profileFields = (value: StudioProfile): StudioProfile => ({ industry: value.industry, audience: value.audience, language: value.language, tone: value.tone, platform: value.platform, duration: value.duration, voice: value.voice || 'Auto', outputs: value.outputs || allOutputs })
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Something went wrong. Please retry.'
const workspaceTools: { title: string; items: { label: string; panel: string; view?: string; beforeWriting?: boolean }[] }[] = [
  { title: 'Plan & research', items: [{ label: 'Content brief', panel: 'package', view: 'brief', beforeWriting: true }, { label: 'Strategy workflow', panel: 'package', view: 'workflow', beforeWriting: true }, { label: 'Website SEO', panel: 'package', view: 'seo', beforeWriting: true }] },
  { title: 'Create & produce', items: [{ label: 'Production kit', panel: 'production' }, { label: 'AI recommendations', panel: 'package', view: 'decisions' }, { label: 'External prompts', panel: 'package', view: 'prompts' }, { label: 'Team & assets', panel: 'package', view: 'team', beforeWriting: true }, { label: 'Saved platform content', panel: 'package', view: 'content' }, { label: 'Ask AI to revise', panel: 'revise' }] },
  { title: 'Review & deliver', items: [{ label: 'Sources & checks', panel: 'sources' }, { label: 'Rules & declarations', panel: 'package', view: 'rules', beforeWriting: true }, { label: 'Internal package export', panel: 'package', view: 'downloads' }] },
  { title: 'Publish & learn', items: [{ label: 'Account plans & publishing', panel: 'publishing' }, { label: 'Posting records', panel: 'package', view: 'posting', beforeWriting: true }, { label: 'Results & learning', panel: 'package', view: 'results', beforeWriting: true }, { label: 'Version history', panel: 'history' }] },
]

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
  const [panel, setPanelValue] = useState('write')
  const [packageView, setPackageView] = useState('brief')
  const toolsMenu = useRef<HTMLDetailsElement>(null)
  const homeHeading = useRef<HTMLHeadingElement>(null)
  const [packageContextDirty, setPackageContextDirty] = useState(false)
  const setPanel = (next: string) => {
    if (packageContextDirty && next !== 'package') { setNotice('Save or discard your unsaved workspace details before leaving this tool.'); return }
    setPanelValue(next)
  }
  function openWorkspace(next: string, view = 'brief') {
    if (next === 'package') setPackageView(view)
    setPanel(next)
    toolsMenu.current?.querySelector('summary')?.focus()
  }
  const [showAccountPlans, setShowAccountPlans] = useState(false)
  const [previewPlatform, setPreviewPlatform] = useState('')
  const [mobileView, setMobileView] = useState('editor')
  const [activeSlide, setActiveSlide] = useState(0)
  const [previewSection, setPreviewSection] = useState('')
  const [chosenFormat, setChosenFormat] = useState<ContentFormat | null>(null)
  const [showIdeaResearch, setShowIdeaResearch] = useState(false)
  const [sourceEntry, setSourceEntry] = useState(Boolean(params.get('article')))
  const articleLinkInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (sourceEntry) articleLinkInput.current?.focus() }, [sourceEntry])
  const [showReferences, setShowReferences] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const settingsChanged = Boolean(item && JSON.stringify(profileFields(profile)) !== JSON.stringify(profileFields(item.settings)))
  const unsaved = dirty || packageContextDirty || settingsChanged || Boolean(instruction.trim())
  const navigation = useBlocker(unsaved)
  useEffect(() => { if (!unsaved && navigation.state === 'blocked') navigation.reset() }, [unsaved, navigation])
  const downloadDispatch = useRef(false)
  const downloadActive = useRef(true)
  useEffect(() => { downloadActive.current = true; return () => { downloadActive.current = false } }, [])
  const generationDispatch = useRef(false)
  const generationHeading = useRef<HTMLHeadingElement>(null)
  const editorHeading = useRef<HTMLHeadingElement>(null)
  const focusGeneratedContent = useRef(false)
  useEffect(() => { if (focusGeneratedContent.current && content && panel === 'write' && !busy && item?.status === 'completed') { focusGeneratedContent.current = false; editorHeading.current?.focus({ preventScroll: true }); editorHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }) } }, [content, panel, busy, item?.status])
  const [job, setJob] = useState<{ id: string; status: string } | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
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
  useEffect(() => { if (!unsaved) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [unsaved])
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
        if (terminal) { const succeeded = nextJob.status === 'completed' && next.status === 'completed' && Boolean(next.content); setChosenFormat(null); setPreviewSection(''); setPreviewPlatform(''); setActiveSlide(0); setContent(next.content); setNotice(succeeded ? 'Draft generated. Review your text, keywords and sources before using it.' : next.content ? 'The latest attempt did not produce a new draft. Your saved content is unchanged.' : ''); if (succeeded && !packageContextDirty) { setPanelValue('write'); setMobileView('editor') } else if (!succeeded) focusGeneratedContent.current = false }
      } catch (cause) { if (active) { lastPollError = message(cause); setError(lastPollError) } } finally { checking = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [item?.id, item?.jobId, item?.status, packageContextDirty])
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setNotice('')
    try { await action() } catch (cause) {
      setError(message(cause))
      if (item && label === 'Writing content') { try { accept(await studioRead<StudioPackage>(`/packages/${item.id}`)) } catch { /* Keep the current content. */ } }
    } finally { setBusy('') }
  }
  function accept(next: StudioPackage) { setPreviewSection(''); setPreviewPlatform(''); setActiveSlide(0); setItem(next); setContent(next.content); setProfile(profileFields(next.settings)); setDirty(false); setPackages(previous => [next, ...previous.filter(entry => entry.id !== next.id)]) }
  function edit(next: StudioContent) { setContent(next); setDirty(true); setNotice('') }
  async function requestGeneration() {
    if (!item || busy || dirty || packageContextDirty || generationDispatch.current || ['generating', 'dispatch_unknown'].includes(item.status) || !config?.capabilities.generation || !profile.platform || !(profile.outputs || allOutputs).length || invalidBrief || needsSource) return
    const selected = { settings: structuredClone(profileFields(profile)), instruction }
    generationDispatch.current = true
    setPanelValue('write'); setMobileView('editor')
    try { await run('Writing content', async () => {
      let current = item
      if (JSON.stringify(profileFields(current.settings)) !== JSON.stringify(selected.settings)) {
        current = await studioRequest<StudioPackage>(`/packages/${current.id}`, { revision: item.revision, settings: selected.settings }, 'PATCH')
        accept(current)
      }
      const generated = await studioRequest<StudioPackage>(`/packages/${current.id}/generate`, { requestId: crypto.randomUUID(), confirmed: true, revision: current.revision, ...(selected.instruction.trim() ? { instruction: selected.instruction } : {}) }, 'POST')
      focusGeneratedContent.current = true; accept(generated)
      setInstruction(''); setPanel('write'); setNotice(generated.content && generated.status === 'completed' ? 'Draft generated. Review your text, keywords and sources before using it.' : 'Your draft is queued. You can leave and return to check its progress.')
    }) } finally { generationDispatch.current = false }
  }
  async function download(format: ExportFormat, sections: readonly ExportSection[] = allExportSections) {
    if (!item || !content || busy || dirty || item.status === 'generating' || item.review?.issues.length || item.status === 'dispatch_unknown' || downloadDispatch.current) return
    downloadDispatch.current = true
    try { await run('Preparing your download', async () => {
      const ready = item
      const actor = workspaceIdentity(); const workspace = activeWorkspace()
      const exported = await studioRead<{ manifest: Record<string, unknown>; package: StudioPackage }>(`/packages/${item.id}/export`)
      const saved = exported.package
      if (!saved.content) throw new Error('Saved content is unavailable.')
      if (saved.id !== ready.id || saved.revision !== ready.revision) throw new Error('The content changed while preparing your download. Check the saved version and try again.')
      const file = await buildExportFile(exported, workingType, format, sections)
      if (!downloadActive.current) return
      if (actor !== workspaceIdentity() || workspace !== activeWorkspace()) throw new Error('Workspace changed. Try again in your current workspace.')
      const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `content-${item.id}.${format}`
      try { anchor.click() } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice('Your download is ready.')
      void trackEvent('package_exported')
    }) } finally { downloadDispatch.current = false }
  }
  const jobStatus = job?.id === item?.jobId ? job?.status : item?.jobStatus
  const generationPending = busy === 'Writing content' || item?.status === 'generating' && jobStatus !== 'failed'
  useEffect(() => { if (generationPending && !content && panel === 'write') { generationHeading.current?.focus({ preventScroll: true }); generationHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }) } }, [generationPending, content, panel])
  const retryGeneration = Boolean(item?.error && jobStatus === 'failed')
  const disabled = Boolean(busy) || item?.status === 'generating'
  const needsSource = Boolean(item && !content && !item.evidence.some(source => source.excerpt.length >= 100))
  const canAddSource = needsSource && !item?.researchId && item?.status === 'draft' && !item.jobId && !item.sourceIds?.length && item.evidence.length < 12
  const generationHint = busy ? `${busy}...` : error || (needsSource ? (item?.researchId ? 'Reading the sources linked to your idea is required before generation. Retry if the publisher was unavailable.' : canAddSource ? 'Add and save a readable original article below before generating. This draft currently has only short headlines.' : 'This draft needs more source evidence. Start a new draft with a readable original article or approved library sources.') : !profile.platform ? 'Select at least one platform.' : !(profile.outputs || allOutputs).length ? 'Select at least one content format.' : !config?.capabilities.generation ? 'Generation is unavailable. Your choices are saved in this session.' : 'Sources are ready. Generate uses your generation allowance.')
  const finalized = Boolean(item?.editorialStatus === 'approved' && item.approval?.method === 'independent-human')
  const exportBlocked = dirty || !content || Boolean(item?.review?.issues.length) || ['generating', 'dispatch_unknown'].includes(item?.status || '')
  const exportDisabled = disabled || exportBlocked
  const invalidBrief = !profile.audience.trim() || !profile.language.trim() || !profile.tone.trim()
  const reading = scriptReadingEstimate(content?.script)
  const availableFormats = content ? savedContentFormats(content) : []
  const workingType = content ? chosenFormat && availableFormats.includes(chosenFormat) ? chosenFormat : initialContentFormat(content, item?.settings.outputs) : 'post'
  const firstSection = content ? formatContentSection(content, workingType) : ''
  function changeFormat(value: ContentFormat) {
    setChosenFormat(value); setNotice(''); setPreviewSection(''); setPreviewPlatform(''); setActiveSlide(0); setMobileView('editor')
  }
  if (loading) return <section className="studio content-workflow"><StudioLoading label="Checking your workspace" /></section>
  if (!identity) return <section className="studio"><header className="studio-heading"><span className="studio-eyebrow">Content studio</span><h1>Your next story starts here.</h1><p>Research a niche, create platform content and prepare your production team.</p></header>{configured ? <Link className="studio-button" to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in to continue</Link> : <p role="status">Account access is not configured yet.</p>} <Link className="studio-button" to="/">Explore the research desk</Link></section>
  if (packageId && !item && busy) return <section className="studio content-workflow studio-loading" aria-busy="true" role="status"><h1>Opening your draft…</h1><p>Loading your saved content and source checks.</p><div className="studio-loading-block" aria-hidden="true" /><div className="studio-loading-block" aria-hidden="true" /></section>
  return <section className={`studio content-workflow studio-desk${item ? ' studio-composer' : ' studio-home'}`} aria-busy={Boolean(busy)}>
    {navigation.state === 'blocked' && <div className="complete-package-warning" role="alert"><p>You have unsaved changes. Keep editing to save them, or discard them and leave.</p><div className="studio-toolbar"><button type="button" onClick={() => navigation.reset()}>Keep editing</button><button type="button" disabled={Boolean(busy)} onClick={() => navigation.proceed()}>Discard changes and leave</button></div>{busy && <p>Wait for the current operation before leaving.</p>}</div>}
    {!item ? <>
      <header className="studio-home-heading">
        <div>{(sourceEntry || showAccountPlans) && <button type="button" className="studio-home-back" onClick={() => { setSourceEntry(false); setShowAccountPlans(false); homeHeading.current?.focus() }}>← Back to Content Studio</button>}<h1 ref={homeHeading} tabIndex={-1}>{showAccountPlans ? 'Account plans & publishing' : sourceEntry ? 'Create from an article' : 'Content Studio'}</h1><p>{showAccountPlans ? 'Manage each account’s audience, weekly direction and publishing records.' : sourceEntry ? 'Add your source first. You can review the content settings before creating your brief.' : 'Create source-backed content or continue a saved draft.'}</p></div>
        {!showAccountPlans && !sourceEntry && <div className="studio-home-account-entry"><button type="button" className="studio-home-secondary" aria-controls="studio-account-plans" onClick={() => { setShowAccountPlans(true); homeHeading.current?.focus() }}>Account plans & publishing</button><span>Weekly plans and connected accounts</span></div>}
      </header>
      {!sourceEntry && !showAccountPlans && <StudioStartCards articleOpen={sourceEntry} onArticleToggle={() => setSourceEntry(true)} />}
    </> : <header className="studio-editorial-header">
      <div className="studio-editorial-actions">
        <Link to="/studio" className="studio-action-back" onClick={event => { if (dirty && !window.confirm('Leave without saving your edits?')) event.preventDefault() }}>← All content</Link>
      </div>
      <div className="studio-title-lockup"><h1 className="studio-main-title">{item.title}</h1></div>
      <div className="desk-context"><span className="studio-editorial-badge" data-status={dirty ? 'unsaved' : content && !exportBlocked ? 'approved' : 'draft'}>{dirty ? 'Unsaved changes' : content && !exportBlocked ? 'Content saved' : content ? 'Checks need attention' : 'Draft brief'}</span><span>{item.settings.platform}</span><span>{item.settings.language === 'Auto' ? 'Language from brief' : item.settings.language}</span>{content?.script && (workingType === 'reel' || workingType === 'audio') && <span><Clock3 size={15} aria-hidden="true" />{reading.words} words · about {reading.seconds}s at 140 words/min</span>}<span>Revision {item.revision}</span></div>
    </header>}

    {error && <div className="studio-alert" role="alert">{error}</div>}{busy && !(busy === 'Writing content' && !content) && (busy === 'Loading workspace' ? packageId && <StudioLoading label="Opening your saved draft" /> : <p role="status">{busy}…</p>)}{notice && <p className="studio-save-notice" role="status">{notice}</p>}
    {packageId && !item && !busy && error && <button type="button" onClick={() => { setError(''); setBusy('Loading workspace'); setLoadAttempt(value => value + 1) }}>Try loading draft again</button>}
    {packageId ? item && <>


      {item.researchContext && showIdeaResearch && <section id="composer-research" className="studio-research-drawer" aria-label="Research briefing"><div className="studio-research-drawer-header"><h3>Research briefing</h3><p>{item.researchContext.opportunity.whatChanged}</p></div><div className="studio-research-drawer-body"><p className="studio-research-angle"><strong>Suggested editorial angle:</strong> {item.researchContext.opportunity.angle}</p><div className="studio-research-sources-grid">{item.evidence.map(source => <article key={source.id} className="studio-research-source-item"><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><p>{(source.limitations || []).join(' ')}</p></article>)}</div></div></section>}
      <div className={`composer-navigation${!content || panel === 'setup' ? ' setup-navigation' : ''}`}>
        <nav className="studio-section-nav" aria-label="Content workspace sections">{[
          { id: 'setup', label: '1 · Setup', Icon: SlidersHorizontal },
          { id: 'write', label: '2 · Edit & preview', Icon: PenLine },
          { id: 'download', label: '3 · Download', Icon: Download },
        ].map(({ id, label, Icon }) => <button key={id} type="button" disabled={!content && id !== 'setup' && !(generationPending && id === 'write')} aria-label={label} aria-pressed={panel === id && (Boolean(content) || id === 'setup' || generationPending && id === 'write') || !content && !generationPending && panel === 'write' && id === 'setup'} onClick={() => setPanel(id)}><span className="studio-stage-number" aria-hidden="true">{label[0]}</span><Icon size={18} aria-hidden="true" /><span>{label.replace(/^\d · /, '')}</span></button>)}</nav>
      <details ref={toolsMenu} className="studio-workspace-tools" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary>More options <ChevronDown size={16} aria-hidden="true" /></summary><div className="studio-tool-groups">{workspaceTools.map(group => <div key={group.title}><h2>{group.title}</h2>{group.items.filter(tool => tool.view !== 'seo' || (profile.outputs || allOutputs).includes('website')).map(tool => <button key={tool.label} type="button" disabled={!content && !tool.beforeWriting} aria-pressed={panel === tool.panel && (tool.panel !== 'package' || packageView === tool.view)} onClick={event => { openWorkspace(tool.panel, tool.view); event.currentTarget.closest('details')?.removeAttribute('open') }}>{tool.label}</button>)}</div>)}<div><h2>Help &amp; organization</h2><button type="button" aria-pressed={panel === 'guide'} onClick={event => { openWorkspace('guide'); event.currentTarget.closest('details')?.removeAttribute('open') }}>Workspace guide</button><button type="button" disabled={disabled || dirty} onClick={() => void run('Adding to Planner', async () => { try { await studioRequest('/planning/board', { packageId: item.id, status: content && !exportDisabled ? 'ready' : 'drafting' }, 'POST') } catch (cause) { if (!(cause instanceof Error && cause.message === 'This package is already on your board')) throw cause } setNotice('Saved to Content Planner. You can keep editing here.') })}>Add to Planner</button>{item.researchContext && <button type="button" aria-expanded={showIdeaResearch} aria-controls="composer-research" onClick={() => setShowIdeaResearch(value => !value)}>{showIdeaResearch ? 'Hide idea brief' : 'Read idea brief'}</button>}<Link to="/planning">Open Planner</Link><Link to="/ideas">Choose another idea</Link></div>{!content && <p className="setup-tool-availability">Writing, production and delivery tools open after you generate content. Planning is available now.</p>}</div></details>
      </div>


      {panel === 'guide' && <StudioWorkspaceGuide hasContent={Boolean(content)} hasWebsite={(profile.outputs || allOutputs).includes('website')} onOpen={openWorkspace} />}
      {panel === 'package' && <section className="studio-panel studio-task-workspace"><StudioCompletePackage key={`complete:${item.id}:${item.revision}`} packageId={item.id} revision={item.revision} initialView={content ? 'brief' : 'workflow'} requestedView={packageView} onDirtyChange={value => { setPackageContextDirty(value); if (!value) setNotice(current => current === 'Save or discard your unsaved workspace details before leaving this tool.' ? '' : current) }} disabled={disabled || dirty} lockReason={dirty ? 'Save your content edits before changing or copying package instructions.' : disabled ? 'Finish the current operation before changing package instructions.' : ''} /></section>}


      <section hidden={['package', 'guide'].includes(panel) || busy === 'Writing content' || item.status === 'generating' || (Boolean(content) && panel !== 'setup')} className="studio-panel workflow-options studio-setup">
        <div className="setup-workbench"><div className="setup-settings">
        <StudioPackageSetup profile={profile} subject={[item.title, item.researchContext?.opportunity.angle].filter(Boolean).join(' ')} disabled={disabled || dirty} onChange={setProfile}>
        <details className="studio-options desk-customize setup-deliverables"><summary>Customize included deliverables (optional)</summary><p>Keep several formats in one package. Only the checked deliverables are generated.</p><OutputPicker outputs={profile.outputs || allOutputs} disabled={disabled || dirty} onChange={outputs => setProfile({ ...profile, outputs })} /></details>
        </StudioPackageSetup>
        <details id="setup-source-summary" className="studio-options setup-source-summary"><summary>Source summary · {item.evidence.length} {item.evidence.length === 1 ? 'source' : 'sources'}</summary><p>These sources support your draft. Review their passages and limitations before generating.</p>{item.evidence.length ? item.evidence.map(source => <article key={source.id}><h3><a href={source.url} target="_blank" rel="noreferrer">{source.id} · {source.title}</a></h3><p>{(source.limitations || []).join(' ')}</p><details className="studio-options setup-evidence-excerpt"><summary>Read saved evidence excerpt</summary><blockquote>{source.excerpt}</blockquote></details></article>) : <p>No source evidence is attached. Add a readable article below before generating.</p>}{item.review?.issues.length ? <ul>{item.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : null}</details>
        </div><StudioSetupPreview packageId={item.id} revision={item.revision} active={panel === 'setup' || !content} content={content || null} profile={profile} title={item.title} evidence={item.evidence} settingsChanged={settingsChanged} /></div>
        <div className="setup-actionbar">
        <p className="studio-muted">{profile.platform.split(',').filter(value => value.trim()).length} platforms · {(profile.outputs || allOutputs).length} deliverables selected.<br /><a href="#setup-source-summary">{item.evidence.length} {item.evidence.length === 1 ? 'source' : 'sources'} linked · Review sources</a></p>
        {dirty && <p role="status">Save your content edits in Content before changing the next generation.</p>}
        {invalidBrief && <p role="status">Add an audience, language and writing style before generating.</p>}
        {content && (settingsChanged || retryGeneration) && <button type="button" className="workflow-primary" disabled={disabled || dirty || !profile.platform || !(profile.outputs || allOutputs).length || !config?.capabilities.generation || invalidBrief} onClick={requestGeneration}>{retryGeneration ? 'Try generation again' : 'Generate selected content'}</button>}{content && !settingsChanged && !retryGeneration && <div className="studio-toolbar"><button type="button" className="workflow-primary" onClick={() => setPanel('write')}>Continue to editor</button></div>}{!content && !['generating', 'dispatch_unknown'].includes(item.status) && <div className="studio-toolbar"><button className="workflow-primary" aria-describedby="generation-feedback" disabled={disabled || needsSource || !profile.platform || !(profile.outputs || allOutputs).length || !config?.capabilities.generation || invalidBrief} onClick={requestGeneration}>Generate content</button><span id="generation-feedback" role={error ? 'alert' : 'status'}>{invalidBrief ? 'Add an audience, language and writing style above.' : generationHint}{canAddSource && <> <a href="#studio-add-source">Add article</a></>}</span></div>}{content && (settingsChanged || retryGeneration) && <p id="setup-generation-feedback" role={error ? 'alert' : 'status'}>{error || (invalidBrief ? 'Complete the brief above.' : generationHint)}</p>}
        </div>
      </section>
      {canAddSource && <section id="studio-add-source" className="studio-panel workflow-next"><h2>Add the original article</h2><p>This topic has only a short headline. Add a readable source before generating so your draft has evidence to work from.</p><form onSubmit={event => { event.preventDefault(); void run('Reading the source', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/sources`, { revision: item.revision, sourceUrl: sourceUrl.trim() }, 'POST')); setSourceUrl(''); setNotice('Source added. Review your output choices, then generate your draft.') }) }}><label>Original article URL<input type="url" required value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://publisher.com/article" disabled={disabled} /></label><button disabled={disabled || !sourceUrl.trim()}>Add source to this draft</button></form></section>}
      {needsSource && item.researchId && <button disabled={disabled} onClick={() => { setError(''); setBusy('Reading sources from your selected idea'); setLoadAttempt(value => value + 1) }}>Retry source retrieval</button>}
      {needsSource && !item.researchId && !canAddSource && !['generating', 'dispatch_unknown'].includes(item.status) && <p role="status">This package needs more source evidence, but its existing job or source selection cannot be changed here. Start a new draft with a readable original article or approved library sources.</p>}

      {generationPending && !content && panel === 'write' && <section className="studio-panel" aria-label="Generating content"><h2 ref={generationHeading} tabIndex={-1}>Creating your content</h2><StudioLoading label={busy === 'Writing content' ? 'Starting your generation' : jobStatus === 'running' ? 'Writing your content' : 'Your draft is queued'} /><p>Your selected formats will appear here when ready. Leaving this page does not start another attempt.</p></section>}
      {item.error && busy !== 'Writing content' && item.status !== 'generating' && item.status !== 'dispatch_unknown' && <p className="studio-alert" role="alert">{item.error.includes('API key') ? 'Generation is unavailable because the free AI connection needs attention. A workspace administrator must update the provider key before you try again. Your saved work is safe.' : 'The last writing attempt could not finish. Your saved draft is unchanged. You can keep editing or request a new attempt.'}</p>}
      {item.status === 'dispatch_unknown' && item.error?.includes('"httpStatus":504') && <section className="studio-panel"><h2>Prepare another attempt</h2><p>No content was received. The previous attempt may still be charged, so its budget reservation will remain. Preparing a retry does not call AI; you will choose your outputs and start generation again.</p><button disabled={disabled || dirty} onClick={() => { if (window.confirm('Keep the previous cost reserved and prepare another attempt? A new generation may incur another charge within your remaining budget.')) void run('Preparing retry', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/recover-generation`, { revision: item.revision, acknowledgeTimeoutCost: true }, 'POST')); setNotice('Retry prepared. Previous cost remains reserved. Choose the outputs you need, then generate your content.'); setPanel('setup') }) }}>Prepare retry — keep previous cost reserved</button></section>}
      {item.jobId && ['generating', 'dispatch_unknown'].includes(item.status) && <div className="studio-job-notice" role="status">{item.status === 'dispatch_unknown' && !item.error?.includes('"httpStatus":504') && <button disabled={disabled || dirty} onClick={() => void run('Checking last attempt', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/recover-generation`, { revision: item.revision }, 'POST')); setNotice('The previous attempt produced no usable content. Your saved draft is preserved. You may request a new attempt.') })}>Check last attempt</button>}<strong>{jobStatus === 'reserved' ? 'Your draft is queued' : jobStatus === 'running' ? 'Creating your content' : item.error?.includes('"httpStatus":504') ? 'Gemini timed out — no content received' : 'Generation needs attention'}</strong><p>{jobStatus === 'reserved' ? 'Waiting to start. You can safely leave this page; returning will not create another draft.' : jobStatus === 'running' ? 'Writing your selected formats and checking source references. Your editor will appear here when the draft is ready.' : item.error?.includes('"httpStatus":504') ? 'Gemini returned a gateway timeout. Your selected idea, sources and settings are saved, but this attempt returned no content. Its possible charge is still reserved; automatic retry is blocked to avoid repeat charges.' : 'The previous request has an unconfirmed outcome. Your idea and settings are saved; checking its status does not generate content.'}</p>{jobStatus === 'reserved' && <button disabled={Boolean(busy)} onClick={() => { if (window.confirm('Cancel this queued generation before dispatch?')) void run('Cancelling queued generation', async () => { await studioRequest(`/jobs/${encodeURIComponent(item.jobId || '')}/cancel`, {}, 'POST'); accept(await studioRead<StudioPackage>(`/packages/${item.id}`)); setNotice('Queued generation cancelled. No new provider attempt was started by this action.') }) }}>Cancel queued generation</button>}</div>}
      {item.status === 'generating' && jobStatus === 'failed' && <section className="studio-panel"><h2>The previous attempt stopped</h2><p>Check the saved attempt before trying again. This check does not call AI or release an uncertain cost.</p><button disabled={Boolean(busy) || dirty} onClick={() => void run('Checking last attempt', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/recover-generation`, { revision: item.revision }, 'POST')); setNotice('The stopped attempt was reconciled. Review your scope before requesting another generation.') })}>Check stopped attempt</button></section>}
      {content && <>


        <div>
          <section hidden={panel !== 'write'} className="editor-workspace" aria-label="Write and preview">
<div className="desk-working-format editor-format-bar"><div className="editor-format-controls"><label>Content format<select name="workingFormat" aria-label="Content format" value={workingType} onChange={event => changeFormat(event.target.value as ContentFormat)}>{availableFormats.map(format => <option key={format} value={format}>{formatLabels[format]}</option>)}</select></label><p>Saved formats only. No new generation.</p></div><div className="editor-next-tools"><IconButton icon={Images} label="Media & prompts" onClick={() => setPanel('production')} /><IconButton icon={Settings2} label="Posting & accounts" onClick={() => setPanel('publishing')} /></div></div>

            <div className="studio-mobile-switch" aria-label="Editor or preview">{['editor', 'preview'].map(value => <button key={value} type="button" aria-pressed={mobileView === value} onClick={() => setMobileView(value)}>{value === 'editor' ? 'Edit content' : 'See preview'}</button>)}</div>
            <div className="studio-compose-grid" data-mobile-view={mobileView}>
              <section className="studio-panel studio-editor-column" aria-label="Content editor"><div className="composer-editor-heading"><div><h2 ref={editorHeading} tabIndex={-1}>Your generated content</h2><p>Edit your content, review sources, then download.</p></div><span className="editor-save-badge" data-dirty={dirty}>{dirty ? 'Unsaved changes' : 'Draft saved'}</span></div><DraftTextEditor key={`${item.id}:${item.revision}:${workingType}`} format={workingType} initialSection={firstSection} onSources={() => setPanel('sources')} content={content} evidence={item.evidence} profile={item.settings} disabled={disabled} onChange={edit} onPlatformChange={setPreviewPlatform} onSectionChange={section => { setPreviewSection(section) }} activeSlide={activeSlide} onSlideSelect={index => { setActiveSlide(index) }} /></section>
              <aside className="studio-preview-column" aria-label="Post preview"><ConnectedPostPreview packageId={item.id} revision={item.revision} active={panel === 'write'} dirty={dirty} evidence={item.evidence} contentFormat={workingType} content={content} selectedPlatform={previewPlatform || content.strategy?.platforms?.[0]?.platform} selectedSection={previewSection || (firstSection === 'captions' && item.settings.platform === 'LinkedIn' ? 'captions-linkedin' : firstSection)} title={item.title} activeSlide={activeSlide} onSlideSelect={setActiveSlide} /><EditorSupport item={item} dirty={dirty} disabled={disabled || dirty || !config?.capabilities.generation} onRevise={prompt => { setInstruction(prompt); setPanel('revise') }} onPublishing={() => setPanel('publishing')} /></aside>
            </div>
            <div className="studio-save-row editor-actionbar">{dirty && <IconButton icon={Undo2} label="Discard unsaved edits" tooltip="Discard edits" className="editor-discard" disabled={disabled} onClick={() => { if (window.confirm('Discard your unsaved content edits? The saved draft will be restored.')) { setContent(item.content); setDirty(false); setNotice('Unsaved edits discarded. Your saved draft is restored.') } }} />}{dirty && <IconButton icon={Save} label="Save draft" className="editor-save-button" disabled={disabled || !dirty} onClick={() => void run('Saving draft', async () => { const saved = await studioRequest<StudioPackage>(`/packages/${item.id}`, { revision: item.revision, content }, 'PATCH'); accept(saved); setNotice('Draft saved. You can continue editing or download when ready.') })} />}<button type="button" className="studio-continue-btn workflow-primary" disabled={dirty} onClick={() => setPanel('download')}>Continue to download</button><span role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span></div>

          </section>
          <section hidden={panel !== 'production'} className="studio-panel desk-production">
            <div className="studio-panel-back-row"><button type="button" className="studio-panel-back-btn" onClick={() => setPanel('write')}>← Back to Edit &amp; preview</button><button type="button" onClick={() => openWorkspace('package', 'prompts')}>Open external prompts</button><button type="button" onClick={() => openWorkspace('package', 'team')}>Team tasks &amp; assets</button></div>
            <header className="desk-section-intro desk-production-intro"><h2>{formatLabels[workingType]} production</h2><p>Instructions for this format. Copy a brief, then create the asset in your preferred tool.</p></header>
            {panel === 'production' && <StudioProductionPrompts key={`handoff:${item.id}:${item.revision}:${workingType}`} pack={item} format={workingType} initialSceneIndex={activeSlide} onSceneChange={setActiveSlide} lockedReason={dirty ? 'Save your edits before copying a team handoff for this version.' : disabled || item.status === 'dispatch_unknown' ? 'Finish the current operation or resolve the previous generation attempt before copying a handoff.' : item.review?.issues.length ? 'Resolve the saved source and citation issues before copying a production prompt.' : ''} />}

            {content.strategy?.production && <details className="studio-options desk-customize"><summary>Original package directions (optional)</summary>{Object.entries(content.strategy.production).map(([key, value]) => <article key={key}><h3>{({ videoPrompt: 'Video brief', audioPrompt: 'Voiceover brief', musicDirection: 'Music direction', subtitleStyle: 'Subtitle style', editingNotes: 'Editing notes' } as Record<string, string>)[key] || key}</h3><p className="preserve-lines">{cleanCopy(value)}</p></article>)}</details>}
            <details className="studio-options desk-customize"><summary>All saved scenes &amp; original directions</summary><section className="studio-readable-section"><h3>Scene-by-scene editor brief</h3>{!content.scenes?.length ? <p>No scenes have been generated. In Setup, choose a Reel or carousel pack to include a script and scene directions.</p> : <div className="desk-scene-table">{content.scenes.map((scene, index) => <article key={index}><div><strong>Scene {index + 1}</strong><small>{scene.timing}</small></div><div><strong>Say this</strong><p>{cleanCopy(scene.narration)}</p><small>Delivery: {cleanCopy(scene.voiceDirection)}</small></div><div><strong>Show this</strong><p>{cleanCopy(scene.onScreen)}</p><small>{cleanCopy(scene.visualPrompt)}</small></div></article>)}</div>}</section>
            </details><details className="studio-options desk-customize"><summary>All media tools (advanced)</summary><p>These tools use the full saved package and may support other formats. Choose a tool and review its scope before generating.</p>{panel === 'production' && <StudioMedia key={`${item.id}:${item.revision}`} packageId={item.id} initialPrompt={content.scenes?.[0]?.visualPrompt ?? ''} script={content.script || content.strategy?.platforms?.[0]?.body || content.captions?.reel || ''} strategy={content.strategy} scenes={content.scenes || []} disabled={disabled || dirty || Boolean(item.review?.issues.length)} />}</details><div className="studio-toolbar"><button type="button" className="workflow-primary" onClick={() => setPanel('download')}>Continue to download</button></div>
          </section>
          {panel === 'publishing' && <StudioPublishing packageId={item.id} pack={item} disabled={disabled || dirty} />}<section hidden={panel !== 'sources'} className="studio-panel"><h2>Sources & evidence checks</h2><><h3>Evidence checks</h3><p>Checks validate citation integrity, not factual truth or representative audience sentiment.</p>{item.review?.issues.length ? <ul>{item.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>No citation issues found. Check the claims, original sources and reuse rights before downloading; automatic checks cannot establish factual truth.</p>}
            {item.evidence.map(source => <article className="studio-evidence" key={source.id}><h3><a href={source.url} target="_blank" rel="noreferrer">{source.id} · {source.title} ↗</a></h3><p className="studio-muted">{source.type} · Retrieved {new Date(source.retrievedAt).toLocaleString()}</p><p>{(source.limitations || []).join(' ')}</p><section className="studio-readable-section"><h3>Evidence excerpt</h3><blockquote>{source.excerpt}</blockquote></section></article>)}

            <section className="studio-readable-section"><h3>Claim references</h3>{content.claims.map(claim => <article key={claim.id}><h3>{claim.id} · {claim.text}</h3><p>{claim.evidenceId}</p><blockquote>{claim.quote}</blockquote></article>)}</section>
            <button type="button" disabled={disabled || dirty} onClick={() => void run('Checking saved content', async () => { accept(await studioRequest<StudioPackage>(`/packages/${item.id}/review`, {}, 'POST')); setNotice('Saved content and citations rechecked. No reviewer or AI generation was requested.') })}>Recheck saved content</button>
            <button disabled={disabled || dirty} onClick={() => void run('Refreshing evidence', async () => { if (!window.confirm('Refresh the original sources now? This fetches each source again and may invalidate approval if evidence changed.')) return; accept(await studioRequest<StudioPackage>(`/packages/${item.id}/refresh-evidence`, { confirmed: true }, 'POST')); setNotice('Evidence refreshed. Regenerate if the source changed.') })}>Refresh original sources</button>
            {identity.role === 'admin' && config?.capabilities.publishing && <button disabled={disabled || dirty || !finalized} onClick={() => { if (window.confirm('Publish this approved article publicly on this website?')) void run('Publishing', async () => { const result = await studioRequest<{ id: string }>(`/packages/${item.id}/publish`, {}, 'POST'); navigate(`/insights/${result.id}`) }) }}>Publish website article</button>}
          </></section>
          <section hidden={panel !== 'history'} className="studio-panel"><div className="studio-panel-back-row"><button type="button" className="studio-panel-back-btn" onClick={() => setPanel('write')}>← Back to Edit & preview</button></div>{panel === 'history' && <StudioHistory item={item} onRestore={accept} disabled={disabled || dirty} />}</section>
        </div>

<section hidden={panel !== 'revise'} className="studio-panel"><div className="studio-panel-back-row"><button type="button" className="studio-panel-back-btn" onClick={() => setPanel('write')}>← Back to Edit & preview</button></div><h2>Ask AI to revise</h2><form className="refine-form" onSubmit={event => { event.preventDefault(); requestGeneration() }}><label>What would you like to change?<textarea maxLength={2000} required value={instruction} disabled={disabled || dirty} onChange={event => setInstruction(event.target.value)} placeholder="Make the hook more practical, explain the concern fairly, and use conversational Hinglish…" /></label><button disabled={disabled || dirty || !instruction.trim() || !config?.capabilities.generation}>Revise content</button><small>Previous versions are saved. Changes run through evidence checks automatically.</small></form></section>
<section id="studio-download" hidden={panel !== 'download'} className="studio-panel studio-download-panel">
  <StudioExport key={`${item.id}:${item.revision}:${workingType}`} pack={item} contentFormat={workingType} disabled={exportDisabled} dirty={dirty} busy={busy} error={error} onDownload={download} onEdit={() => setPanel('write')} onSources={() => setPanel('sources')} onHandoff={view => openWorkspace('package', view)} onPublishing={() => setPanel('publishing')} />
</section>
      </>}
    </> : <>
      <section id="studio-source-entry" hidden={!sourceEntry || showAccountPlans} className="studio-panel workflow-options studio-home-article"><h2>Start with your article</h2><p>Paste a public article link, then choose the content you need.</p>
        <form onSubmit={event => { event.preventDefault(); void run('Creating your content', async () => { const created = await studioRequest<StudioPackage>('/packages', { ...(selectedSources.length ? { sourceIds: selectedSources } : params.get('article') ? { articleId: params.get('article') } : { sourceUrl }), settings: profile, requestId: crypto.randomUUID() }, 'POST'); navigate(`/studio/${created.id}`) }) }}>
          {params.get('article') ? <p>Selected update ready. <Link to="/studio">Choose another source</Link></p> : <label>Article link<input ref={articleLinkInput} type="url" required={!selectedSources.length} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://publisher.com/article" /></label>}
          <details className="studio-options desk-customize"><summary>Audience &amp; content preferences</summary><p>Use your saved preferences, or change them for this article. You can choose a content pack after preparing the brief.</p>
          <div className="studio-fields">{(['industry', 'audience', 'language', 'tone'] as const).map(key => <label key={key}>{{ industry: 'Topic / industry', audience: 'Who is this for?', language: 'Language', tone: 'Writing style' }[key]}<input required maxLength={key === 'audience' ? 300 : key === 'language' ? 80 : 100} value={profile[key]} onChange={event => setProfile({ ...profile, [key]: event.target.value })} /></label>)}<label>Duration (seconds)<input type="number" min={15} max={180} value={profile.duration} onChange={event => setProfile({ ...profile, duration: Number(event.target.value) })} /></label></div>
          <fieldset disabled={Boolean(busy)}><legend>Selected platforms</legend><p>Only selected platform adaptations will be generated.</p>{platforms.map(platform => <label key={platform}><input type="checkbox" checked={profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).includes(platform)} onChange={event => { const selected = new Set(profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).filter(Boolean)); if (event.target.checked) selected.add(platform); else selected.delete(platform); setProfile({ ...profile, platform: platforms.filter(value => selected.has(value)).join(', ') }) }} /><span className="platform-mark" data-platform={platform} aria-hidden="true">{platformMarks[platform]}</span><span>{platform}</span></label>)}</fieldset>
          <OutputPicker outputs={profile.outputs || allOutputs} disabled={Boolean(busy)} onChange={outputs => setProfile({ ...profile, outputs })} />
          <div className="studio-toolbar"><button type="button" disabled={Boolean(busy)} onClick={() => void run('Saving defaults', async () => { setProfile(profileFields(await studioRequest<StudioProfile>('/profile', profileFields(profile), 'PUT'))); setNotice('Defaults saved.') })}>Save preferences</button></div><p className="studio-muted">Save these settings as defaults for future content briefs.</p>
          </details>
          <div className="studio-toolbar"><button disabled={Boolean(busy) || (profile.outputs !== undefined && !profile.outputs.length) || !profile.platform}>Prepare content brief</button></div>
        </form><button type="button" aria-expanded={showReferences} aria-controls="studio-saved-references" onClick={() => setShowReferences(value => !value)}>{showReferences ? 'Hide saved references' : 'Use saved references'}{selectedSources.length ? ` (${selectedSources.length} selected)` : ''}</button><div id="studio-saved-references" hidden={!showReferences}>{showReferences && <StudioLibrary industry={profile.industry} selected={selectedSources} onSelect={setSelectedSources} />}</div>
      </section>
      {!sourceEntry && !showAccountPlans && <StudioDraftList packages={packages} loading={draftsLoading} error={draftsError} onRetry={() => { setDraftsLoading(true); setDraftsError(''); setLoadAttempt(value => value + 1) }} />}
      <section id="studio-account-plans" hidden={!showAccountPlans}>{showAccountPlans && <StudioPublishing />}</section></>}
  </section>
}

function StudioLoading({ label }: { label: string }) {
  return <div className="studio-loading" role="status" aria-live="polite"><p><span className="studio-loading-spinner" aria-hidden="true" />{label}…</p><div className="studio-package-list" aria-hidden="true">{[0, 1, 2, 3].map(index => <div className="studio-loading-card" key={index}><span /><span /><span /></div>)}</div></div>
}

function EditorSupport({ item, dirty, disabled, onRevise, onPublishing }: { item: StudioPackage; dirty: boolean; disabled: boolean; onRevise: (prompt: string) => void; onPublishing: () => void }) {
  const actions = [
    { label: 'Improve the opening', hint: 'A clearer hook with the same facts', prompt: 'Improve the opening hook while preserving the supported facts, citations and intended audience.' },
    { label: 'Make it simpler', hint: 'Clearer wording for your audience', prompt: 'Simplify the wording for the selected audience. Preserve the meaning, source attribution and citation references.' },
    { label: 'Shorten content', hint: 'Fewer words, same key message', prompt: 'Shorten the selected content while keeping its key message, necessary qualifications and citation references.' },
    { label: 'Explore alternatives', hint: 'Alternative hooks and captions', prompt: 'Suggest alternative opening hooks and caption wording within the selected formats. Keep all supported facts and citation references intact.' },
  ]
  return <>
    <section className="studio-panel editor-support" aria-label="AI writing assistant"><h2>AI writing assistant</h2><p>Choose a change, review the request, then run AI. Uses your generation allowance.</p><div>{actions.map(action => <button type="button" key={action.label} disabled={disabled} onClick={() => onRevise(action.prompt)}><strong>{action.label}</strong><span>{action.hint}</span></button>)}</div>{disabled && <p role="status">{dirty ? 'Save your edits before asking AI to revise.' : 'AI revision is unavailable while processing or when generation is disabled.'}</p>}</section>
    <section className="studio-panel editor-checklist" aria-label="Publishing checklist"><h2>Publishing checklist</h2><ul>
      <li data-state={dirty ? 'pending' : 'ready'}>{dirty ? 'Unsaved edits — save your draft' : 'Draft saved'}</li>
      <li data-state={item.settings.platform ? 'ready' : 'pending'}>{item.settings.platform ? 'Platform selected' : 'Select a platform in Setup'}</li>
      <li data-state={item.review && !item.review.issues.length && !dirty ? 'ready' : 'pending'}>{dirty ? 'Source checks repeat after saving' : item.review ? item.review.issues.length ? `${item.review.issues.length} source issues need attention` : 'Automatic citation checks passed' : 'Citation checks not available'}</li>
      <li data-state="pending">Media requirements: check before publishing</li>
      <li data-state="pending">Connected account: check before publishing</li>
    </ul><p>Automatic checks do not guarantee factual accuracy. Media and account readiness are checked in publishing.</p><button type="button" onClick={onPublishing}>View publishing requirements</button></section>
  </>
}

function OutputPicker({ outputs, disabled, onChange }: { outputs: OutputFormat[]; disabled: boolean; onChange: (outputs: OutputFormat[]) => void }) {
  return <fieldset disabled={disabled}><legend>What you’ll get</legend>{allOutputs.map(output => <label key={output}><input type="checkbox" checked={outputs.includes(output)} onChange={event => { const selected = new Set(outputs); if (event.target.checked) { selected.add(output); if (output === 'production') selected.add('script') } else { selected.delete(output); if (output === 'script') selected.delete('production') } onChange(allOutputs.filter(value => selected.has(value))) }} /><span className="output-choice-copy"><strong>{outputLabels[output]}</strong><small>{outputDescriptions[output]}</small></span></label>)}<p>Carousel slides include a script. Turning off the script also turns off slides.</p></fieldset>
}

function DraftTextEditor({ content, format, evidence, profile, disabled, onChange, activeSlide, onSlideSelect, onSectionChange, onPlatformChange, initialSection, onSources }: { onSources?: () => void; format?: ContentFormat; initialSection?: string; content: StudioContent; onPlatformChange?: (platform: string) => void; evidence: StudioPackage['evidence']; onSectionChange: (section: string) => void; profile: StudioProfile; disabled: boolean; onChange: (value: StudioContent) => void; activeSlide: number; onSlideSelect: (index: number) => void }) {
  const [briefSection, setBriefSection] = useState('notes')
  const [section, setSection] = useState(initialSection || (format ? formatContentSection(content, format) : initialContentSection(content)))
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
      <div className="composer-field-heading"><div className="composer-field-title-group"><strong>{label}</strong>{editing && <span className="composer-field-count">{cleanCopy(value).length.toLocaleString()} characters</span>}</div><div className="composer-field-actions">{editing ? <IconButton icon={Check} label={`Done editing ${label}`} tooltip="Finish editing" onClick={() => setEditingField('')} /> : <><IconButton icon={PenLine} disabled={disabled} label={`Edit ${label}`} tooltip="Edit" onClick={() => setEditingField(key)} /><IconButton icon={Copy} label={`Copy ${label}`} tooltip="Copy" onClick={() => void copyText(value)} />{references.length > 0 && <IconButton icon={BookOpen} label={`View sources for ${label}`} tooltip={sourceField === key ? 'Hide sources' : `View ${references.length} source references`} aria-expanded={sourceField === key} onClick={() => setSourceField(sourceField === key ? '' : key)} />}</>}</div></div>
      <p className="composer-readable-copy" hidden={editing}>{cleanCopy(value) || 'No text yet. Choose Edit to add your words.'}</p>
      <div hidden={!editing} className="composer-text-passages">{parts.map((part, index) => /^\[C\d+\]$/.test(part) ? null : (/[\p{L}\p{N}]/u.test(part) || parts.length === 1) ? <div key={index}><label htmlFor={`draft-${path.join('-')}-${index}`}>{references.length > 0 ? `${label} · passage ${Math.floor(index / 2) + 1}` : label}</label><textarea id={`draft-${path.join('-')}-${index}`} disabled={disabled} rows={part.length < 120 ? 2 : part.length < 500 ? 4 : 8} maxLength={12000} value={part} onChange={event => { const edited = [...parts]; edited[index] = event.target.value; update(path, edited.join('')) }} /></div> : null)}<p className="studio-muted">Check your edits against the sources before saving.</p></div>

      {sourceField === key && <div className="composer-source-list" role="region" aria-label={`Sources for ${label}`}><strong>Where this information comes from</strong>{references.map(reference => { const claim = content.claims.find(entry => entry.id === reference.slice(1, -1)); const source = evidence.find(entry => entry.id === claim?.evidenceId); return <div key={reference}><p>{claim?.text || 'This source link needs checking.'}</p>{source ? <><a href={source.url} target="_blank" rel="noreferrer">{source.publisher || source.title || 'Read original source'} ↗</a><blockquote>{claim?.quote}</blockquote>{source.limitations?.map(limit => <p className="studio-muted" key={limit}>{limit}</p>)}</> : <p>Source unavailable. Check sources before downloading.</p>}</div>})}<small>Sources provide context; a linked source is not a guarantee of factual accuracy.</small></div>}
    </div>
  }

  const strategyFields = { angle: 'Content angle', audience: 'Audience description', whyNow: 'Why this matters now', factCheck: 'Fact-check notes', delivery: 'Delivery direction', languageReason: 'Language rationale', voiceReason: 'Voice rationale' } as const
  const platformFields = { headline: 'Headline', hook: 'Hook', body: 'Post body', cta: 'Call to action', thumbnail: 'Thumbnail brief', format: 'Format description', retentionPlan: 'Retention plan', alternativeHook: 'Alternative hook', testPlan: 'Test plan' } as const
  const experimentFields = { variable: 'Test variable', variantA: 'Variant A', variantB: 'Variant B', metric: 'Observed metric', decisionRule: 'Decision rule' } as const
  const sections = [
    ...(content.strategy?.platforms?.length ? [{ id: 'posts', label: 'Post text', hint: 'Text sent when publishing' }] : []),
    ...(content.captions ? [{ id: 'captions', label: 'Caption alternatives', hint: 'Other wording to choose from' }] : []),
    ...(content.scenes?.length || profile.outputs?.includes('production') && content.script?.trim() ? [{ id: 'slides', label: format === 'reel' ? 'Scenes' : 'Slides', hint: `${content.scenes?.length || 0} ${format === 'reel' ? 'scenes' : 'slides'}` }] : []),
    ...(content.script !== undefined ? [{ id: 'script', label: 'Narration', hint: 'Words to record' }] : []),
    ...(content.hooks?.length ? [{ id: 'hooks', label: 'Opening lines', hint: 'Hooks for your opening' }] : []),
    { id: 'keywords', label: 'Keywords & hashtags', hint: 'Usage and placement' },
    ...(content.website ? [{ id: 'website', label: 'Article', hint: 'Title & text' }] : []),
  ]
  const visibleSections = format ? formatSections[format].flatMap(id => sections.filter(entry => entry.id === id)) : sections
  return <div className="draft-text-editor"><nav className="composer-content-nav" aria-label="Content sections">{visibleSections.map(entry => <button type="button" key={entry.id} aria-pressed={section === entry.id} onClick={() => { setSection(entry.id); onSectionChange(entry.id === 'captions' && captionChannel === 'linkedin' ? 'captions-linkedin' : entry.id); setEditingField(''); setSourceField(''); setCopyNotice('') }}><strong>{entry.label}</strong><span className="composer-section-hint">{entry.hint}</span></button>)}<IconButton icon={BookOpen} label={`Sources (${evidence.length}) Evidence & checks`} tooltip={`Sources (${evidence.length})`} onClick={onSources} /></nav>

    {content.captions && <section hidden={section !== 'captions'} id="editor-caption" className="editor-block editor-block--caption"><h3>Caption alternatives</h3><p>Alternative wording for your post. Publishing uses the Post text when available. To use one of these versions, copy it into the post body and save.</p><div className="composer-channel-switch" role="group" aria-label="Caption version"><button type="button" aria-pressed={captionChannel === 'reel'} onClick={() => { setCaptionChannel('reel'); onSectionChange('captions') }}>Instagram / Reel</button><button type="button" aria-pressed={captionChannel === 'linkedin'} onClick={() => { setCaptionChannel('linkedin'); onSectionChange('captions-linkedin') }}>LinkedIn version</button></div>{captionChannel === 'reel' ? field('Instagram / Reel caption', content.captions.reel, ['captions', 'reel']) : field('LinkedIn caption', content.captions.linkedin, ['captions', 'linkedin'])}</section>}
    {content.script !== undefined && <section hidden={section !== 'script'} id="editor-script" className="editor-block editor-block--script"><h3>Script <span>Words to say aloud</span></h3><p>Use this for a voiceover or a presenter. It is separate from your caption.</p>{field('Narration', content.script, ['script'])}</section>}
    {Boolean(content.hooks?.length) && <section hidden={section !== 'hooks'} id="editor-hooks" className="editor-block editor-block--hook"><h3>Opening hooks <span>Grab attention first</span></h3><p>Choose an opening line for your post or video. These are alternatives, not one long caption.</p>{content.hooks?.map((hook, index) => field(`Opening hook ${index + 1}`, hook, ['hooks', index]))}</section>}
    {(!content.scenes || !content.strategy?.production) && profile.outputs?.includes('production') && content.script?.trim() && <section hidden={section !== 'slides'} className="studio-readable-section"><h3>{format === 'reel' ? 'Scene plan' : 'Carousel slides'}</h3><p>Turn your script into editable scene text and image directions. Media is not generated.</p><button type="button" disabled={disabled} onClick={() => onChange(prepareStoryboard(content, profile))}>{format === 'reel' ? 'Create scene plan' : 'Create slides from this script'}</button></section>}
    {Boolean(content.scenes?.length) && <section hidden={section !== 'slides'} className="composer-slides"><div className="composer-slide-picker" aria-label="Choose a slide">{content.scenes?.map((scene, index) => <button type="button" key={index} aria-label={`Edit ${format === 'reel' ? 'scene' : 'slide'} ${index + 1}`} aria-pressed={slideIndex === index} onClick={() => onSlideSelect(index)}><span>{index + 1}</span><strong>{cleanCopy(scene.onScreen)}</strong></button>)}</div>{content.scenes?.map((scene, index) => <section hidden={slideIndex !== index} id={`editor-slide-${index}`} className="editor-block editor-block--slide" key={index}><h3>{format === 'reel' ? 'Scene' : 'Slide'} {index + 1} of {content.scenes?.length}</h3>{format === 'reel' ? <><p>Timing: {scene.timing}. Your editor combines these visuals with the saved narration.</p><p className="preserve-lines">{cleanCopy(scene.narration)}</p></> : <p>Each slide combines a picture with a short message.</p>}<div className="slide-use-guide" hidden={format === 'reel'}><figure className="slide-placement-guide"><div className="slide-placement-image"><span>Picture or illustration</span><strong>{cleanCopy(scene.onScreen)}</strong></div><figcaption>Placement example · no image created</figcaption></figure><div><strong>How to use this slide</strong><ol><li><b>Copy the words</b> into a text box in your design tool.</li><li><b>Create or choose a picture</b> using the image brief below.</li><li><b>Combine them</b> in Canva or your preferred editor. Export each slide as an image, then upload them in order.</li></ol><p>Download here saves your content and instructions. It does not create finished carousel images.</p></div></div><div className="slide-purpose slide-purpose--words"><span className="slide-purpose-number" aria-hidden="true">1</span><div><h4>{format === 'reel' ? 'On-screen words' : 'Put these words on the slide'}</h4><p>Your audience will read this on the image. Use <b>Copy</b> to paste it into your design, or <b>Edit</b> to change it.</p><span className="slide-purpose-tag">Visible to your audience</span></div></div>{field(`Slide ${index + 1} text`, scene.onScreen, ['scenes', index, 'onScreen'])}<div className="slide-purpose slide-purpose--image"><span className="slide-purpose-number" aria-hidden="true">2</span><div><h4>Use this brief to create the image</h4><p>This describes the picture to make or find. Copy it for your designer or use it as a guide in your design tool.</p><span className="slide-purpose-tag">Instructions for you or your designer · do not publish as caption</span></div></div>{field(`Slide ${index + 1} visual direction`, scene.visualPrompt, ['scenes', index, 'visualPrompt'])}</section>)}</section>}

    {content.website && <section hidden={section !== 'website'} className="editor-block editor-block--script"><h3>Website article <span>Title and main text</span></h3>{field('Website title', content.website.title, ['website', 'title'])}{field('Website body', content.website.body, ['website', 'body'])}</section>}

    <section hidden={section !== 'keywords'} id="editor-keywords" className="editor-block editor-block--keywords"><header className="editor-keyword-heading"><h3>Keyword placement</h3>{Boolean(content.strategy?.keywords?.length) && <IconButton icon={editingField === 'keywords' ? Check : PenLine} label={editingField === 'keywords' ? 'Done editing keywords' : 'Edit keyword list'} tooltip={editingField === 'keywords' ? 'Finish editing' : 'Edit keywords'} onClick={() => setEditingField(editingField === 'keywords' ? '' : 'keywords')} />}</header><div className="editor-keyword-list" hidden={editingField !== 'keywords'}>{content.strategy?.keywords?.map((keyword, index) => <label key={index}><span>Keyword {index + 1}</span><input disabled={disabled} maxLength={100} value={keyword} onChange={event => update(['strategy', 'keywords', index], event.target.value)} /></label>)}</div><StudioKeywordUsage key={platformIndex} content={content} platform={content.strategy?.platforms?.[platformIndex]?.platform} onCopy={value => void copyText(value)} /></section>

    {(content.strategy?.platforms?.length || 0) > 1 && <div className="studio-select-inline" hidden={section !== 'posts'}><label htmlFor="editing-platform-select">Editing platform</label><div className="studio-custom-select-wrapper"><select id="editing-platform-select" aria-label="Editing platform" value={platformIndex} onChange={event => { const index = Number(event.target.value); setPlatformIndex(index); onPlatformChange?.(content.strategy?.platforms?.[index]?.platform || '') }} className="studio-custom-select">{content.strategy?.platforms?.map((platform, index) => <option key={platform.platform} value={index}>{platform.platform}</option>)}</select><ChevronDown size={14} className="studio-select-chevron" aria-hidden="true" /></div></div>}
    {content.strategy?.platforms?.map((platform, index) => <section hidden={section !== 'posts' || index !== platformIndex} className="editor-block editor-block--caption" key={platform.platform}><h3>{platform.platform} post text</h3><p>The publisher sends this post body plus its cited source links. Other openings, headlines and tags are not added automatically.</p>{field('Post body', platform.body, ['strategy', 'platforms', index, 'body'])}<details className="studio-options editor-alternative-copy"><summary>Headline, opening &amp; call-to-action options</summary><p>Use these in your design, or include relevant wording in the post body. They are separate from the text sent to publishing.</p>{Object.entries(platformFields).filter(([key]) => ['headline', 'hook', 'cta'].includes(key)).map(([key, label]) => <div key={key}>{field(label, platform[key as keyof typeof platformFields], ['strategy', 'platforms', index, key])}</div>)}</details></section>)}

    {content.strategy && <details className="composer-creative-brief" open><summary>Creative brief &amp; strategy <span>Audience, design and testing notes</span></summary><p>Use this to plan your message, brief a designer, or compare two versions. These notes are not the text you publish.</p><div className="desk-guidance-nav" aria-label="Team brief sections">{[{ id: 'notes', label: 'Audience & message' }, ...(content.strategy.platforms?.length ? [{ id: 'post-plan', label: 'Design & posting brief' }] : []), ...(content.strategy.experiments?.length ? [{ id: 'experiments', label: 'Compare versions' }] : [])].map(entry => <button type="button" key={entry.id} aria-pressed={briefSection === entry.id} onClick={() => { setBriefSection(entry.id); setEditingField(''); setSourceField('') }}>{entry.label}</button>)}</div>
    {content.strategy && <section hidden={briefSection !== 'notes'} className="editor-block editor-block--notes"><h3>Planning notes <span>For your team, not the post</span></h3>{[{ title: 'Audience & key message', keys: ['audience', 'angle'] }, { title: 'Why this matters now', keys: ['whyNow'] }, { title: 'Fact-check notes', keys: ['factCheck'] }, { title: 'Delivery, language & voice', keys: ['delivery', 'languageReason', 'voiceReason'] }].map((group, index) => <details className="editor-brief-group" key={group.title} open={index === 0}><summary>{group.title}</summary>{group.keys.map(value => { const key = value as keyof typeof strategyFields; return field(strategyFields[key], content.strategy![key], ['strategy', key]) })}</details>)}</section>}
    {(content.strategy.platforms?.length || 0) > 1 && <div className="studio-select-inline" hidden={briefSection !== 'post-plan'}><label htmlFor="planning-platform-select">Platform to plan</label><div className="studio-custom-select-wrapper"><select id="planning-platform-select" aria-label="Planning platform" value={platformIndex} onChange={event => setPlatformIndex(Number(event.target.value))} className="studio-custom-select">{content.strategy.platforms?.map((platform, index) => <option key={platform.platform} value={index}>{platform.platform}</option>)}</select><ChevronDown size={14} className="studio-select-chevron" aria-hidden="true" /></div></div>}
    {content.strategy.platforms?.map((platform, index) => <section hidden={briefSection !== 'post-plan' || index !== platformIndex} className="editor-block editor-block--caption" key={platform.platform}><h3>Design & posting instructions</h3><p>Share the thumbnail brief with your designer. Use the format and opening-line ideas when preparing your {platform.platform} post.</p>{Object.entries(platformFields).filter(([key]) => !['headline', 'hook', 'body', 'cta'].includes(key)).map(([key, label]) => field(label, platform[key as keyof typeof platformFields], ['strategy', 'platforms', index, key]))}</section>)}
    {content.strategy?.experiments?.map((experiment, index) => <section hidden={briefSection !== 'experiments'} className="studio-readable-section" key={index}><h3>Editorial test {index + 1}</h3>{Object.entries(experimentFields).map(([key, label]) => field(`Test ${index + 1} ${label}`, experiment[key as keyof typeof experimentFields], ['strategy', 'experiments', index, key]))}</section>)}
    </details>}
    {copyNotice && <p className="composer-copy-notice" role="status">{copyNotice}</p>}
  </div>
}
