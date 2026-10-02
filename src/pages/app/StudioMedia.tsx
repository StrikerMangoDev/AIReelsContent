import { useCallback, useEffect, useRef, useState } from 'react'
import { studioRequest, type ContentStrategy, type StudioContent } from '@/services/studio-api'
import { authHeaders } from '@/services/firebase'
import { renderReel } from '@/services/reel'
import { useAuth } from '@/context/auth-state'

type Kind = 'image' | 'audio' | 'video'
type Asset = { id: string; requestId?: string; kind: Kind; status: string; error?: string; estimatedUsd?: number; prompt: string; packageRevision: number; voice?: string; language?: string }
type MediaRequest = { kind: Kind; prompt: string; requestId: string; confirmCost: true; voice?: string; language?: string; delivery?: string }
type MediaConfig = Record<Kind, { enabled: boolean; estimatedUsd: number | null }>
const clean = (text: string) => text.replace(/\s*\[C\d+\]/g, '').trim()

export function StudioMedia({ packageId, initialPrompt, script, strategy, scenes, disabled = false }: { packageId: string; initialPrompt: string; script: string; strategy?: ContentStrategy; scenes: StudioContent['scenes']; disabled?: boolean }) {
  const { identity } = useAuth()
  const pendingKey = `signal_media_pending:${identity?.uid}:${packageId}`
  const [pending, setPending] = useState<MediaRequest | null>(() => { try { return JSON.parse(sessionStorage.getItem(pendingKey) || 'null') } catch { return null } })
  function remember(request: MediaRequest | null) {
    // Persist before submission so navigation cannot silently create a second paid request.
    if (request) sessionStorage.setItem(pendingKey, JSON.stringify(request))
    else sessionStorage.removeItem(pendingKey)
    setPending(request)
  }
  const [config, setConfig] = useState<MediaConfig | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const acceptAssets = useCallback((list: Asset[]) => {
    setAssets(list)
    const request = JSON.parse(sessionStorage.getItem(pendingKey) || 'null') as MediaRequest | null
    if (request && list.some(asset => asset.requestId === request.requestId)) {
      sessionStorage.removeItem(pendingKey); setPending(null); setConfirmed(false)
    }
  }, [pendingKey])
  const [kind, setKind] = useState<Kind>('audio')
  const [prompt, setPrompt] = useState(clean(script))
  const [voice, setVoice] = useState<'Female' | 'Male'>(strategy?.voice || 'Female')
  const [language, setLanguage] = useState<'English' | 'Hindi' | 'Hinglish'>(strategy?.language || 'English')
  const [delivery, setDelivery] = useState(strategy?.delivery.slice(0, 300) || 'Clear and conversational')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ url: string; kind: Kind; id: string; srt?: string } | null>(null)
  const [progress, setProgress] = useState(0)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    let active = true
    Promise.all([studioRequest<MediaConfig>('/media/config'), studioRequest<{ assets: Asset[] }>(`/packages/${packageId}/assets`)]).then(([settings, list]) => { if (active) { setConfig(settings); acceptAssets(list.assets) } }).catch(cause => { if (active) setError(cause.message) })
    return () => { active = false; controller.current?.abort() }
  }, [packageId, acceptAssets])
  useEffect(() => () => { if (preview) { URL.revokeObjectURL(preview.url); if (preview.srt) URL.revokeObjectURL(preview.srt) } }, [preview])
  const hasRunning = Boolean(pending) || assets.some(asset => asset.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    let active = true; let polling = false
    const timer = window.setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const latest = await studioRequest<{ assets: Asset[] }>(`/packages/${packageId}/assets`)
        const updated = await Promise.all(latest.assets.map(async asset => {
          if (asset.status !== 'running' || asset.kind !== 'video') return asset
          try { return await studioRequest<Asset>(`/assets/${asset.id}/refresh`, {}, 'POST') } catch { return asset }
        }))
        if (active) acceptAssets(updated)
      } catch { /* Retry transient status errors without generating a second asset. */ } finally { polling = false }
    }, 8000)
    return () => { active = false; window.clearInterval(timer) }
  }, [hasRunning, packageId, acceptAssets])
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Media request failed.') } finally { setBusy('') }
  }
  async function assetFile(asset: Asset) {
    const response = await fetch(`/api/studio/assets/${asset.id}/file`, { headers: await authHeaders() })
    if (!response.ok) throw new Error('Could not load the generated asset.')
    return response.blob()
  }
  async function assemble(asset: Asset) {
    controller.current = new AbortController(); setProgress(0)
    const result = await renderReel(await assetFile(asset), asset.prompt, scenes, setProgress, controller.current.signal)
    setPreview({ url: URL.createObjectURL(result.blob), kind: 'video', id: `reel-${asset.id}.webm`, srt: URL.createObjectURL(new Blob([result.srt], { type: 'text/plain' })) })
  }
  const locked = Boolean(busy) || disabled || Boolean(pending)
  return <section>
    <div className="production-callout"><h3>A complete narrated draft</h3><p>Generate the voiceover, then export a vertical video with animated text scenes and captions. Your team can also use the scene prompts for richer visual production.</p><p className="studio-muted">Video export is WebM, runs in this browser, and takes the length of the narration. Caption timing is estimated; review before posting. No stock footage or music is added.</p></div>
    {error && <p className="studio-alert" role="alert">{error}</p>}
    {pending && <p role="status">The last request has an uncertain response. Checking saved assets automatically. Retry uses the same request and cannot start a duplicate.</p>}
    <div className="studio-fields"><label>Asset<select value={kind} disabled={locked} onChange={event => { const next = event.target.value as Kind; setKind(next); setPrompt(next === 'audio' ? clean(script) : initialPrompt); setConfirmed(false) }}><option value="audio">Full voiceover</option><option value="image">Scene image</option><option value="video">8-second illustrative clip</option></select></label>
      {kind === 'audio' && <><label>Voice<select disabled={locked} value={voice} onChange={event => setVoice(event.target.value as 'Female' | 'Male')}><option>Female</option><option>Male</option></select></label><label>Language<select disabled={locked} value={language} onChange={event => setLanguage(event.target.value as 'English' | 'Hindi' | 'Hinglish')}><option>English</option><option>Hindi</option><option>Hinglish</option></select></label><label>Delivery<input maxLength={300} value={delivery} disabled={locked} onChange={event => setDelivery(event.target.value)} /></label></>}
    </div>
    <label>{kind === 'audio' ? 'Narration (edit the content above to translate it)' : 'Visual prompt'}<textarea minLength={10} maxLength={12000} value={prompt} disabled={locked} onChange={event => setPrompt(event.target.value)} /></label>
    {config?.[kind]?.enabled ? <><p>Estimated cost: ${Number(config[kind].estimatedUsd).toFixed(2)} USD per generation.</p><label className="studio-check"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)} />Approve this generation’s estimated cost.</label></> : <p className="studio-muted">{kind} generation is not configured. The complete prompts and narration are available in your team brief.</p>}
    <button disabled={Boolean(busy) || disabled || (!pending && (!confirmed || prompt.trim().length < 10 || !config?.[kind]?.enabled))} onClick={() => void run('Generating asset', async () => {
      const request: MediaRequest = pending || { kind, prompt, requestId: crypto.randomUUID(), confirmCost: true, ...(kind === 'audio' ? { voice, language, delivery } : {}) }
      remember(request)
      let asset: Asset
      try { asset = await studioRequest<Asset>(`/packages/${packageId}/assets`, request, 'POST') }
      catch (cause) {
        if ([400, 401, 403, 404, 429, 503].includes(Number((cause as { status?: number }).status))) remember(null)
        try { const list = await studioRequest<{ assets: Asset[] }>(`/packages/${packageId}/assets`); acceptAssets(list.assets) } catch { /* Keep the request identity until reconciliation succeeds. */ }
        throw cause
      }
      remember(null)
      setAssets(previous => [asset, ...previous.filter(entry => entry.id !== asset.id)]); setConfirmed(false)
      if (asset.status === 'completed') setPreview({ url: URL.createObjectURL(await assetFile(asset)), kind: asset.kind, id: asset.id })
    })}>{busy || (pending ? 'Recover last request' : `Generate ${kind === 'audio' ? 'voiceover' : kind}`)}</button>
    {busy === 'Exporting narrated video' && <div role="status"><p>Exporting {progress}% — keep this tab visible.</p><progress max={100} value={progress} /><button onClick={() => controller.current?.abort()}>Cancel export</button></div>}
    <div className="studio-package-list">{assets.map(asset => <article key={asset.id} className="studio-evidence"><h3>{asset.kind} · {asset.status}</h3><p className="studio-muted">Created from revision {asset.packageRevision}{asset.voice ? ` · ${asset.voice} · ${asset.language}` : ''}</p>{asset.error && <p role="alert">{asset.error}</p>}{asset.status === 'running' && <p role="status">Processing. Video progress is checked automatically.</p>}{asset.status === 'completed' && <div className="studio-toolbar"><button disabled={locked} onClick={() => void run('Loading preview', async () => setPreview({ url: URL.createObjectURL(await assetFile(asset)), kind: asset.kind, id: asset.id }))}>Preview & download</button>{asset.kind === 'audio' && <button disabled={locked || clean(asset.prompt) !== clean(script)} title={clean(asset.prompt) !== clean(script) ? 'This voiceover differs from the current script. Generate a matching voiceover first.' : undefined} onClick={() => void run('Exporting narrated video', () => assemble(asset))}>Export narrated video</button>}</div>}</article>)}</div>
    {preview && <div className="studio-media-preview">{preview.kind === 'image' ? <img src={preview.url} alt="Generated illustrative production asset" /> : preview.kind === 'audio' ? <audio src={preview.url} controls /> : <video src={preview.url} controls />}<div className="studio-toolbar"><a className="studio-button" href={preview.url} download={preview.id.startsWith('reel-') ? preview.id : `asset-${preview.id}`}>Download {preview.kind}</a>{preview.srt && <a className="studio-button" href={preview.srt} download="captions.srt">Download subtitles</a>}</div></div>}
  </section>
}
