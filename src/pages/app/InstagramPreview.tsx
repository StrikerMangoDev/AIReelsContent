import { useId, useState } from 'react'
import { Bookmark, Camera, ChevronLeft, ChevronRight, Heart, ImageIcon, MessageCircle, Send } from 'lucide-react'
import type { StudioContent } from '@/services/studio-api'
import { cleanCopy } from './ContentPreview'
import '../../styles/instagram-preview.css'

/** A draft composition, not a rendered or published Instagram asset. */
export function InstagramPreview({ content, title = 'Your content', activeSlide, onSlideSelect, previewMode, onModeChange, selectedSection }: { content: StudioContent; title?: string; activeSlide?: number; onSlideSelect?: (index: number) => void; previewMode?: 'post' | 'carousel'; onModeChange?: (mode: 'post' | 'carousel') => void; selectedSection?: string }) {
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [localMode, setLocalMode] = useState<'post' | 'carousel'>(content.scenes?.length ? 'carousel' : 'post')
  const mode = content.scenes?.length ? previewMode ?? localMode : 'post'
  const setMode = onModeChange ?? setLocalMode
  const selectSlide = onSlideSelect ?? setActive
  const captionId = useId()
  const post = content.strategy?.platforms?.find(item => item.platform.toLowerCase() === 'instagram')
  const scenes = content.scenes || []
  const count = mode === 'carousel' ? Math.max(1, scenes.length) : 1
  const index = Math.min(activeSlide ?? active, count - 1)
  const scene = mode === 'carousel' ? scenes[index] : undefined
  const caption = cleanCopy(selectedSection === 'captions' ? content.captions?.reel || '' : post ? [cleanCopy(post.body).startsWith(cleanCopy(post.hook)) ? '' : post.hook, post.body, post.cta, post.hashtags.join(' ')].filter(Boolean).join('\n\n') : content.captions?.reel || '')
  const heading = cleanCopy(post?.headline || title)
  if (content.website && (selectedSection === 'website' || !content.strategy?.platforms?.length && !content.captions && !scenes.length)) return <section className="studio-panel" aria-label="Article preview">
    <h2>Article preview</h2>
    <p className="studio-muted">Your website article as readers will see it.</p>
    <article><h3>{cleanCopy(content.website.title)}</h3><p className="preserve-lines">{cleanCopy(content.website.body)}</p></article>
  </section>
  if (selectedSection === 'captions-linkedin' && content.captions) return <section className="studio-panel" aria-label="LinkedIn caption preview"><h2>LinkedIn caption preview</h2><p className="studio-muted">The text for your LinkedIn post.</p><p className="preserve-lines">{cleanCopy(content.captions.linkedin)}</p></section>
  return <section className="instagram-preview" aria-label="Instagram draft preview">
    <div className="instagram-preview-heading"><Camera size={20} aria-hidden="true" /><h2>Instagram preview</h2><span>Layout only</span></div>
    <p className="instagram-preview-note">Your text in context. No images have been generated.</p>
    <div className="instagram-mode-controls" role="group" aria-label="Preview format">
      <button type="button" aria-pressed={mode === 'post'} onClick={() => { setMode('post'); selectSlide(0) }}>Post</button>
      <button type="button" aria-pressed={mode === 'carousel'} disabled={!scenes.length} onClick={() => { setMode('carousel'); selectSlide(0) }}>Carousel</button>
    </div>
    {mode === 'carousel' && !scenes.length && <p className="instagram-preview-note">Add or generate a scene plan to preview multiple slides.</p>}
    <article className="instagram-post">
      <header className="instagram-post-account"><span className="instagram-avatar" aria-hidden="true">Y</span><div><strong>Your account</strong><span>{mode === 'carousel' ? 'Carousel storyboard' : 'Post layout'}</span></div></header>
      <div className="instagram-media" aria-roledescription={count > 1 ? 'carousel' : undefined} aria-label="Draft visual area">
        <div className="instagram-slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${count}`}>
          <span className="instagram-placeholder-label"><ImageIcon size={16} aria-hidden="true" />{scene ? `Slide ${index + 1} · text layout` : 'No image added yet'}</span>
          <h3>{cleanCopy(scene?.onScreen || heading)}</h3>
          <p>{scene ? 'Planned on-screen text' : 'Your image or video will appear here.'}</p>
        </div>
        {count > 1 && <span className="instagram-slide-count" aria-hidden="true">{index + 1} / {count}</span>}
      </div>
      {count > 1 && <div className="instagram-slide-controls">
        <button type="button" aria-label="Previous slide" disabled={index === 0} onClick={() => selectSlide(index - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
        <span role="status" aria-live="polite">Slide {index + 1} of {count}</span>
        <button type="button" aria-label="Next slide" disabled={index === count - 1} onClick={() => selectSlide(index + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
      </div>}
      <div className="instagram-decorative-actions" aria-hidden="true"><Heart size={23} /><MessageCircle size={23} /><Send size={23} /><Bookmark size={23} /></div>
      <div className="instagram-caption"><strong>{heading}</strong>
        {caption ? <><p id={captionId} className={expanded ? '' : 'instagram-caption-short'}>{caption}</p>{caption.length > 180 && <button type="button" aria-expanded={expanded} aria-controls={captionId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read full caption'}</button>}</> : <p>No Instagram caption in this draft yet.</p>}
      </div>
    </article>
    {scene && <div className="instagram-visual-direction"><h3>Visual direction · slide {index + 1}</h3><p>{cleanCopy(scene.visualPrompt) || 'No visual direction supplied.'}</p></div>}
    <p className="instagram-preview-note">{count > 1 ? 'Scenes are shown as storyboard slides, not finished carousel images. ' : ''}This is not a live post. Final line breaks and cropping may differ on Instagram.</p>
  </section>
}
