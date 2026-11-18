import { categoryDefaults, type CategorySetup } from '@/services/category-setup'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Sparkles, Zap, BookOpen, Search, SlidersHorizontal, Globe2, Check, ChevronDown } from 'lucide-react'
import { useAuth } from '@/context/auth-state'
import { studioRequest, type StudioConfig } from '@/services/studio-api'
import '@/styles/studio.css'
import '@/styles/discovery.css'
import '@/styles/idea-discovery.css'

type Input = CategorySetup & { topic: string; brief: string; audience: string; region: string; referenceUrls: string[] }
type Audit = { id: string; action: 'reuse' | 'new' | 'clarify'; matchedId: string | null; name: string; brief: string; reason: string; requestedTrending: boolean; suggestions?: { id: string; name: string; brief: string }[] }
const researchModes = [
  { id: 'latest', title: 'Latest updates', description: 'Recent news and developments.', goal: 'Find timely, source-backed updates and explain what changed and why it matters.', Icon: Zap },
  { id: 'evergreen', title: 'Evergreen angles', description: 'Useful lessons from recent sources.', goal: 'Find practical, lasting lessons and useful how-to angles from the available sources.', Icon: BookOpen },
  { id: 'deep', title: 'Deep-dive explainers', description: 'Context, evidence and the bigger picture.', goal: 'Find evidence-backed explainer ideas that examine the context, implications and limitations in depth.', Icon: Search },
]
const quickTopics = [
  { label: 'AI & Tech', topic: 'AI and technology' }, { label: 'Astrology', topic: 'Astrology' },
  { label: 'Vastu', topic: 'Vastu' }, { label: 'News', topic: 'International news and global events' },
  { label: 'Finance', topic: 'Personal finance' }, { label: 'Entertainment', topic: 'Entertainment and culture' },
]

