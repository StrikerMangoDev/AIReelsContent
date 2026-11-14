import { useState } from 'react'
import { CheckCircle2, CircleDashed, Copy } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import type { StudioContent } from '@/services/studio-api'
import { hashtagText, keywordUsage } from '@/services/content-keywords'

export function StudioKeywordUsage({ content, platform, onCopy }: { content: StudioContent; platform?: string; onCopy: (text: string) => void }) {
  const [scope, setScope] = useState(platform || 'all')
  const activeScope = scope === 'all' || content.strategy?.platforms?.some(post => post.platform === scope) ? scope : 'all'
  const usage = keywordUsage(content, activeScope === 'all' ? undefined : activeScope)
  const found = usage.filter(item => item.locations.length > 0).length
  const tags = content.strategy?.platforms?.filter(post => (activeScope === 'all' || post.platform === activeScope) && post.hashtags?.length) || []
  return <div className="studio-keyword-usage">
    <div className="keyword-usage-toolbar"><label className="studio-keyword-scope">Check wording for<select name="keywordScope" value={activeScope} onChange={event => setScope(event.target.value)}><option value="all">All saved writing</option>{content.strategy?.platforms?.map(post => <option key={post.platform}>{post.platform}</option>)}</select></label><span className="keyword-usage-summary" role="status">{usage.length ? `${found} of ${usage.length} found in draft` : 'No keywords saved'}</span></div>
    <p className="keyword-usage-note">Checks current wording, including unsaved edits and optional copy.</p>
    {usage.length ? <ul aria-label="Keyword placement results">{usage.map(({ keyword, locations }, index) => <li key={index}><strong>{keyword}</strong><div><span className="studio-keyword-state" data-found={Boolean(locations.length)}>{locations.length ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}{locations.length ? 'Found in draft' : 'Not found'}</span><span>{locations.length ? locations.join(' · ') : 'Add naturally if relevant to your message.'}</span></div></li>)}</ul> : <p>No keyword phrases were generated for this draft.</p>}
    <details className="keyword-placement-help"><summary>How to use keywords</summary><p>Use relevant phrases naturally in post text or captions, article titles and body text, or video openings, narration and descriptions. Keep your wording factual. Editing the keyword list does not insert phrases into your content.</p><p>These are phrase matches, not measured search demand or a performance prediction.</p></details>
    <section className="studio-keyword-tags"><h4>Posting hashtags</h4><p>Copy relevant tags into Post text before saving. Tags are not appended automatically.</p>{tags.length ? tags.map(post => <div key={post.platform} className="keyword-hashtag-group"><header><strong>{post.platform}</strong><IconButton icon={Copy} label={`Copy ${post.platform} hashtags`} tooltip="Copy hashtags" onClick={() => onCopy(hashtagText(post.hashtags))} /></header><div className="keyword-hashtag-chips">{post.hashtags.filter(tag => tag.trim()).map((tag, index) => <span key={index}>{hashtagText([tag])}</span>)}</div></div>) : <p>No hashtags were generated for this selection.</p>}</section>
  </div>
}
