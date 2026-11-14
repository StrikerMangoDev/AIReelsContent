import { useState } from 'react'
import { Clapperboard, Mic, Image, Scissors, Copy, ExternalLink } from 'lucide-react'
import type { StudioPackage } from '@/services/studio-api'
import type { ContentFormat } from '@/services/studio-package'
import { buildProductionPrompt, type ProductionTeam, type VideoTool, type HandoffOptions } from '@/services/production-handoff'

const teams = [{ id: 'video', label: 'Video', Icon: Clapperboard }, { id: 'audio', label: 'Audio', Icon: Mic }, { id: 'graphics', label: 'Graphics', Icon: Image }, { id: 'editor', label: 'Editor', Icon: Scissors }] as const

export function StudioProductionPrompts({ pack, format = 'reel', initialSceneIndex = 0, onSceneChange, lockedReason = '' }: { pack: StudioPackage; format?: ContentFormat; initialSceneIndex?: number; onSceneChange?: (index: number) => void; lockedReason?: string }) {
  const availableTeams = teams.filter(team => format === 'reel' || team.id === 'editor' || (format === 'audio' ? team.id === 'audio' : team.id === 'graphics'))
  const [team, setTeam] = useState<ProductionTeam>(format === 'article' ? 'editor' : availableTeams[0].id)
  const [videoTool, setVideoTool] = useState<VideoTool>('heygen')
  const [sceneIndex, setSceneIndex] = useState(initialSceneIndex)
  const [graphic, setGraphic] = useState<'cover' | 'slide'>(format === 'carousel' ? 'slide' : 'cover')
  const [ratio, setRatio] = useState<NonNullable<HandoffOptions['ratio']>>(format === 'post' || format === 'carousel' ? '4:5' : pack.settings.platform === 'YouTube' ? '16:9' : '9:16')
  const [notice, setNotice] = useState('')
  const platformOptions = pack.content?.strategy?.platforms?.map(entry => entry.platform) || []
  const [platform, setPlatform] = useState(platformOptions.includes(pack.settings.platform as typeof platformOptions[number]) ? pack.settings.platform : platformOptions[0] || pack.settings.platform)
  const prompt = buildProductionPrompt(pack, { team, platform, format, videoTool, sceneIndex, graphic, ratio })
  const locked = Boolean(lockedReason || prompt.missing)
  const sceneCount = pack.content?.scenes?.length || 0
  const selectedScene = Math.min(sceneIndex, Math.max(0, sceneCount - 1))
  const change = (action: () => void) => { setNotice(''); action() }
  async function copy(value: string, label: string) {
    if (locked || !value.trim()) return
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied. Follow the steps below in the destination tool.`) }
    catch { setNotice('Could not copy automatically. Select the prompt text and copy it manually.') }
  }
  return <section className="production-prompts" aria-label="Copy-ready team prompts">
    <header><h3>{format === 'carousel' ? 'Create your slide images' : format === 'post' ? 'Create your post image' : format === 'audio' ? 'Record your audio' : format === 'article' ? 'Prepare your article' : 'Build your video'}</h3><p>Copy the brief below into your production tool. Your saved content stays unchanged.</p></header>
    <nav className="handoff-team-nav" aria-label="Production team">{availableTeams.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={team === id} onClick={() => change(() => setTeam(id))}><Icon size={18} aria-hidden="true" />{label}</button>)}</nav>
    <div className="handoff-controls">
      {platformOptions.length > 1 && <label>Platform<select aria-label="Production platform" name="productionPlatform" value={platform} onChange={event => change(() => setPlatform(event.target.value))}>{platformOptions.map(value => <option key={value}>{value}</option>)}</select></label>}
      {team === 'video' && <label>What will you build?<select aria-label="What will you build?" name="videoTool" value={videoTool} onChange={event => change(() => setVideoTool(event.target.value as VideoTool))}><option value="heygen">Complete video · HeyGen Video Agent</option><option value="omni">One shot · Gemini Omni 1.2 Flash</option><option value="runway">Animate an image · Runway Gen-4</option></select></label>}
      {team === 'graphics' && format !== 'post' && <label>Graphic type<select aria-label="Graphic type" name="graphicType" value={graphic} onChange={event => change(() => setGraphic(event.target.value as 'cover' | 'slide'))}><option value="cover">Cover / thumbnail</option><option value="slide">{format === 'carousel' ? 'Slide image' : 'Scene image'}</option></select></label>}
      {(team === 'video' && videoTool !== 'heygen' || team === 'graphics' && graphic === 'slide') && sceneCount > 0 && <label>{format === 'carousel' ? 'Choose slide' : 'Choose scene'}<select aria-label={format === 'carousel' ? 'Choose slide' : 'Choose scene'} name="sceneIndex" value={selectedScene} onChange={event => change(() => { const index = Number(event.target.value); setSceneIndex(index); onSceneChange?.(index) })}>{pack.content?.scenes?.map((entry, index) => <option key={index} value={index}>{format === 'carousel' ? `Slide ${index + 1}` : `Scene ${index + 1} · ${entry.timing}`}</option>)}</select></label>}
      {team !== 'audio' && format !== 'audio' && format !== 'article' && <label>Canvas shape<select aria-label="Canvas shape" name="aspectRatio" value={ratio} onChange={event => change(() => setRatio(event.target.value as typeof ratio))}><option value="9:16">9:16 · Vertical video / cover</option><option value="16:9">16:9 · Landscape / YouTube</option><option value="4:5">4:5 · Portrait graphic</option><option value="1:1">1:1 · Square graphic</option></select></label>}
    </div>
    <div className="handoff-destination"><strong>{prompt.tool}</strong><p>{prompt.reason}</p>{prompt.guide && <a href={prompt.guide} target="_blank" rel="noreferrer">Read the official guide <ExternalLink size={14} aria-hidden="true" /></a>}</div>
    {lockedReason && <p className="studio-alert" role="status">{lockedReason}</p>}
    {prompt.missing ? <p className="handoff-missing" role="status">{prompt.missing}</p> : <>
      <div className="handoff-prompt-heading"><div><h4>{prompt.title}</h4><span>Saved revision {pack.revision} · prepared without another AI call</span></div><button type="button" className="workflow-primary" disabled={locked} onClick={() => void copy(prompt.prompt, 'Prompt')}><Copy size={16} aria-hidden="true" />Copy prompt</button></div>
      <pre className="handoff-prompt-text" tabIndex={0} aria-label={`${team} production prompt`}>{prompt.prompt}</pre>
      {prompt.narration && team !== 'graphics' && <div className="handoff-narration"><div className="handoff-prompt-heading"><div><h4>Narration only</h4><span>Paste this into the spoken-text field. Recording instructions stay separate.</span></div><button type="button" disabled={locked} onClick={() => void copy(prompt.narration, 'Narration')}>Copy narration</button></div><p className="preserve-lines">{prompt.narration}</p></div>}
    </>}
    {notice && <p className="studio-save-notice" role="status">{notice}</p>}
    <div className="handoff-use"><section><h4>Where to use it</h4><ol>{prompt.steps.map(step => <li key={step}>{step}</li>)}</ol></section><section><h4>What to attach</h4><ul>{prompt.attachments.map(attachment => <li key={attachment}>{attachment}</li>)}</ul></section></div>
    <p className="studio-muted">{prompt.note} Copy uses the choices above. Downloads keep all saved content and include starter briefs for your working format; temporary tool and canvas choices are not saved.</p>
  </section>
}