export function FindIdeaPage() {
  const { identity, loading } = useAuth()
  const navigate = useNavigate()
  const [input, setInput] = useState<Input>({ ...categoryDefaults, intent: researchModes[0].goal, topic: '', brief: '', audience: '', region: 'Global', referenceUrls: [] })
  const [showBrief, setShowBrief] = useState(false)
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
    if (input.coverage !== 'international' && !input.country.trim()) { setError('Choose a country for national coverage.'); return }
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
  const mode = researchModes.find(item => item.goal === input.intent)
  const coverage = input.coverage === 'international' ? 'Worldwide' : input.coverage === 'national' ? input.country || 'Choose a country' : `${input.country || 'Choose a country'} + worldwide`
  const freshness = input.windowDays === 1 ? 'Last 24 hours' : `Last ${input.windowDays} days`
  const canFind = !busy && !loading && input.topic.trim().length >= 2
  return <section className="studio discovery-page idea-discovery" aria-busy={Boolean(busy)}>
    <nav className="idea-breadcrumbs" aria-label="Breadcrumb"><Link to="/ideas">Topic Library</Link><span aria-hidden="true">/</span><span>Discover ideas</span></nav>
    <header className="discovery-hero"><span className="discovery-kicker">Your next content idea starts here</span><h1>What would you like to explore?</h1><p>Choose a topic and shape your research. We’ll check your library first to avoid duplicate categories.</p></header>
    <form className="discovery-form" onSubmit={event => { event.preventDefault(); void check() }}>
      <div className="topic-composer">
        <label htmlFor="simple-topic">Your topic</label>
        <textarea id="simple-topic" name="topic" rows={2} required minLength={2} maxLength={100} autoComplete="off" aria-describedby="topic-hint" value={input.topic} onChange={event => edit({ topic: event.target.value })} placeholder="For example, international news and global events…" />
        <div className="topic-composer-footer"><p id="topic-hint">{input.topic.trim().length < 2 ? 'Enter a topic or choose a quick start below.' : 'A few words are enough. Add a description for a specific angle.'}</p><div className="topic-actions"><button type="button" className="refine-topic" disabled={Boolean(busy) || !identity || input.topic.trim().length < 2 || !config?.capabilities.generation} onClick={() => void help()}><Sparkles size={17} aria-hidden="true" /> Refine topic</button><button className="primary-action" disabled={!canFind}>Find ideas <ArrowRight size={17} aria-hidden="true" /></button></div></div>
      </div>
      <div className="topic-description-tools"><button className="discovery-text-action" type="button" aria-expanded={showBrief} aria-controls="topic-description" onClick={() => setShowBrief(!showBrief)}>{showBrief ? 'Hide description' : 'Add a description'} <span>optional</span></button><p>{config?.capabilities.generation ? 'AI refinement uses your AI allowance. You can edit its suggestion.' : config ? 'AI refinement is unavailable. You can add your own description.' : 'Checking AI availability…'}</p></div>
      {showBrief && <label id="topic-description" className="discovery-description">Your description<textarea rows={3} value={input.brief} maxLength={4000} onChange={event => edit({ brief: event.target.value })} placeholder="An angle, question or outcome you want to explore…" /><span className="field-hint">Optional. Keep it focused on this topic.</span></label>}
      {message && <p className="discovery-message" role="status">{message}</p>}
      {error && <p className="studio-alert" role="alert">{error}</p>}
      {busy && <p className="idea-progress" role="status"><span className="library-loading-spinner" aria-hidden="true" />{busy}</p>}
      {audit && <section className="discovery-decision" aria-label="Library check result" role="status">
        {audit.action === 'clarify' && <><h2>Refine your topic or open a saved category</h2><p>{/unavailable/i.test(audit.reason) ? 'Automatic matching is unavailable. Open a saved category, or add a more specific description.' : audit.reason}</p>{audit.suggestions?.map(category => <Link key={category.id} to={`/ideas/${encodeURIComponent(category.id)}`}>Open {category.name} <ArrowRight size={16} aria-hidden="true" /></Link>)}<Link to="/ideas">Browse Topic Library</Link></>}
        {audit.action === 'new' && <><span className="discovery-result-label"><Check size={16} aria-hidden="true" /> Library checked</span><h2>Create {audit.name}?</h2><p>{audit.brief}</p><p className="discovery-decision-meta">{coverage} · {freshness} · {input.language} · {input.autoRefresh ? `Refresh every ${input.refreshIntervalDays} days` : 'Manual refresh'}</p>{audit.requestedTrending && <p>Measured trend data is unavailable. This research won’t be presented as verified trends.</p>}<p>{config?.capabilities.research ? (config.textProvider === 'openai' ? 'Creates this category and runs OpenAI research within the existing budget. Gemini is not used.' : config.capabilities.vertexFallback ? 'Creates this category and starts research. Free AI is tried first; approved Gemini fallback may use your remaining budget.' : 'Creates this category and starts one free research run. No paid fallback.') : 'New research is unavailable. Save this category now and research it later.'}</p><button type="button" className="primary-action" disabled={Boolean(busy)} onClick={() => void create()}>{config?.capabilities.research ? 'Create & find ideas' : 'Create category'}<ArrowRight size={17} aria-hidden="true" /></button></>}
      </section>}
      <section className="quick-topics" aria-labelledby="quick-topics-heading"><div className="discovery-section-heading"><h2 id="quick-topics-heading">Start with a category</h2><span>Or write any topic above</span></div><div className="quick-topic-list">{quickTopics.map(item => <button key={item.label} type="button" aria-pressed={input.topic === item.topic} onClick={() => edit({ topic: item.topic, brief: '', topics: [] })}>{item.label}</button>)}</div></section>
      <fieldset className="research-mode-fieldset"><legend>What kind of ideas do you need?</legend><div className="research-mode-options">{researchModes.map(({ id, title, description, goal, Icon }) => <label key={id} className={`research-mode${input.intent === goal ? ' is-selected' : ''}`}><input type="radio" name="research-mode" value={id} checked={input.intent === goal} onChange={() => edit({ intent: goal })} /><Icon className="research-mode-icon" size={21} aria-hidden="true" /><span className="research-mode-title">{title}</span><span className="research-mode-description">{description}</span></label>)}</div>{!mode && <p className="field-hint">Using your custom research goal. Edit it in advanced controls below.</p>}</fieldset>
      <section className="discovery-preferences" aria-labelledby="research-preferences-heading">
        <header className="discovery-preferences-header"><div><h2 id="research-preferences-heading">Research preferences</h2><p>Start with these defaults. Change only what matters.</p></div><SlidersHorizontal size={20} aria-hidden="true" /></header>
        <div className="discovery-preferences-body">
          <div className="discovery-preference-grid">
            <label>Coverage<select name="coverage" value={input.coverage} onChange={event => edit({ coverage: event.target.value as Input['coverage'] })}><option value="international">Worldwide</option><option value="national">One country</option><option value="both">Country + worldwide</option></select></label>
            <label>Source freshness<select name="freshness" value={input.windowDays} onChange={event => edit({ windowDays: Number(event.target.value) })}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
            <label>Language<select name="language" value={input.language} onChange={event => edit({ language: event.target.value })}>{['Auto', 'English', 'Hindi', 'Hinglish'].map(language => <option key={language}>{language}</option>)}</select></label>
          </div>
          {input.coverage !== 'international' && <label className="discovery-country">Country<input name="country" required maxLength={100} value={input.country} onChange={event => edit({ country: event.target.value })} placeholder="For example, India…" /></label>}
          <div className="discovery-refresh"><div><h3>Keep research updated</h3><p>{config?.capabilities.researchScheduling ? 'Choose when to look for fresh ideas.' : 'Refresh manually when you need new ideas.'}</p></div><div className="discovery-refresh-options" role="group" aria-label="Research refresh"><label><input type="radio" name="discovery-refresh" checked={!input.autoRefresh} onChange={() => edit({ autoRefresh: false })} /><span>Manual</span></label><label><input type="radio" name="discovery-refresh" checked={input.autoRefresh} disabled={!config?.capabilities.researchScheduling} aria-describedby="refresh-availability" onChange={() => edit({ autoRefresh: true })} /><span>Automatic</span></label></div></div>
          {!config?.capabilities.researchScheduling && <p className="field-hint" id="refresh-availability">Automatic refresh isn’t enabled for this workspace.</p>}
          {input.autoRefresh && <label className="discovery-country">Refresh interval (days)<input type="number" min={1} max={30} required value={input.refreshIntervalDays} onChange={event => edit({ refreshIntervalDays: Number(event.target.value) })} /></label>}
          <details className="discovery-advanced"><summary><SlidersHorizontal size={17} aria-hidden="true" /><span>Advanced research controls<small>Audience, goal, exclusions & sources</small></span><ChevronDown className="discovery-details-chevron" size={17} aria-hidden="true" /></summary><div className="discovery-advanced-fields">
            <label>Audience<input maxLength={300} value={input.audience} onChange={event => edit({ audience: event.target.value })} placeholder="For example, teachers or small-business owners…" /></label>
            <label>Research goal<textarea rows={3} maxLength={1500} value={input.intent} onChange={event => edit({ intent: event.target.value })} /></label>
            <label>Topics to include<textarea rows={3} value={input.topics.join('\n')} onChange={event => edit({ topics: event.target.value.split('\n') })} placeholder="One subtopic or theme per line…" /></label>
            <label>Anything to leave out?<input maxLength={500} value={input.exclusions} onChange={event => edit({ exclusions: event.target.value })} placeholder="For example, rumours or promotional announcements…" /></label>
            {input.coverage === 'international' && <label>Country focus (optional)<input maxLength={100} value={input.country} onChange={event => edit({ country: event.target.value })} placeholder="For example, India…" /></label>}
            <label>Audience location<input maxLength={100} value={input.region} onChange={event => edit({ region: event.target.value })} /></label>
            <label>Reference links (up to 5)<textarea rows={3} value={input.referenceUrls.join('\n')} onChange={event => edit({ referenceUrls: event.target.value.split('\n') })} placeholder="One https:// link per line…" /></label>
          </div></details>
          <p className="discovery-brief"><Globe2 size={18} aria-hidden="true" /><span><strong>Your research brief</strong>{coverage}{input.coverage === 'international' && input.country ? ` · Focus: ${input.country}` : ''} · {freshness} · {input.language} · {mode?.title || 'Custom goal'} · {input.autoRefresh ? `Every ${input.refreshIntervalDays} days` : 'Manual refresh'}</span></p>
        </div>
      </section>
      <p className="discovery-next-note"><Check size={16} aria-hidden="true" /> Find ideas checks for saved matches. You’ll confirm before new research starts.</p>
    </form>
  </section>
}
