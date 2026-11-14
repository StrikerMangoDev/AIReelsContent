import { useId, useState } from 'react'
import { Bookmark, Camera, ChevronLeft, ChevronRight, Heart, ImageIcon, MessageCircle, Send, MoreHorizontal, ThumbsUp, Repeat2, Share2, Play, BarChart3 } from 'lucide-react'
import { cleanCaption, renderSocialCaption } from '../../../shared/social-caption.js'
import type { StudioPackage, StudioContent } from '@/services/studio-api'
import type { ContentFormat } from '@/services/studio-package'
import { cleanCopy } from './ContentPreview'
import '../../styles/instagram-preview.css'

export type PreviewAccount = { id: string; name: string; platform: string }
export type PreviewMedia = { id: string; kind: 'image' | 'video'; url: string }

/** A draft composition, not a rendered or published Instagram asset. */
export function InstagramPreview({ content, evidence = [], contentFormat, title = 'Your content', activeSlide, onSlideSelect, previewMode, onModeChange, selectedSection, selectedPlatform, account, media, onMediaError }: { account?: PreviewAccount; media?: PreviewMedia; onMediaError?: () => void; content: StudioContent; evidence?: StudioPackage['evidence']; contentFormat?: ContentFormat; title?: string; activeSlide?: number; onSlideSelect?: (index: number) => void; previewMode?: 'post' | 'carousel'; onModeChange?: (mode: 'post' | 'carousel') => void; selectedSection?: string; selectedPlatform?: string }) {
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [localMode, setLocalMode] = useState<'post' | 'carousel'>(content.scenes?.length ? 'carousel' : 'post')
  const mode = content.scenes?.length ? contentFormat ? contentFormat === 'reel' || contentFormat === 'carousel' ? 'carousel' : 'post' : previewMode ?? localMode : 'post'
  const video = contentFormat === 'reel'
  const frame = video ? 'Scene' : 'Slide'
  const setMode = onModeChange ?? setLocalMode
  const selectSlide = onSlideSelect ?? setActive
  const captionId = useId()
  const post = selectedPlatform ? content.strategy?.platforms?.find(item => item.platform === selectedPlatform) : content.strategy?.platforms?.find(item => item.platform.toLowerCase() === 'instagram')
  const scenes = content.scenes || []
  const count = mode === 'carousel' ? Math.max(1, scenes.length) : 1
  const index = Math.min(activeSlide ?? active, count - 1)
  const scene = mode === 'carousel' ? scenes[index] : undefined
  const caption = cleanCopy(selectedSection === 'captions' ? content.captions?.reel || '' : post ? [cleanCopy(post.body).startsWith(cleanCopy(post.hook)) ? '' : post.hook, post.body, post.cta, post.hashtags.join(' ')].filter(Boolean).join('\n\n') : content.captions?.reel || '')
  const heading = cleanCopy(post?.headline || title)
  if (post && (selectedSection === 'posts' || !selectedSection && contentFormat === 'post')) return platformPostPreview(post, renderSocialCaption({ content, evidence }, post.platform), expanded, setExpanded, captionId, account, media, onMediaError)
  if (selectedSection === 'captions') return <section className="studio-panel" aria-label="Instagram caption alternative"><h2>Instagram caption alternative</h2><p>Optional wording. Copy it into Post text and save if you want to use it for publishing.</p><p className="preserve-lines">{cleanCopy(content.captions?.reel || '')}</p></section>
  if (selectedSection === 'script' && (!video || !scenes.length)) return <section className="studio-panel" aria-label="Recording preview"><h2>{contentFormat === 'audio' ? 'Audio script' : video ? 'Video script' : 'Recording preview'}</h2><p className="studio-muted">These are the words your presenter or voiceover will say. Audio has not been created.</p><p className="preserve-lines">{cleanCopy(content.script || '')}</p></section>
  if (selectedSection === 'hooks') return <section className="studio-panel" aria-label="Opening lines preview"><h2>Choose your opening</h2><p className="studio-muted">Use one opening line to introduce your post or video.</p>{content.hooks?.map((hook, index) => <p key={index}>{cleanCopy(hook)}</p>)}</section>
  if (selectedSection === 'keywords') return <section className="studio-panel" aria-label="Keywords guidance"><h2>Where keywords go</h2><p>Use relevant phrases naturally in your title, script and description. These are editorial suggestions, not measured rankings.</p><div className="composer-keyword-chips">{content.strategy?.keywords?.map((keyword, index) => <span key={index}>{cleanCopy(keyword)}</span>)}</div></section>
  if (content.website && (selectedSection === 'website' || !content.strategy?.platforms?.length && !content.captions && !scenes.length)) return <section className="studio-panel" aria-label="Article preview">
    <h2>Article preview</h2>
    <p className="studio-muted">Your website article as readers will see it.</p>
    <article><h3>{cleanCopy(content.website.title)}</h3><p className="preserve-lines">{cleanCopy(content.website.body)}</p></article>
  </section>
  if (selectedSection === 'captions-linkedin' && content.captions) return <section className="studio-panel" aria-label="LinkedIn caption preview"><h2>LinkedIn caption preview</h2><p className="studio-muted">The text for your LinkedIn post.</p><p className="preserve-lines">{cleanCopy(content.captions.linkedin)}</p></section>
  if (post && post.platform.toLowerCase() !== 'instagram' && !selectedSection && mode !== 'carousel') return platformPostPreview(post, renderSocialCaption({ content, evidence }, post.platform), expanded, setExpanded, captionId, account, media, onMediaError)
  return <section className="instagram-preview" aria-label="Instagram draft preview">
    <div className="instagram-preview-heading"><Camera size={20} aria-hidden="true" /><h2>{video ? 'Video storyboard' : contentFormat === 'carousel' ? 'Carousel preview' : 'Instagram preview'}</h2><span>{video ? 'Not rendered' : 'Layout only'}</span></div>
    <p className="instagram-preview-note">{video ? 'Scene order and timing for your editor. No video has been rendered.' : 'Your text in context. No images have been generated.'}</p>
    {!contentFormat && <div className="instagram-mode-controls" role="group" aria-label="Preview format">
      <button type="button" aria-pressed={mode === 'post'} onClick={() => { setMode('post'); selectSlide(0) }}>Post</button>
      <button type="button" aria-pressed={mode === 'carousel'} disabled={!scenes.length} onClick={() => { setMode('carousel'); selectSlide(0) }}>Carousel</button>
    </div>}
    {mode === 'carousel' && !scenes.length && <p className="instagram-preview-note">Add or generate a scene plan to preview multiple slides.</p>}
    <article className="instagram-post">
      <header className="instagram-post-account"><span className="instagram-avatar" aria-hidden="true">Y</span><div><strong>{video ? 'Reel / short video' : 'Your account'}</strong><span>{video ? scene?.timing || 'Scene plan' : mode === 'carousel' ? 'Carousel storyboard' : 'Post layout'}</span></div></header>
      <div className="instagram-media" aria-roledescription={count > 1 ? 'carousel' : undefined} aria-label="Draft visual area">
        <div className="instagram-slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${count}`}>
          <span className="instagram-placeholder-label"><ImageIcon size={16} aria-hidden="true" />{scene ? `${frame} ${index + 1} · ${video ? 'planned shot' : 'text layout'}` : 'No image added yet'}</span>
          <h3>{cleanCopy(scene?.onScreen || heading)}</h3>
          <p>{scene ? 'Planned on-screen text' : 'Your image or video will appear here.'}</p>
        </div>
        {count > 1 && <span className="instagram-slide-count" aria-hidden="true">{index + 1} / {count}</span>}
      </div>
      {count > 1 && <div className="instagram-slide-controls">
        <button type="button" aria-label={`Previous ${frame.toLowerCase()}`} disabled={index === 0} onClick={() => selectSlide(index - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
        <span role="status" aria-live="polite">{frame} {index + 1} of {count}</span>
        <button type="button" aria-label={`Next ${frame.toLowerCase()}`} disabled={index === count - 1} onClick={() => selectSlide(index + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
      </div>}
      <div className="instagram-decorative-actions" aria-hidden="true"><Heart size={23} /><MessageCircle size={23} /><Send size={23} /><Bookmark size={23} /></div>
      <div className="instagram-caption"><strong>{heading}</strong>
        {caption ? <><p id={captionId} className={expanded ? '' : 'instagram-caption-short'}>{caption}</p>{caption.length > 180 && <button type="button" aria-expanded={expanded} aria-controls={captionId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read full caption'}</button>}</> : <p>No Instagram caption in this draft yet.</p>}
      </div>
    </article>
    {scene && <div className="instagram-visual-direction"><h3>{frame} {index + 1} · visual direction</h3><p>{cleanCopy(scene.visualPrompt) || 'No visual direction supplied.'}</p>{video && <><h3>Narration</h3><p>{cleanCopy(scene.narration)}</p></>}</div>}
    <p className="instagram-preview-note">{video ? 'This is a video plan, not a playable video. ' : count > 1 ? 'These are planned slides, not finished carousel images. ' : ''}This is not a live post. Final line breaks and cropping may differ on Instagram.</p>
  </section>
}

/** Platform chrome is illustrative; caption and YouTube title follow the publishing contract. */
function platformPostPreview(post: { platform: string; headline: string }, caption: string, expanded: boolean, setExpanded: (value: boolean) => void, captionId: string, account?: PreviewAccount, media?: PreviewMedia, onMediaError?: () => void) {
  const instagram = post.platform === 'Instagram'
  const youtube = post.platform === 'YouTube'
  const x = post.platform === 'X'
  const linkedIn = post.platform === 'LinkedIn'
  const selectedAccount = account?.platform === post.platform ? account : undefined
  const name = selectedAccount?.name || selectedAccount?.id || 'Account not selected'
  const initials = selectedAccount ? name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase() : '?'
  const selectedMedia = media && (!youtube || media.kind === 'video') ? media : undefined
  const author = <header className="platform-post-author"><span className="platform-post-avatar" aria-hidden="true">{initials}</span><div><strong>{name}</strong><span>{selectedAccount ? 'Selected publishing account · Preview only' : 'No connected account selected'}</span></div><MoreHorizontal size={20} aria-hidden="true" /></header>
  const visual = selectedMedia ? <figure className="platform-post-rendered-media" data-asset-id={selectedMedia.id}>{selectedMedia.kind === 'image' ? <img onError={onMediaError} src={selectedMedia.url} alt={`Generated image selected for ${post.platform}`} /> : <video onError={onMediaError} src={selectedMedia.url} controls playsInline preload="metadata" aria-label={`Generated video selected for ${post.platform}`} />}</figure> : <div className="platform-post-media" data-video={youtube} aria-label={youtube ? 'Video placeholder' : 'Instagram media placeholder'}>{youtube ? <Play size={32} aria-hidden="true" /> : <ImageIcon size={28} aria-hidden="true" />}<strong>{youtube ? 'Video not selected for preview' : 'Image or video not selected for preview'}</strong><span>{youtube ? 'YouTube requires a completed video.' : 'Instagram requires an image or video.'}</span></div>
  const copy = <div className="platform-post-caption">{instagram && <strong className="platform-caption-handle">{name}</strong>}<div id={captionId} className="editor-exact-post" data-expanded={expanded}>{caption || 'No posting text saved yet.'}</div>{caption.length > 180 && <button type="button" className="platform-caption-expand" aria-expanded={expanded} aria-controls={captionId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read full post'}</button>}</div>
  const actions = <div className="platform-post-actions" aria-hidden="true">{instagram ? <><Heart size={21} /><MessageCircle size={21} /><Send size={21} /><Bookmark size={21} className="platform-action-end" /></> : x ? <><MessageCircle size={18} /><Repeat2 size={18} /><Heart size={18} /><BarChart3 size={18} /><Share2 size={18} /></> : <><span><ThumbsUp size={18} />Like</span>{!youtube && <span><MessageCircle size={18} />Comment</span>}<span>{linkedIn ? <Repeat2 size={18} /> : <Share2 size={18} />}{linkedIn ? 'Repost' : 'Share'}</span>{linkedIn && <span><Send size={18} />Send</span>}</>}</div>
  return <section className="studio-panel editor-post-preview platform-preview" aria-label={`${post.platform} text preview`}><div className="platform-preview-heading"><h2>{post.platform} publishing preview</h2><span>Platform layout</span></div><p>Exact publishing text and source links.</p><article className="platform-post" data-platform={post.platform} aria-label={`${post.platform} post layout`}>
    {youtube ? <>{visual}<h3 className="platform-video-title">{cleanCaption(post.headline) || 'No video title saved'}</h3>{author}{actions}<div className="platform-video-description">{copy}</div></> : instagram ? <>{author}{visual}{actions}{copy}</> : <>{author}{copy}{selectedMedia && visual}{actions}</>}
  </article><p className="platform-preview-note">Device layouts may vary. Previewing media does not approve it for publishing. Save your edits before publishing.</p></section>
}
