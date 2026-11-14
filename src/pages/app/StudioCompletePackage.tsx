import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ClipboardList, Copy, Download, RefreshCw } from 'lucide-react'
import { analyzeCompletePackage, recoverCompleteAnalysis, auditWebsiteSeo, externalPromptMarkdown, packagePlatforms, readCompletePackage, readPackageDownload, readPackageMetricsConfig, savePackageContext, syncPackageMetrics, type CompletePackage, type MetricObservation, type PackageContext, type PackageMetricsConfig, type PackagePlatform, type PackagePrompt, type PackageValue } from '@/services/complete-package'
import '@/styles/complete-package.css'
import { StudioStrategyWorkflow } from './StudioStrategyWorkflow'
import { StudioSeoWorkflow } from './StudioSeoWorkflow'

const views = [
  { id: 'brief', label: 'Brief & research', sections: ['identity', 'setup', 'sources', 'market', 'plan', 'brief', 'website'] },
  { id: 'workflow', label: 'Strategy workflow', sections: ['workflow'] },
  { id: 'seo', label: 'Website SEO', sections: ['websiteSeo'] },
  { id: 'content', label: 'Platform content', sections: ['platforms'] },
  { id: 'decisions', label: 'AI decisions', sections: ['decisions'] },
  { id: 'prompts', label: 'External prompts', sections: ['prompts'] },
  { id: 'team', label: 'Team & assets', sections: ['production'] },
  { id: 'rules', label: 'Rules & checks', sections: ['quality'] },
  { id: 'posting', label: 'Posting', sections: ['posting'] },
  { id: 'results', label: 'Results', sections: ['performance'] },
  { id: 'downloads', label: 'Downloads & history', sections: ['downloads', 'portal'] },
] as const
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The package could not be loaded. Try again.'
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./, first => first.toUpperCase())
const iso = (value: string) => new Date(value).toISOString()
const reviewConfirmations = { rightsConfirmed: 'Rights to use the supplied assets confirmed', peopleConsentConfirmed: 'Required consent for identifiable people confirmed', syntheticDisclosureReviewed: 'Synthetic-media disclosure requirements reviewed', audienceSettingsReviewed: 'Audience settings reviewed', brandReviewed: 'Brand requirements reviewed', factualClaimsReviewed: 'Factual claims and their sources reviewed', accessibilityReviewed: 'Accessibility reviewed', commercialDisclosureReviewed: 'Commercial disclosure requirements reviewed', privacyReviewed: 'Privacy reviewed', noManipulativeAutomation: 'No manipulative or deceptive engagement automation', accountConnectionVerified: 'Account connection checked', connectorFormatVerified: 'Connector support for this format checked' }
const contentDeclarations = { containsIdentifiablePeople: 'Contains identifiable people', containsRealisticSyntheticMedia: 'Contains realistic synthetic media', containsCommercialPromotion: 'Contains commercial promotion' }
const accountReviewKeys = new Set(['accountConnectionVerified', 'connectorFormatVerified', 'audienceSettingsReviewed', 'noManipulativeAutomation'])
function saveFile(filename: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}

