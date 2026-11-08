import { CategorySetupFields } from './CategorySetupFields'
import { categoryDefaults, type CategorySetup } from '@/services/category-setup'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Sparkles } from 'lucide-react'
import { useAuth } from '@/context/auth-state'
import { studioRequest, type StudioConfig } from '@/services/studio-api'
import '@/styles/studio.css'
import '@/styles/discovery.css'

type Input = CategorySetup & { topic: string; brief: string; audience: string; region: string; referenceUrls: string[] }
type Audit = { id: string; action: 'reuse' | 'new' | 'clarify'; matchedId: string | null; name: string; brief: string; reason: string; requestedTrending: boolean; suggestions?: { id: string; name: string; brief: string }[] }
export function FindIdeaPage() {
  const { identity, loading } = useAuth()
  const navigate = useNavigate()
  const [input, setInput] = useState<Input>({ ...categoryDefaults, topic: '', brief: '', audience: '', region: 'Global', referenceUrls: [] })
  const [showBrief, setShowBrief] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [audit, setAudit] = useState<Audit | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [config, setConfig] = useState<StudioConfig | null>(null)
  const working = useRef(false); const version = useRef(0); const alive = useRef(true)
  const requests = useRef<Record<string, string>>({})
  useEffect(() => {
    alive.current = true
    studioRequest<StudioConfig>('/config', undefined, 'GET', false).then(value => { if (alive.current) setConfig(value) }).catch(() => { /* Saved-library lookup remains available. */ })
    return () => { alive.current = false }
  }, [])
  function edit(patch: Partial<Input>) {
    version.current++; requests.current = {}; setInput(previous => ({ ...previous, ...patch })); setAudit(null); setError(''); setMessage('')
  }
  async function run(label: string, action: (revision: number) => Promise<void>) {
    if (working.current) return
    working.current = true; setBusy(label); setError('')
    const revision = version.current
    try { await action(revision) } catch (cause) { if (alive.current && version.current === revision) setError(cause instanceof Error ? cause.message : 'Please try again.') }
    finally { working.current = false; if (alive.current) setBusy('') }
  }
  const current = (revision: number) => alive.current && version.current === revision
  const cleanInput = () => ({ ...input, topics: input.topics.map(topic => topic.trim()).filter(Boolean), referenceUrls: input.referenceUrls.map(url => url.trim()).filter(Boolean) })
  function requestId(kind: string) { return requests.current[kind] ||= crypto.randomUUID() }
  async function check() {
    if (input.coverage !== 'international' && !input.country.trim()) { setShowSetup(true); setError('Choose a country for national coverage.'); return }
    if (!identity) { setError('Sign in to check your workspace library. Your text stays here.'); return }
    await run('Checking your library…', async revision => {
      const result = await studioRequest<Audit>('/intelligence/ideas/check', { input: cleanInput(), requestId: requestId('check') }, 'POST')
      if (!current(revision)) return
      if (result.action === 'reuse' && result.matchedId) navigate(`/ideas/${encodeURIComponent(result.matchedId)}?reused=1${result.requestedTrending ? '&trending=1' : ''}`)
      else { setAudit(result); if (result.action === 'clarify') setShowBrief(true) }
    })
  }
  async function help() {
    await run('Helping you describe your idea…', async revision => {
      const result = await studioRequest<{ brief: string; topics?: string[]; intent?: string }>('/intelligence/ideas/help', { input: cleanInput(), requestId: requestId('help') }, 'POST')
      if (!current(revision)) return
      edit({ brief: result.brief, topics: result.topics || input.topics, intent: result.intent || input.intent }); setShowBrief(true); setMessage('AI suggested this description. Edit anything before continuing.')
    })
  }
  async function create() {
    if (!audit || audit.action !== 'new') return
    await run('Creating your category…', async revision => {
      let niche: { id: string; revision: number }
      try { niche = await studioRequest<typeof niche>('/intelligence/ideas/create', { auditId: audit.id, confirmed: true }, 'POST') }
      catch (cause) {
        if (current(revision) && (cause as { status?: number })?.status === 409) { delete requests.current.check; setAudit(null) }
        throw cause
      }
      if (!current(revision)) return
      if (config?.capabilities.research) {
        try { await studioRequest('/intelligence/research', { nicheId: niche.id, nicheRevision: niche.revision, requestId: requestId('research'), confirmed: true }, 'POST') }
        catch { if (current(revision)) navigate(`/ideas/${niche.id}?research=not-started`); return }
      }
      if (current(revision)) navigate(`/ideas/${niche.id}`)
    })
  }
  return <section className="studio discovery-page simple-find" aria-busy={Boolean(busy)}>
    <nav className="idea-breadcrumbs" aria-label="Breadcrumb"><Link to="/ideas">Topic Library</Link><span aria-hidden="true">/</span><span>Find new ideas</span></nav>
    <header className="discovery-hero"><h1>Find new ideas</h1><p>Start with a topic. We’ll check for saved ideas before creating anything new.</p></header>
    <div className="simple-find-layout"><form className="studio-panel simple-idea-form" onSubmit={event => { event.preventDefault(); void check() }}>
      <label htmlFor="simple-topic">What topic interests you?<input id="simple-topic" name="topic" required minLength={2} maxLength={100} autoComplete="off" aria-describedby="topic-hint" value={input.topic} onChange={event => edit({ topic: event.target.value })} placeholder="For example, AI tools for teachers…" /></label>
      <p id="topic-hint" className="studio-muted">{input.topic.trim().length === 1 ? 'Use at least 2 characters for your topic.' : 'Any subject works. Use a few words, or choose an example.'}</p>
      <div className="idea-examples" aria-label="Try a topic">{['AI', 'Astrology', 'Vastu', 'News', 'Comedy'].map(topic => <button key={topic} type="button" onClick={() => edit({ topic })}>{topic}</button>)}</div>
      <div className="idea-writing-tools"><button type="button" className="idea-help" disabled={Boolean(busy) || !identity || input.topic.trim().length < 2 || !config?.capabilities.generation} onClick={() => void help()}><Sparkles size={16} aria-hidden="true" /> Help me describe it</button>{!showBrief && <button className="idea-text-button" type="button" onClick={() => setShowBrief(true)}>Write my own description</button>}</div>
      {identity && config?.capabilities.generation && <p className="idea-help-note">{input.topic.trim().length < 2 ? 'Enter a topic to use AI help.' : 'AI help suggests an editable description and uses your AI allowance.'}</p>}
      {!config?.capabilities.generation && <p className="studio-muted">AI help is unavailable. You can write a description yourself and check your saved library.</p>}
      {showBrief && <label>Your description <span className="field-hint">Optional. Add an angle or goal to make the ideas more relevant.</span><textarea value={input.brief} maxLength={4000} onChange={event => edit({ brief: event.target.value })} placeholder="For example, practical AI tools teachers can use in class…" /></label>}
      {message && <p role="status">{message}</p>}
      {error && <p className="studio-alert" role="alert">{error}</p>}
      {busy && <p className="idea-progress" role="status"><span className="library-loading-spinner" aria-hidden="true" />{busy}</p>}
      {audit?.action === 'clarify' && <div role="status" className="idea-decision"><h2>Choose a saved category or refine your topic</h2><p>{/unavailable/i.test(audit.reason) ? 'Automatic matching is unavailable. You can open saved ideas below, or add a description to narrow your topic.' : audit.reason}</p>{Boolean(audit.suggestions?.length) && <div><strong>Related categories</strong>{audit.suggestions?.map(category => <p key={category.id}><Link to={`/ideas/${encodeURIComponent(category.id)}`}>Open {category.name} →</Link></p>)}</div>}<Link to="/ideas">Browse Topic Library</Link></div>}
      {audit?.action === 'new' ? <div className="idea-decision"><h2>Create {audit.name}?</h2><p>{audit.brief}</p><p>{input.coverage === 'national' ? 'National coverage' : input.coverage === 'both' ? 'Local + worldwide' : 'Worldwide'} · {input.country || "All countries"} · {input.autoRefresh ? `Refresh every ${input.refreshIntervalDays} days` : "Manual refresh"}</p>{audit.requestedTrending && <p>Measured trend data is unavailable. We’ll keep this request without presenting ordinary news as verified trends.</p>}<p className="studio-muted">{config?.capabilities.research ? (config.capabilities.vertexFallback ? 'Creates your category and starts research. Free AI is tried first; approved Gemini fallback may use your remaining budget.' : 'Creates your category and starts one free research run. No paid fallback.') : 'New research is unavailable. You can save this category now and research it later.'}</p><button type="button" className="primary-action" disabled={Boolean(busy)} onClick={() => void create()}>{config?.capabilities.research ? 'Create & find ideas' : 'Create category'}<ArrowRight size={17} aria-hidden="true" /></button></div> : <button className="primary-action" disabled={Boolean(busy) || loading || input.topic.trim().length < 2}>Find ideas <ArrowRight size={17} aria-hidden="true" /></button>}
      <div className="idea-settings-block"><div className="idea-scope-summary"><div><strong>Research preferences</strong><p>{input.coverage === 'both' ? 'Local + worldwide' : input.coverage === 'national' ? 'One country' : 'Worldwide'}{input.country ? ` · ${input.country}` : ''} · Last {input.windowDays} days · {input.autoRefresh ? `Refresh every ${input.refreshIntervalDays} days` : 'Manual refresh'}</p></div><button type="button" aria-expanded={showSetup} aria-controls="idea-research-settings" onClick={() => setShowSetup(!showSetup)}>{showSetup ? 'Close preferences' : 'Change preferences'}</button></div><div id="idea-research-settings" hidden={!showSetup}><CategorySetupFields value={input} onChange={edit} disabled={Boolean(busy) || !showSetup} /></div></div>
      <details className="idea-extra-details"><summary>Audience & reference links <span className="studio-muted">Optional</span></summary><label>Who is it for?<input maxLength={300} value={input.audience} onChange={event => edit({ audience: event.target.value })} placeholder="For example, teachers or small-business owners…" /></label><label>Location<input maxLength={100} value={input.region} onChange={event => edit({ region: event.target.value })} /></label><label>Reference links (up to 5)<textarea value={input.referenceUrls.join('\n')} onChange={event => edit({ referenceUrls: event.target.value.split('\n') })} placeholder="One link per line" /></label></details>
      {!identity && <Link to="/login?next=%2F">Sign in to your workspace</Link>}
    </form></div>
  </section>
}

