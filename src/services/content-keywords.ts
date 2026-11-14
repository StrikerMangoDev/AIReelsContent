import type { StudioContent } from './studio-api'

export function keywordUsage(content: StudioContent, platform?: string) {
  const fields: { label: string; text: string }[] = []
  const add = (label: string, text?: string) => { if (text?.trim()) fields.push({ label, text: text.replace(/\[C\d+\]/g, '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ') }) }
  add('Narration', content.script)
  add('Article title', content.website?.title); add('Article body', content.website?.body)
  if (!platform || platform === 'Instagram') add('Instagram caption alternative', content.captions?.reel); if (!platform || platform === 'LinkedIn') add('LinkedIn caption alternative', content.captions?.linkedin)
  content.strategy?.platforms?.filter(post => !platform || post.platform === platform).forEach(post => { add(`${post.platform} post text`, post.body); add(`${post.platform} headline option`, post.headline); add(`${post.platform} opening option`, post.hook); add(`${post.platform} call-to-action option`, post.cta) })
  content.hooks?.forEach((hook, index) => add(`Opening option ${index + 1}`, hook))
  content.scenes?.forEach((scene, index) => add(`Scene / slide ${index + 1}`, scene.onScreen))
  return (content.strategy?.keywords || []).map(keyword => {
    const phrase = keyword.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ')
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u')
    return { keyword, locations: phrase ? fields.filter(field => pattern.test(field.text)).map(field => field.label) : [] }
  })
}

export const hashtagText = (tags: string[]) => tags.map(tag => tag.trim()).filter(Boolean).map(tag => tag.startsWith('#') ? tag : '#'+tag).join(' ')
