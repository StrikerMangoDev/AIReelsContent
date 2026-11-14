import type { OutputFormat, StudioContent } from './studio-api'

export const contentPacks: { id: string; title: string; description: string; use: string; outputs: OutputFormat[] }[] = [
  { id: 'post', title: 'Social post', description: 'Headline, post, caption and keywords', use: 'Share a concise update with your audience.', outputs: ['captions', 'platforms'] },
  { id: 'reel', title: 'Reel / short video', description: 'Script, scenes, posting copy and directions', use: 'Give your presenter and editor a short video brief.', outputs: ['script', 'captions', 'platforms', 'production'] },
  { id: 'carousel', title: 'Carousel', description: 'Slide copy, image briefs and caption', use: 'Explain an idea in a swipeable sequence.', outputs: ['script', 'captions', 'production'] },
  { id: 'audio', title: 'Audio / voiceover', description: 'Spoken script, hooks and posting copy', use: 'Prepare the words to record or turn into a voiceover.', outputs: ['script', 'captions', 'platforms'] },
  { id: 'article', title: 'Article', description: 'Full website copy and social introduction', use: 'Develop a written explanation and a post to share it.', outputs: ['website', 'platforms'] },
]

/** Editorial starting points, not performance predictions or an AI approval. */
export function suggestContentPacks(subject: string) {
  if (/\b(how to|steps?|tips?|guide|ways?|explained|comparison)\b/i.test(subject)) return { ids: ['carousel', 'reel'], reason: 'A step-by-step explanation can work as slides or a short spoken walkthrough.' }
  if (/\b(interview|conversation|podcast|listen|voice)\b/i.test(subject)) return { ids: ['audio', 'reel'], reason: 'A spoken story can become an audio script or a short video.' }
  if (/\b(reports?|research|analysis|study|studies|outlook)\b/i.test(subject)) return { ids: ['article', 'carousel'], reason: 'A detailed finding can work as an article or a sequence of key takeaways.' }
  return { ids: ['post', 'reel'], reason: 'Start with a concise update or a short explanation. Choose the formats that fit your audience.' }
}

export function sameOutputs(left: OutputFormat[], right: OutputFormat[]) {
  return left.length === right.length && left.every(output => right.includes(output))
}

export function initialContentSection(content: StudioContent) {
  return content.strategy?.platforms?.length ? 'posts' : content.captions ? 'captions' : content.script !== undefined ? 'script' : 'website'
}

export type ContentFormat = 'post' | 'reel' | 'carousel' | 'audio' | 'article'
export const formatLabels: Record<ContentFormat, string> = { post: 'Social post', reel: 'Reel / short video', carousel: 'Carousel', audio: 'Audio / voiceover', article: 'Article' }
export const formatSections: Record<ContentFormat, string[]> = { post: ['posts', 'captions', 'keywords'], reel: ['script', 'slides', 'posts', 'captions', 'hooks', 'keywords'], carousel: ['slides', 'captions', 'keywords'], audio: ['script', 'hooks', 'captions', 'keywords'], article: ['website', 'posts', 'keywords'] }
export function savedContentFormats(content: StudioContent): ContentFormat[] {
  return (['post', 'reel', 'carousel', 'audio', 'article'] as ContentFormat[]).filter(format => format === 'post' ? Boolean(content.strategy?.platforms?.length || content.captions) : format === 'carousel' ? Boolean(content.scenes?.length) : format === 'article' ? Boolean(content.website) : Boolean(content.script?.trim()))
}
export function initialContentFormat(content: StudioContent, outputs: OutputFormat[] = []) {
  const formats = savedContentFormats(content)
  const pack = contentPacks.find(pack => sameOutputs(pack.outputs, outputs))
  return formats.find(format => format === pack?.id) || (content.script ? 'reel' : formats[0]) || 'post'
}
export function formatContentSection(content: StudioContent, format: ContentFormat) {
  const ready: Record<string, unknown> = { posts: content.strategy?.platforms?.length, slides: content.scenes?.length, keywords: content.strategy?.keywords?.length, website: content.website, captions: content.captions, hooks: content.hooks?.length, script: content.script?.trim() }
  return formatSections[format].find(section => ready[section]) || initialContentSection(content)
}

export function scriptReadingEstimate(script = '') {
  const words = script.replace(/\[C\d+\]/g, '').trim().split(/\s+/).filter(Boolean).length
  return { words, seconds: Math.round(words / 140 * 60) }
}

export function packageDeliverables(content: StudioContent) {
  return [
    { id: 'script', label: 'Spoken script', ready: Boolean(content.script?.trim()), use: 'For your presenter or audio producer' },
    { id: 'slides', label: 'Scenes & slide copy', ready: Boolean(content.scenes?.length), use: 'For your video editor or designer' },
    { id: 'posts', label: 'Platform posts', ready: Boolean(content.strategy?.platforms?.length), use: 'For your posting team' },
    { id: 'captions', label: 'Captions', ready: Boolean(content.captions), use: 'Text to accompany the post' },
    { id: 'website', label: 'Article', ready: Boolean(content.website), use: 'For your website editor' },
  ]
}