export function StudioCompletePackage({ packageId, revision, disabled = false, lockReason = '', onDirtyChange, initialView = 'brief', requestedView }: { packageId: string; revision: number; disabled?: boolean; lockReason?: string; onDirtyChange?: (dirty: boolean) => void; initialView?: 'brief' | 'workflow'; requestedView?: string }) {
  const [data, setData] = useState<CompletePackage | null>(null)
  const [draft, setDraft] = useState<PackageContext>({})
  const [contextDirty, setContextDirty] = useState(false)
  const [localView, setView] = useState<string>(initialView)
  const view = views.some(entry => entry.id === requestedView) ? requestedView! : localView
  const [platform, setPlatform] = useState<string>('Instagram')
  const [kind, setKind] = useState('all')
  const [busy, setBusy] = useState('Loading package')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [acknowledgeUnknownAnalysis, setAcknowledgeUnknownAnalysis] = useState(false)
  const [metricsConfig, setMetricsConfig] = useState<PackageMetricsConfig | null>(null)
  const [metricsConfigError, setMetricsConfigError] = useState('')
  const [metricPublication, setMetricPublication] = useState('')
  const [metricDays, setMetricDays] = useState(7)
  const analysisRequest = useRef('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { onDirtyChange?.(contextDirty) }, [contextDirty, onDirtyChange])
  useEffect(() => {
    if (!contextDirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const guardLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      if (anchor.getAttribute('href')?.startsWith('#')) return
      event.preventDefault(); event.stopPropagation()
      setError('Save or discard your unsaved package context before leaving this page.')
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', guardLink, true)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guardLink, true) }
  }, [contextDirty])
  useEffect(() => {
    let active = true
    readCompletePackage(packageId).then(next => { if (active) { setData(next); setDraft(next.context || {}); setContextDirty(false); setPlatform(next.platforms.find(entry => entry.selected)?.platform || 'Instagram'); analysisRequest.current = ['running', 'reserved', 'dispatch_unknown'].includes(next.analysis?.status || '') ? next.analysis?.requestId || '' : '' } }).catch(cause => { if (active) setError(errorText(cause)) }).finally(() => { if (active) setBusy('') })
    return () => { active = false }
  }, [packageId, revision])
  useEffect(() => {
    if (!['running', 'reserved'].includes(data?.analysis?.status || '')) return
    let active = true; let pending = false
    const timer = window.setInterval(() => { if (pending) return; pending = true; readCompletePackage(packageId).then(next => { if (active) setData(next) }).catch(cause => { if (active) setError(errorText(cause)) }).finally(() => { pending = false }) }, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [packageId, data?.analysis?.status])
  useEffect(() => {
    if (view !== 'results') return
    let active = true
    readPackageMetricsConfig(packageId).then(next => { if (active) { setMetricsConfig(next); setMetricsConfigError('') } }).catch(cause => { if (active) setMetricsConfigError(errorText(cause)) })
    return () => { active = false }
  }, [packageId, view])
  async function action(message: string, run: () => Promise<void>) {
    if (disabled || busy) return
    setBusy(message); setError(''); setNotice('')
    try { await run() } catch (cause) { if (mounted.current) setError(errorText(cause)) } finally { if (mounted.current) setBusy('') }
  }
  const updateContext = (next: PackageContext) => { setDraft(next); setContextDirty(true); setNotice('') }
  async function saveContext() {
    if (!data) return
    await action(draft.autoAnalyze !== false ? 'Saving context and preparing AI decisions' : 'Saving package context', async () => { const next = await savePackageContext(packageId, data.contextRevision, { ...draft, autoAnalyze: draft.autoAnalyze ?? true }); if (!mounted.current) return; setData(next); setDraft(next.context); setContextDirty(false); analysisRequest.current = ''; setNotice('Context saved. Automatic analysis follows the saved free-only preference and available provider access.') })
  }
  async function analyze() {
    if (!data || contextDirty || !data.contentHash || ['running', 'reserved', 'dispatch_unknown'].includes(data.analysis?.status || '')) return
    await action('Analyzing saved package', async () => {
      analysisRequest.current ||= crypto.randomUUID()
      try {
        const next = await analyzeCompletePackage(packageId, analysisRequest.current, data.contentHash, data.contextRevision)
        if (!mounted.current) return
        setData(next)
        if (!['running', 'reserved', 'dispatch_unknown'].includes(next.analysis?.status || '')) analysisRequest.current = ''
        setNotice('Analysis request saved. Evidence, capability and budget checks still apply.')
      } catch (cause) {
        try { const next = await readCompletePackage(packageId); if (mounted.current) setData(next) } catch { /* Preserve the original operation error and stable request ID. */ }
        throw cause
      }
    })
  }
  async function recoverAnalysis(acknowledgeUnknownOutcome = false) {
    if (!data?.analysis?.requestId || contextDirty || data.analysis.status !== 'dispatch_unknown') return
    await action('Checking the previous analysis', async () => {
      const next = await recoverCompleteAnalysis(packageId, data.analysis!.requestId!, data.contentHash, data.contextRevision, acknowledgeUnknownOutcome)
      if (!mounted.current) return
      setData(next); analysisRequest.current = ''; setAcknowledgeUnknownAnalysis(false)
      setNotice('Previous attempt retained. You can request a new free-only analysis; no AI call was started by recovery.')
    })
  }
  async function checkedDownload(cards: PackagePrompt[] = []) {
    if (!data) throw new Error('Load the current saved package before exporting.')
    const exported = await readPackageDownload(packageId)
    const saved = exported.completePackage
    if (!mounted.current || saved.packageId !== data.packageId || saved.revision !== data.revision || saved.contentHash !== data.contentHash || saved.inputHash !== data.inputHash || saved.contextRevision !== data.contextRevision) throw new Error('The saved package changed. Refresh its current content and context before copying or downloading.')
    if (cards.length && (saved.analysis?.stale || cards.some(card => !saved.prompts.some(current => current.id === card.id && current.status === 'ready' && current.prompt === card.prompt && current.exactText === card.exactText)))) throw new Error('Production requirements or decisions changed. Refresh the package and resolve its prompt checks before using it.')
    return exported
  }
  async function copy(text: string, card: PackagePrompt) {
    if (disabled || busy || contextDirty || !text.trim()) return
    await action('Checking sources before copying', async () => { await checkedDownload([card]); try { await navigator.clipboard.writeText(text); setNotice('Copied after the saved source checks. Check the destination tool and its cost before generating.') } catch { throw new Error('Clipboard access was blocked. The checked prompt remains visible for manual selection.') } })
  }
  async function downloadPrompts(cards: PackagePrompt[]) {
    if (!data || contextDirty || data.analysis?.stale || !cards.length) return
    await action('Checking sources before prompt download', async () => { await checkedDownload(cards); saveFile(`prompts-${packageId}-${platform}.md`, `# External production prompts\n\nPackage: ${data.packageId}\nContent revision: ${data.revision}\nContext revision: ${data.contextRevision}\nContent hash: ${data.contentHash}\n\n${externalPromptMarkdown(cards)}`); setNotice('Ready prompts downloaded after the saved source checks.') })
  }
  if (!data) return <section className="complete-package"><h2>Complete content package</h2>{busy ? <p role="status">Loading saved package information…</p> : <div role="alert"><p>{error || 'Package information is unavailable.'}</p><button type="button" onClick={() => void action('Loading package', async () => { const next = await readCompletePackage(packageId); setData(next); setDraft(next.context || {}) })}>Try loading again</button></div>}</section>
  const locked = disabled || Boolean(busy)
  const selected = data.platforms.find(entry => entry.platform === platform)
  const selectedAccountId = data.context.platformAccounts?.find(entry => entry.platform === platform)?.accountId || data.context.accountId
  const draftAccountId = draft.platformAccounts?.find(entry => entry.platform === platform)?.accountId || selectedAccountId || ''
  const attestationValue = (key: string) => accountReviewKeys.has(key) ? draft.platformAttestations?.find(entry => entry.platform === platform && entry.accountId === draftAccountId)?.attestations[key] : draft.attestations?.[key]
  const setAttestation = (key: string, value: boolean) => {
    if (accountReviewKeys.has(key)) {
      if (!draftAccountId) return
      const prior = draft.platformAttestations?.find(entry => entry.platform === platform && entry.accountId === draftAccountId)
      updateContext({ ...draft, platformAttestations: [...(draft.platformAttestations || []).filter(entry => entry.platform !== platform), { platform: platform as PackagePlatform, accountId: draftAccountId, attestations: { ...prior?.attestations, [key]: value } }] })
    } else updateContext({ ...draft, attestations: { ...draft.attestations, [key]: value } })
  }
  const changeDestination = (value: PackagePlatform, accountId: string) => {
    if (draft.workflow?.destinations.some(entry => entry.platform === value && entry.accountId !== accountId)) { setError(`Remove the current ${value} account strategy in Strategy workflow before changing its destination. Discard unsaved context to restore removed records before saving.`); return }
    if (draft.metrics?.some(entry => entry.platform === value && entry.accountId !== accountId)) { setError(`Remove the previous ${value} account’s performance observations in Results before changing its destination. Other accounts must not inherit these metrics.`); return }
    updateContext({ ...draft, platformAccounts: [...(draft.platformAccounts || []).filter(entry => entry.platform !== value), ...(accountId ? [{ platform: value, accountId }] : [])], platformAttestations: (draft.platformAttestations || []).filter(entry => entry.platform !== value || entry.accountId === accountId) })
    setError('')
  }
  const selectedPrompts = data.prompts.filter(card => card.platform === platform && (kind === 'all' || card.kind === kind))
  const readyPrompts = selectedPrompts.filter(card => card.status === 'ready' && card.prompt?.trim())
  const promptsLocked = locked || contextDirty || Boolean(data.analysis?.stale)
  const selectedDecisions = data.decisions.filter(decision => decision.platform === platform || decision.platform === 'all' || decision.platform === 'shared')
  const currentView = views.find(entry => entry.id === view) || views[0]
  return <section className="complete-package" aria-label="Complete content package">
    <header className="complete-package-heading"><div><h2>{requestedView ? currentView.label : 'Complete content package'}</h2><p>{requestedView ? 'Workspace tools use the same saved draft. Choose another task from More options.' : 'Brief, decisions, prompts and delivery records for the same saved content.'}</p><span>Content revision {data.revision} · Context revision {data.contextRevision}</span></div><button type="button" disabled={locked || contextDirty} onClick={() => void action('Refreshing saved package', async () => { setData(await readCompletePackage(packageId)); setNotice('Saved package information refreshed. No AI call was started.') })}><RefreshCw size={17} aria-hidden="true" />Refresh saved data</button></header>
    {lockReason && <p role="status" className="complete-package-warning">{lockReason}</p>}
    {error && <p role="alert" className="complete-package-error">{error}</p>}{notice && <p role="status" className="complete-package-notice">{notice}</p>}{busy && <p role="status">{busy}…</p>}
    {contextDirty && <div className="complete-package-context-actions" role="group" aria-label="Unsaved package context"><p>Package context has unsaved changes.</p><button type="button" disabled={locked} onClick={() => void saveContext()}>Save all context changes</button><button type="button" disabled={locked} onClick={() => { setDraft(data.context || {}); setContextDirty(false); setError(''); setNotice('Unsaved context changes discarded. Saved records are unchanged.') }}>Discard unsaved context</button></div>}
    {(!requestedView || ['workflow', 'content', 'decisions', 'prompts', 'team', 'rules', 'posting', 'results'].includes(view)) && <><div className="complete-package-platforms" role="group" aria-label="Package platform">{packagePlatforms.map(value => <button type="button" key={value} aria-pressed={platform === value} onClick={() => { setPlatform(value); setKind('all') }}>{value}</button>)}</div>
    <p className="complete-package-platform-status"><strong>{platform} · {label(selected?.status || 'unavailable')}</strong>{selected?.reason && <span>{selected.reason}</span>}</p>
    {selectedAccountId ? <details className="complete-package-account"><summary>{platform} account direction</summary><DataView value={(data.accounts || []).find(account => account.accountId === selectedAccountId && account.platform === platform) as unknown as PackageValue} /></details> : <p className="studio-muted">{platform} is in unconnected planning mode until its destination is selected in package context.</p>}</>}
    <div className="complete-package-layout" data-embedded={Boolean(requestedView)}>{!requestedView && <nav className="complete-package-navigation" aria-label="Complete package sections">{views.map(entry => <button type="button" key={entry.id} aria-pressed={view === entry.id} onClick={() => setView(entry.id)}>{entry.label}</button>)}</nav>}<div className="complete-package-body">
      {!requestedView && <h3>{currentView.label}</h3>}
      {view === 'brief' && <>
        {requestedView ? <details className="complete-package-edit"><summary>Saved research &amp; package records</summary><SectionRows data={data} ids={currentView.sections} /></details> : <SectionRows data={data} ids={currentView.sections} />}
        {data.sections.some(section => section.id === 'website' && section.status !== 'not_applicable') && <details className="complete-package-edit"><summary>Website metadata & internal links</summary><p>Supplied metadata and links are unverified planning inputs. Saving here does not publish a website page or verify its canonical URL, SEO or accessibility.</p><WebsiteContextForm value={draft.website || {}} disabled={locked} onChange={website => updateContext({ ...draft, website })} /><SaveContextButton dirty={contextDirty} disabled={locked} save={saveContext} /></details>}
        <details className="complete-package-edit" open={requestedView ? true : undefined}><summary>Content goal, brand &amp; accounts</summary><p>These facts guide analysis. An estimated budget here does not authorize paid generation.</p><form onSubmit={event => { event.preventDefault(); void saveContext() }}><fieldset disabled={locked}><div className="complete-package-fields">
          <label>Content objective<textarea maxLength={1000} value={draft.objective || ''} onChange={event => updateContext({ ...draft, objective: event.target.value })} /></label><label>Brand direction<textarea maxLength={2000} value={draft.brand || ''} onChange={event => updateContext({ ...draft, brand: event.target.value })} /></label>
          <label>Country / audience geography<input maxLength={100} value={draft.country || ''} onChange={event => updateContext({ ...draft, country: event.target.value })} /></label><label>Preferred format<input maxLength={50} value={draft.format || ''} onChange={event => updateContext({ ...draft, format: event.target.value })} /></label>
          <label>Timezone<input maxLength={100} placeholder="Asia/Kolkata" value={draft.timezone || ''} onChange={event => updateContext({ ...draft, timezone: event.target.value })} /></label><label>Target date<input type="date" value={draft.targetDate || ''} onChange={event => updateContext({ ...draft, targetDate: event.target.value })} /></label>
          <label>Production budget estimate (USD)<input type="number" min={0} max={10000} step="0.01" value={draft.budgetUsd ?? ''} onChange={event => updateContext({ ...draft, budgetUsd: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label>Rights and permission notes<textarea maxLength={2000} value={draft.rightsNote || ''} onChange={event => updateContext({ ...draft, rightsNote: event.target.value })} /></label>
        </div><label className="complete-package-check"><input type="checkbox" checked={draft.autoAnalyze ?? true} onChange={event => updateContext({ ...draft, autoAnalyze: event.target.checked })} /><span>Analyze parameters automatically after content generation or context changes, using the available free-only allowance. Provider access and budget checks still apply.</span></label><h4>Platform destinations</h4><p>Choose each account separately. Its saved audience, voice and direction remain account-specific.</p><div className="complete-package-fields">{packagePlatforms.map(value => <label key={value}>{value} destination<select value={draft.platformAccounts?.find(entry => entry.platform === value)?.accountId || ''} onChange={event => changeDestination(value, event.target.value)}><option value="">Unconnected planning · no destination selected</option>{(data.accounts || []).filter(account => account.platform === value).map(account => <option key={account.accountId} value={account.accountId}>{account.name || account.accountId}</option>)}</select></label>)}</div>{!(data.accounts || []).length && <p>No authorized account profiles are available. Planning here does not establish a publishing connection.</p>}<button type="submit" disabled={!contextDirty}>Save context</button></fieldset></form></details>
        <details className="complete-package-edit"><summary>Market examples</summary><p>Save what was actually observed. Visible performance is not proof of conversions.</p><DraftRecords entries={(draft.marketObservations || []) as unknown as PackageValue[]} name="market example" disabled={locked} remove={index => updateContext({ ...draft, marketObservations: (draft.marketObservations || []).filter((_entry, i) => i !== index) })} /><MarketForm disabled={locked} onAdd={entry => updateContext({ ...draft, marketObservations: [...draft.marketObservations || [], entry] })} /><SaveContextButton dirty={contextDirty} disabled={locked} save={saveContext} /></details>
      </>}
      {view === 'workflow' && <StudioStrategyWorkflow context={draft} platform={platform as PackagePlatform} accountId={draftAccountId} contentHash={data.contentHash} report={data.workflow} trendIntakes={data.trendIntakes} disabled={locked} onChange={updateContext} />}
      {view === 'seo' && <StudioSeoWorkflow context={draft} contentHash={data.contentHash} report={data.seoWorkflow} disabled={locked} dirty={contextDirty} onChange={updateContext} onAudit={pageUrl => { if (!locked && !contextDirty) void action('Inspecting saved public page', async () => { const next = await auditWebsiteSeo(packageId, data.contextRevision, pageUrl); if (!mounted.current) return; setData(next); setNotice('Page inspection saved. Publication and search indexing were not changed.') }) }} />}
      {view === 'content' && <>{selected ? <DataView value={selected.content} /> : <p>No saved adaptation for this platform.</p>}<p className="studio-muted">Edit public copy in Content. Switching this platform view starts no generation.</p></>}
      {view === 'decisions' && <>
        <p>AI recommendations are separate from measured results. Missing evidence and metrics remain visible.</p><SectionRows data={data} ids={['decisions']} />
        <div className="complete-package-analysis"><strong>{label(data.analysis?.status || 'not generated')}{data.analysis?.stale ? ' · Needs updating' : ''}</strong>{data.analysis?.generatedAt && <p>Generated {new Date(data.analysis.generatedAt).toLocaleString()} · {data.analysis.model || 'Model not recorded'}</p>}{data.analysis?.error && <p role="alert">{data.analysis.error}</p>}<button type="button" disabled={locked || contextDirty || !data.contentHash || ['running', 'reserved', 'dispatch_unknown'].includes(data.analysis?.status || '')} onClick={() => void analyze()}>Analyze saved package with AI</button><p>Uses the existing free-only allowance. No paid fallback or publishing is started.</p>{contextDirty && <p role="status">Save context changes before analysis.</p>}{data.analysis?.status === 'dispatch_unknown' && <div className="complete-package-warning"><p>No usable analysis was received. Check the previous attempt before requesting another.</p><button type="button" disabled={locked || contextDirty || !data.analysis.requestId} onClick={() => void recoverAnalysis()}>Check previous analysis</button><label className="complete-package-check"><input type="checkbox" checked={acknowledgeUnknownAnalysis} disabled={locked || contextDirty} onChange={event => setAcknowledgeUnknownAnalysis(event.target.checked)} />Keep the previous attempt and any held cost on record.</label><button type="button" disabled={locked || contextDirty || !data.analysis.requestId || !acknowledgeUnknownAnalysis} onClick={() => void recoverAnalysis(true)}>Prepare a new free-only attempt</button><p>Preparing does not call AI or release the previous cost. A new analysis still needs free-only admission.</p></div>}</div>
        {!selectedDecisions.length ? <p>No saved AI decisions for {platform}.</p> : selectedDecisions.map((decision, index) => <article className="complete-package-record" key={decision.id || `${decision.parameter}:${index}`}><h4>{label(decision.parameter)}</h4><DataView value={decision.value} /><p>{decision.rationale}</p><dl><dt>Basis</dt><dd>{label(decision.method)}</dd><dt>Confidence</dt><dd>{label(decision.confidence)}</dd><dt>Evidence</dt><dd>{decision.evidenceIds.join(', ') || 'Unavailable'}</dd><dt>Metric records</dt><dd>{decision.metricIds.join(', ') || 'Unavailable'}</dd></dl>{decision.missing.length > 0 && <p className="complete-package-warning">Missing: {decision.missing.join('; ')}</p>}{decision.alternatives.length > 0 && <details><summary>Alternatives considered</summary><DataView value={decision.alternatives} /></details>}</article>)}
      </>}
      {view === 'prompts' && <>
        <p>Ready-to-copy creative instructions for external tools. Copying does not generate or purchase media.</p><label className="complete-package-filter">Prompt type<select value={kind} onChange={event => setKind(event.target.value)}><option value="all">All prompt types</option>{[...new Set(data.prompts.filter(card => card.platform === platform).map(card => card.kind))].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
        <button type="button" disabled={promptsLocked || !readyPrompts.length} onClick={() => { if (!promptsLocked) void downloadPrompts(readyPrompts) }}><Download size={17} aria-hidden="true" />Download ready {platform} prompts</button>
        {(!readyPrompts.length || promptsLocked) && <p role="status">Save current inputs and resolve missing production requirements before copying or downloading ready prompts. The complete JSON retains all prompt statuses.</p>}
        {!selectedPrompts.length && <p>No saved external prompts for this platform. Check its selected outputs and the AI decisions.</p>}{selectedPrompts.map(card => <PromptCard key={card.id} card={card} locked={promptsLocked} revision={data.revision} copy={copy} />)}
      </>}
      {view === 'team' && <>
        <SectionRows data={data} ids={['production']} />
        <details className="complete-package-edit"><summary>Production tools & reference assets</summary><p>Name the tools your team will use. This does not connect them, authorize spending or prove their capabilities.</p>
          <fieldset disabled={locked}><div className="complete-package-fields">{(['graphics', 'video', 'voice', 'music', 'editor'] as const).map(key => <label key={key}>{label(key)} tool<input maxLength={200} value={draft.productionTools?.[key] || ''} onChange={event => updateContext({ ...draft, productionTools: { ...draft.productionTools, [key]: event.target.value } })} /></label>)}</div></fieldset>
          <h4>Reference assets</h4><DraftRecords entries={(draft.assetReferences || []) as unknown as PackageValue[]} name="reference asset" disabled={locked} remove={index => updateContext({ ...draft, assetReferences: (draft.assetReferences || []).filter((_entry, i) => i !== index) })} />
          <AssetForm disabled={locked} onAdd={entry => updateContext({ ...draft, assetReferences: [...draft.assetReferences || [], entry] })} /><SaveContextButton dirty={contextDirty} disabled={locked} save={saveContext} />
        </details>
        <h4>Team tasks</h4><DataView value={data.tasks} />
        <details className="complete-package-edit"><summary>Manage team tasks</summary>{(draft.teamTasks || []).map((task, index) => <div className="complete-package-task-edit" key={task.id}><strong>{task.team}: {task.task}</strong><label>Task status<select disabled={locked} value={task.status} onChange={event => updateContext({ ...draft, teamTasks: (draft.teamTasks || []).map((entry, i) => i === index ? { ...entry, status: event.target.value as typeof entry.status } : entry) })}>{['waiting', 'working', 'checking', 'ready', 'blocked'].map(value => <option key={value}>{value}</option>)}</select></label><button type="button" disabled={locked} onClick={() => updateContext({ ...draft, teamTasks: (draft.teamTasks || []).filter((_entry, i) => i !== index) })}>Remove task {index + 1}</button></div>)}<TaskForm disabled={locked} onAdd={entry => updateContext({ ...draft, teamTasks: [...draft.teamTasks || [], entry] })} /><SaveContextButton dirty={contextDirty} disabled={locked} save={saveContext} /></details>
        <h4>Asset register</h4><DataView value={data.assets} />
      </>}
      {view === 'rules' && <>
        <SectionRows data={data} ids={['quality']} platform={platform} /><DataView value={scopeValue(data.rules, platform)} />
        <details className="complete-package-edit"><summary>Record workspace reviews & disclosures</summary><p>Record only checks actually completed. These are workspace confirmations, not independent verification or legal certification.</p>
          <p>Account-specific reviews apply only to {platform} · {draftAccountId || 'no destination selected'}. Choose a destination in Brief & research before recording those checks.</p>
          <fieldset disabled={locked}><div className="complete-package-fields">{Object.entries(contentDeclarations).map(([key, title]) => <label key={key}>{title}<select value={draft.attestations?.[key] === undefined ? '' : String(draft.attestations[key])} onChange={event => { const attestations = { ...draft.attestations }; if (event.target.value === '') delete attestations[key]; else attestations[key] = event.target.value === 'true'; updateContext({ ...draft, attestations }) }}><option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option></select></label>)}</div>
            {Object.entries(reviewConfirmations).map(([key, title]) => <label className="complete-package-check" key={key}><input type="checkbox" disabled={accountReviewKeys.has(key) && !draftAccountId} checked={attestationValue(key) === true} onChange={event => setAttestation(key, event.target.checked)} /><span>{title}{accountReviewKeys.has(key) ? ` · ${platform} destination only` : ' · shared content review'}</span></label>)}
          </fieldset><SaveContextButton dirty={contextDirty} disabled={locked} save={saveContext} />
        </details><p className="studio-muted">A completed checklist is not legal advice or proof of platform approval. Missing permissions and unsupported capabilities remain blocking where required.</p>
      </>}
      {view === 'posting' && <><SectionRows data={data} ids={['posting']} platform={platform} accountId={selectedAccountId} /><h4>Publication receipts</h4><DataView value={scopeValue(data.publications, platform, selectedAccountId)} /><p className="studio-muted">Use Account plans & publishing for release actions. A plan or submitted receipt is not proof of a published post.</p></>}
      {view === 'results' && <>
        <SectionRows data={data} ids={['performance']} platform={platform} accountId={selectedAccountId} /><h4>Recorded observations and comparisons</h4><DataView value={scopeValue(data.analytics, platform, selectedAccountId)} />
        <details className="complete-package-edit"><summary>Sync published post analytics</summary><p>Fetch available dated results from the publishing provider. A provider snapshot is not automatically converted into a comparable rate.</p>
          {metricsConfigError && <p role="status">Provider analytics configuration is unavailable: {metricsConfigError}</p>}
          {!metricsConfigError && !metricsConfig && <p role="status">Checking analytics access…</p>}
          {metricsConfig && <><p>{metricsConfig.configured ? 'Publishing analytics connection configured. Each provider may return different metrics.' : metricsConfig.reason || 'The publishing analytics connection is not configured.'}</p><div className="complete-package-fields"><label>Published post<select value={metricPublication} onChange={event => setMetricPublication(event.target.value)}><option value="">Choose a published {platform} post</option>{metricsConfig.eligiblePublications.filter(entry => entry.platform === platform && (!selectedAccountId || entry.accountId === selectedAccountId)).map(entry => <option value={entry.id} key={entry.id}>{entry.providerPostId || entry.id} · {entry.accountId}</option>)}</select></label><label>Reporting window<select value={metricDays} onChange={event => setMetricDays(Number(event.target.value))}>{[7, 30, 90].map(days => <option key={days} value={days}>{days} days</option>)}</select></label></div>
            <button type="button" disabled={locked || contextDirty || !metricsConfig.configured || !metricsConfig.eligiblePublications.some(entry => entry.id === metricPublication && entry.platform === platform && (!selectedAccountId || entry.accountId === selectedAccountId))} onClick={() => void action('Syncing published post analytics', async () => { await syncPackageMetrics(packageId, metricPublication, metricDays); const next = await readCompletePackage(packageId); if (!mounted.current) return; setData(next); setNotice('Provider analytics snapshot saved with its collection time and limitations.') })}>Sync post analytics</button>
            {!metricsConfig.eligiblePublications.some(entry => entry.platform === platform && (!selectedAccountId || entry.accountId === selectedAccountId)) && <p>No eligible published {platform} receipt is available for this package and destination.</p>}
          </>}
        </details>
        <details className="complete-package-edit"><summary>Add or correct performance observations</summary><p>Record the exact account, time window and metric source. Blank values remain unknown, not zero. Remove an incorrect entry and add its corrected replacement before saving.</p><DraftRecords entries={(draft.metrics || []).filter(entry => entry.platform === platform) as unknown as PackageValue[]} name="performance observation" disabled={locked} remove={index => { const entry = (draft.metrics || []).filter(item => item.platform === platform)[index]; updateContext({ ...draft, metrics: (draft.metrics || []).filter(item => item.observationId !== entry?.observationId) }) }} /><MetricForm key={platform} platform={platform as PackagePlatform} accountId={draft.platformAccounts?.find(entry => entry.platform === platform)?.accountId || selectedAccountId || ''} accounts={(data.accounts || []).filter(entry => entry.platform === platform)} disabled={locked} onAdd={entry => updateContext({ ...draft, metrics: [...draft.metrics || [], entry] })} /><SaveContextButton dirty={contextDirty} disabled={locked} save={saveContext} /></details>
      </>}
      {view === 'downloads' && <><SectionRows data={data} ids={['downloads', 'portal']} /><button type="button" disabled={locked || contextDirty} onClick={() => void action('Preparing complete package download', async () => { const exported = await checkedDownload(); saveFile(`complete-package-${packageId}.json`, JSON.stringify(exported, null, 2), 'application/json'); setNotice('Complete package downloaded with its version and source records.') })}><Download size={17} aria-hidden="true" />Download complete package (JSON)</button><p>Downloads follow the saved package’s access and source checks. Publishing remains separate.</p></>}
      {contextDirty && <div className="complete-package-actions"><SaveContextButton dirty={contextDirty} disabled={locked} save={saveContext} /><span>All context changes save together using the current revision.</span></div>}
    </div></div>
    <details className="complete-package-coverage"><summary><ClipboardList size={17} aria-hidden="true" />Full package coverage</summary><ul>{data.sections.map(section => <li key={section.id}><strong>{section.title}</strong><span>{label(section.status)}</span>{section.reason && <p>{section.reason}</p>}</li>)}</ul></details>
  </section>
}

function SectionRows({ data, ids, platform, accountId }: { data: CompletePackage; ids: readonly string[]; platform?: string; accountId?: string }) {
  return <div className="complete-package-sections">{data.sections.filter(section => ids.includes(section.id)).map(section => <details key={section.id}><summary><strong>{section.title}</strong><span>{label(section.status)}</span></summary>{section.reason && <p className="studio-muted">{section.reason}</p>}<DataView value={platform ? scopeValue(section.value, platform, accountId) : section.value} /></details>)}</div>
}
function scopeValue(value: PackageValue, platform: string, accountId?: string): PackageValue {
  if (Array.isArray(value)) return value.filter(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) || ((!entry.platform || entry.platform === platform) && (!accountId || !entry.accountId || entry.accountId === accountId))).map(entry => scopeValue(entry, platform, accountId))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scopeValue(entry, platform, accountId)]))
  return value
}
function DraftRecords({ entries, name, disabled, remove }: { entries: PackageValue[]; name: string; disabled: boolean; remove: (index: number) => void }) {
  return entries.length ? <div>{entries.map((entry, index) => <details className="complete-package-draft-record" key={index}><summary>{label(name)} {index + 1}</summary><DataView value={entry} /><button type="button" disabled={disabled} onClick={() => remove(index)}>Remove {name} {index + 1}</button></details>)}</div> : <p>No {name} records yet.</p>
}
function DataView({ value }: { value: PackageValue | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="complete-package-unknown">Unavailable</span>
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>
  if (typeof value === 'number') return <span>{Number.isFinite(value) ? String(value) : 'Unavailable'}</span>
  if (typeof value === 'string') return /^https:\/\/\S+$/.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <p className="preserve-lines">{value}</p>
  if (Array.isArray(value)) return value.length ? <ul className="complete-package-values">{value.map((entry, index) => <li key={index}><DataView value={entry} /></li>)}</ul> : <p className="complete-package-unknown">No records available.</p>
  return <dl className="complete-package-data">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{label(key)}</dt><dd><DataView value={entry} /></dd></div>)}</dl>
}
function PromptCard({ card, locked, revision, copy }: { card: PackagePrompt; locked: boolean; revision: number; copy: (value: string, card: PackagePrompt) => Promise<void> }) {
  const blocked = locked || card.status !== 'ready' || !card.prompt?.trim()
  return <details className="complete-package-prompt"><summary><strong>{card.title}</strong><span>{label(card.status)}</span></summary><p>{card.tool} · Content revision {revision} · {card.id}</p>{card.reason && <p className="complete-package-warning">{card.reason}</p>}{locked && <p>Save current content and update stale analysis before using this prompt.</p>}{Boolean(card.missing?.length) && <DataView value={card.missing} />}<div className="complete-package-actions"><button type="button" disabled={blocked} onClick={() => { if (!blocked) void copy(card.prompt, card) }}><Copy size={16} aria-hidden="true" />Copy prompt</button>{card.exactText && <button type="button" disabled={blocked} onClick={() => { if (!blocked) void copy(card.exactText, card) }}>Copy exact text / narration</button>}</div><pre tabIndex={0} aria-label={`${card.title} external prompt`}>{card.prompt || 'No usable prompt available.'}</pre>{card.exactText && <section><h4>Exact text / narration</h4><p className="preserve-lines">{card.exactText}</p></section>}<h4>Output settings</h4><DataView value={card.settings} /><h4>What to attach</h4><DataView value={card.attachments} /><h4>Constraints</h4><DataView value={card.constraints} /><h4>Acceptance check</h4><DataView value={card.acceptance} /><details><summary>Decision references & source provenance</summary><DataView value={card.sourceDecisionIds} /><DataView value={card.sources as unknown as PackageValue} /></details></details>
}
function SaveContextButton({ dirty, disabled, save }: { dirty: boolean; disabled: boolean; save: () => Promise<void> }) { return <button type="button" disabled={disabled || !dirty} onClick={() => void save()}>Save package context</button> }
function WebsiteContextForm({ value, disabled, onChange }: { value: NonNullable<PackageContext['website']>; disabled: boolean; onChange: (value: NonNullable<PackageContext['website']>) => void }) {
  return <><fieldset disabled={disabled}><div className="complete-package-fields">{([
    ['slug', 'Page slug', 180], ['seoTitle', 'SEO title', 200], ['metaDescription', 'Meta description', 400], ['canonicalUrl', 'Canonical URL (HTTPS)', 2000], ['heroAlt', 'Hero image alternative text', 500],
  ] as const).map(([key, title, maxLength]) => <label key={key}>{title}<input name={key} autoComplete="off" type={key === 'canonicalUrl' ? 'url' : 'text'} pattern={key === 'canonicalUrl' ? 'https://.*' : key === 'slug' ? '[a-z0-9]+(-[a-z0-9]+)*' : undefined} maxLength={maxLength} value={value[key] || ''} onChange={event => { const next = { ...value }; if (event.target.value) next[key] = event.target.value; else delete next[key]; onChange(next) }} /></label>)}<label>Hero image aspect ratio<select name="heroAspectRatio" value={value.heroAspectRatio || ''} onChange={event => { const next = { ...value }; if (event.target.value) next.heroAspectRatio = event.target.value; else delete next.heroAspectRatio; onChange(next) }}><option value="">Unknown · select a website canvas</option>{['16:9', '9:16', '4:5', '1:1', '3:2', '2:3', '21:9'].map(ratio => <option key={ratio}>{ratio}</option>)}</select></label></div></fieldset><h4>Internal links</h4><DraftRecords entries={(value.internalLinks || []) as unknown as PackageValue[]} name="internal link" disabled={disabled} remove={index => onChange({ ...value, internalLinks: (value.internalLinks || []).filter((_entry, i) => i !== index) })} /><form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); onChange({ ...value, internalLinks: [...value.internalLinks || [], { label: String(values.get('label')), url: String(values.get('url')) }] }); form.reset() }}><fieldset disabled={disabled || (value.internalLinks || []).length >= 20}><label>Internal link label<input name="label" autoComplete="off" maxLength={200} required /></label><label>Internal page URL<input name="url" type="url" autoComplete="off" pattern="https://.*" maxLength={2000} required /></label><button type="submit">Add internal link</button></fieldset></form></>
}
function MarketForm({ disabled, onAdd }: { disabled: boolean; onAdd: (entry: NonNullable<PackageContext['marketObservations']>[number]) => void }) {
  return <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); onAdd({ id: crypto.randomUUID(), url: String(values.get('url')), observedAt: iso(String(values.get('observedAt'))), summary: String(values.get('summary')) }); form.reset() }}><fieldset disabled={disabled}><label>Example URL<input name="url" type="url" pattern="https://.*" required /></label><label>Observed at<input name="observedAt" type="datetime-local" required /></label><label>What was observed<textarea name="summary" maxLength={1500} required /></label><button type="submit">Add market example</button></fieldset></form>
}
function TaskForm({ disabled, onAdd }: { disabled: boolean; onAdd: (entry: NonNullable<PackageContext['teamTasks']>[number]) => void }) {
  return <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); onAdd({ id: crypto.randomUUID(), team: String(values.get('team')), task: String(values.get('task')), expectedDeliverable: String(values.get('expectedDeliverable')), status: String(values.get('status')) as NonNullable<PackageContext['teamTasks']>[number]['status'], assignee: String(values.get('assignee')) || undefined, dueAt: values.get('dueAt') ? iso(String(values.get('dueAt'))) : undefined }); form.reset() }}><fieldset disabled={disabled}><div className="complete-package-fields"><label>Responsible team<input name="team" maxLength={100} required /></label><label>Assignee (optional)<input name="assignee" maxLength={200} /></label><label>Exact task<textarea name="task" maxLength={1000} required /></label><label>Expected deliverable<textarea name="expectedDeliverable" maxLength={1000} required /></label><label>Status<select name="status">{['waiting', 'working', 'checking', 'ready', 'blocked'].map(value => <option key={value}>{value}</option>)}</select></label><label>Due at (optional)<input name="dueAt" type="datetime-local" /></label></div><button type="submit">Add task</button></fieldset></form>
}
function AssetForm({ disabled, onAdd }: { disabled: boolean; onAdd: (entry: NonNullable<PackageContext['assetReferences']>[number]) => void }) {
  return <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); onAdd({ id: crypto.randomUUID(), url: String(values.get('url')), role: String(values.get('role')), rightsNote: String(values.get('rightsNote')) }); form.reset() }}><fieldset disabled={disabled}><label>Reference asset URL<input name="url" type="url" pattern="https://.*" required /></label><label>Asset purpose<input name="role" maxLength={100} required /></label><label>Rights / permission note<textarea name="rightsNote" maxLength={1000} required /></label><button type="submit">Add reference asset</button></fieldset></form>
}
const metricNames = ['reach', 'impressions', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks', 'conversions', 'averageWatchSeconds', 'durationSeconds'] as const
function MetricForm({ platform, accountId, accounts, disabled, onAdd }: { platform: PackagePlatform; accountId: string; accounts: NonNullable<CompletePackage['accounts']>; disabled: boolean; onAdd: (entry: MetricObservation) => void }) {
  const [windowKind, setWindowKind] = useState('lifetime')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const metrics: MetricObservation['metrics'] = {}
    for (const key of metricNames) { const raw = values.get(key); if (typeof raw === 'string' && raw.trim() !== '') metrics[key] = Number(raw) }
    const period = values.get('windowKind') === 'period'
    onAdd({ observationId: crypto.randomUUID(), accountId: String(values.get('accountId')), postId: String(values.get('postId')), platform, format: String(values.get('format')), distribution: String(values.get('distribution')) as 'organic' | 'paid', publishedAt: iso(String(values.get('publishedAt'))), measuredAt: iso(String(values.get('measuredAt'))), windowKind: period ? 'period' : 'lifetime', ...(period ? { periodStart: iso(String(values.get('periodStart'))), periodEnd: iso(String(values.get('periodEnd'))) } : {}), definitionVersion: String(values.get('definitionVersion') || 'reported-v1'), source: { kind: 'manual', label: String(values.get('sourceLabel')), ...(values.get('sourceUrl') ? { url: String(values.get('sourceUrl')) } : {}) }, metrics }); form.reset()
  }
  return <form onSubmit={submit}><fieldset disabled={disabled || !accounts.length}>
    <p>Platform: {platform}. Values are manually reported, not independently verified.</p>
    <div className="complete-package-fields">
      <label>Account<select name="accountId" defaultValue={accountId} required><option value="">Choose an authorized account</option>{accounts.map(entry => <option key={entry.accountId} value={entry.accountId}>{entry.name || entry.accountId}</option>)}</select></label><label>Post ID<input name="postId" maxLength={200} required /></label>
      <label>Format<input name="format" maxLength={50} required /></label><label>Distribution<select name="distribution"><option value="organic">Organic</option><option value="paid">Paid</option></select></label>
      <label>Published at<input name="publishedAt" type="datetime-local" required /></label><label>Measured at<input name="measuredAt" type="datetime-local" required /></label>
      <label>Measurement window<select name="windowKind" value={windowKind} onChange={event => setWindowKind(event.target.value)}><option value="lifetime">Lifetime to measurement date</option><option value="period">Specific period</option></select></label>
      <label>Metric definition version<input name="definitionVersion" maxLength={120} defaultValue="reported-v1" required /></label>
      {windowKind === 'period' && <><label>Period starts<input name="periodStart" type="datetime-local" required /></label><label>Period ends<input name="periodEnd" type="datetime-local" required /></label></>}
      <label>Metric source<input name="sourceLabel" maxLength={200} required /></label><label>Source URL (optional)<input name="sourceUrl" type="url" pattern="https://.*" /></label>
      {metricNames.map(key => <label key={key}>{label(key)}<input name={key} type="number" min={key === 'durationSeconds' ? '0.001' : 0} step={key.endsWith('Seconds') ? '0.001' : 1} /></label>)}
    </div><button type="submit">Add performance observation</button>
  </fieldset>{!accounts.length && <p>No authorized {platform} account is available for performance observations. Add its account profile before recording analytics.</p>}</form>
}
