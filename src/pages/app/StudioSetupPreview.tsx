import { useState } from 'react'
import type { StudioContent, StudioPackage, StudioProfile } from '@/services/studio-api'
import { contentPacks, formatLabels, sameOutputs, savedContentFormats, type ContentFormat } from '@/services/studio-package'
import { renderSocialCaption } from '../../../shared/social-caption.js'
import { ConnectedPostPreview } from './ConnectedPostPreview'

export function StudioSetupPreview({ content, profile, title, evidence, settingsChanged, packageId, revision, active }: { packageId: string; revision: number; active: boolean; content: StudioContent | null; profile: StudioProfile; title: string; evidence: StudioPackage['evidence']; settingsChanged: boolean }) {
  const [view, setView] = useState('layout')
  const [chosenPlatform, setChosenPlatform] = useState('')
  const platforms = profile.platform.split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim()).filter(Boolean)
  const platform = platforms.includes(chosenPlatform) ? chosenPlatform : platforms[0] || ''
  const pack = contentPacks.find(pack => sameOutputs(profile.outputs || [], pack.outputs))
  const format = (pack?.id || (profile.outputs?.includes('website') ? 'article' : profile.outputs?.includes('production') ? 'reel' : profile.outputs?.includes('script') ? 'audio' : 'post')) as ContentFormat
  const saved = Boolean(content && savedContentFormats(content).includes(format))
  const hasPost = Boolean(content?.strategy?.platforms?.some(post => post.platform === platform))
  const section = format === 'article' ? 'website' : format === 'audio' ? 'script' : undefined
  const canPreview = saved && (format !== 'post' || hasPost || platform === 'Instagram' && Boolean(content?.captions))
  return <details className="setup-preview" open>
    <summary>Content preview<span>{canPreview ? 'Saved draft' : 'Example layout'}</span></summary>
    <div className="setup-preview-body">
      <p>{!canPreview ? 'A layout guide only. Generate this selection to see its actual draft.' : settingsChanged ? 'Your saved draft is shown below. New settings apply after generation.' : 'Review your saved writing. Media and publishing checks are separate.'}</p>
      <div className="setup-preview-controls">
        <label>Preview platform<select name="setupPreviewPlatform" value={platform} disabled={!platforms.length} onChange={event => setChosenPlatform(event.target.value)}>{platforms.length ? platforms.map(value => <option key={value}>{value}</option>) : <option value="">Choose a platform</option>}</select></label>
        {canPreview && <div role="group" aria-label="Setup preview view"><button type="button" aria-pressed={view === 'layout'} onClick={() => setView('layout')}>Layout</button><button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')}>Text</button></div>}
      </div>
      {canPreview && content ? view === 'text' ? <section className="setup-text-preview" aria-label="Saved text preview"><h3>{format === 'article' ? 'Article text' : format === 'audio' || format === 'reel' ? 'Spoken script' : `${platform} posting text`}</h3><p>{format === 'article' ? [content.website?.title, content.website?.body].filter(Boolean).join('\n\n') : format === 'audio' || format === 'reel' ? content.script : hasPost ? renderSocialCaption({ content, evidence }, platform) : 'No platform post is saved for this selection. Review the saved caption in the editor.'}</p></section> : <ConnectedPostPreview packageId={packageId} revision={revision} active={active} content={content} evidence={evidence} contentFormat={format} title={title} selectedPlatform={platform} selectedSection={section} /> : <section className="setup-example" aria-label="Example layout"><span>Example layout · {formatLabels[format]}</span><div className="setup-example-visual"><strong>{title}</strong><p>{format === 'article' ? 'Article title and body will appear here.' : format === 'reel' || format === 'carousel' ? 'Your scene plan and visual directions will appear here.' : format === 'audio' ? 'Your spoken script will appear here.' : 'Your visual brief and posting text will appear here.'}</p></div><p>{content ? 'This format or platform has no saved content yet.' : 'No content or media has been generated yet.'}</p></section>}
    </div>
  </details>
}
