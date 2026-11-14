import type { ReactNode } from 'react'
import { Clapperboard, FileText, Images, Mic, MessageSquare } from 'lucide-react'
import type { StudioProfile } from '@/services/studio-api'
import { contentPacks, sameOutputs, suggestContentPacks } from '@/services/studio-package'

const packIcons = { post: MessageSquare, reel: Clapperboard, carousel: Images, audio: Mic, article: FileText }
const platforms = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']

export function StudioPackageSetup({ profile, subject, disabled, onChange, children }: { profile: StudioProfile; subject: string; disabled: boolean; onChange: (profile: StudioProfile) => void; children?: ReactNode }) {
  const suggestion = suggestContentPacks(subject)
  const selectedPlatforms = profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).filter(Boolean)
  return <div className="desk-package-setup setup-sequence">
    <section className="setup-step" aria-labelledby="setup-formats-heading">
      <header className="desk-section-intro"><h2 id="setup-formats-heading">What are you creating?</h2><p>Choose a starting format, then select the platforms you need.</p></header>
      <fieldset className="setup-format-choices" disabled={disabled}><legend className="visually-hidden">Starting format</legend>
        {contentPacks.map(pack => { const Icon = packIcons[pack.id as keyof typeof packIcons]; const selected = sameOutputs(profile.outputs || [], pack.outputs); return <label key={pack.id} className="setup-format-choice" data-selected={selected}><input type="radio" name="starting-format" value={pack.id} checked={selected} onChange={() => onChange({ ...profile, outputs: [...pack.outputs] })} /><Icon size={20} aria-hidden="true" /><span><strong>{pack.title}</strong><span>{pack.description}</span></span></label> })}
      </fieldset>
      {Boolean(profile.outputs?.length) && !contentPacks.some(pack => sameOutputs(profile.outputs || [], pack.outputs)) && <p className="setup-current-selection">Custom selection · {profile.outputs?.length} deliverables. Choose a starting format to replace it, or customize below.</p>}
      <details className="setup-format-help"><summary>Help choosing a format</summary><p>{suggestion.reason}</p><p>Based on the topic wording, not measured performance or expert approval.</p><ul>{contentPacks.map(pack => <li key={pack.id}><strong>{pack.title}{suggestion.ids.includes(pack.id) ? ' (suggested)' : ''}:</strong> {pack.use}</li>)}</ul><p>Long video is not available in this version. Script generation supports 15–180 seconds.</p></details>
      <fieldset className="desk-platforms setup-platforms" disabled={disabled}><legend>Where will you publish?</legend><div>{platforms.map(platform => <label key={platform}><input type="checkbox" checked={selectedPlatforms.includes(platform)} onChange={event => { const selected = new Set(selectedPlatforms); if (event.target.checked) selected.add(platform); else selected.delete(platform); onChange({ ...profile, platform: platforms.filter(value => selected.has(value)).join(', ') }) }} /><span>{platform}</span></label>)}</div></fieldset>
    </section>
    <section className="setup-step" aria-labelledby="setup-audience-heading">
      <header className="desk-section-intro"><h2 id="setup-audience-heading">Who is it for?</h2><p>Set the audience, language and voice for your content.</p></header>
      <div className="desk-brief-fields"><label>Audience<input name="audience" autoComplete="off" value={profile.audience} maxLength={300} disabled={disabled} onChange={event => onChange({ ...profile, audience: event.target.value })} /></label><label>Language<input name="language" autoComplete="off" value={profile.language} maxLength={80} disabled={disabled} onChange={event => onChange({ ...profile, language: event.target.value })} /></label><label>Writing style<input name="writingStyle" autoComplete="off" value={profile.tone} maxLength={100} disabled={disabled} onChange={event => onChange({ ...profile, tone: event.target.value })} /></label>{profile.outputs?.includes('script') && <label>Target script length<select name="duration" disabled={disabled} value={profile.duration} onChange={event => onChange({ ...profile, duration: Number(event.target.value) })}>{[...new Set([15, 30, 45, 60, 90, 120, 180, profile.duration])].sort((a, b) => a - b).map(seconds => <option value={seconds} key={seconds}>{seconds < 60 ? `${seconds} seconds` : `${seconds / 60} ${seconds === 60 ? 'minute' : 'minutes'}`}</option>)}</select></label>}</div>
      <p className="setup-brief-help">For goals and brand direction, open More options → Content brief.</p>
    </section>
    {children}
  </div>
}
