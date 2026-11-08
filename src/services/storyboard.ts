import type { StudioContent, StudioProfile } from './studio-api'

export function storyboardFromScript(script: string): NonNullable<StudioContent['scenes']> {
  const sentences = script.trim().split(/(?<=[.!?])\s+(?=[A-Z])|\n{2,}/).filter(Boolean)
  const cited: string[] = []
  for (const sentence of sentences) {
    if (cited.length && (!/\[C\d+\]/.test(sentence) || !/\[C\d+\]/.test(cited[cited.length - 1]))) cited[cited.length - 1] += ` ${sentence}`
    else cited.push(sentence)
  }
  const parts = cited.length > 20 ? [...cited.slice(0, 19), cited.slice(19).join(' ')] : cited
  return parts.map((narration, index) => ({ timing: `Slide ${index + 1} — timing not set`, narration, onScreen: narration, visualPrompt: 'Text-only slide using the saved narration. No image has been generated.', voiceDirection: 'Read the saved narration.' }))
}

export function prepareStoryboard(content: StudioContent, profile: StudioProfile): StudioContent {
  const production = { videoPrompt: 'Text-only slides from the saved narration. No images or video requested.', audioPrompt: 'No audio requested. Keep the saved narration for reference.', musicDirection: 'No music.', subtitleStyle: 'Readable text with high contrast.', editingNotes: 'Review slide length and timing before any media production.' }
  return { ...content, scenes: storyboardFromScript(content.script || '').map(scene => content.scenes?.find(saved => saved.narration === scene.narration) || scene), strategy: { ...(content.strategy || {
    angle: 'Present the saved, cited narration as text slides.', audience: profile.audience,
    whyNow: 'No trend claim is made by this manual layout.', factCheck: 'Keep the existing claims and complete independent review.',
    language: profile.language === 'Hindi' || profile.language === 'Hinglish' ? profile.language : 'English', languageReason: 'Draft setting only; verify the language before production.',
    voice: profile.voice === 'Male' ? 'Male' : 'Female', voiceReason: 'No audio requested. Review the voice choice before audio production.',
    delivery: 'Text-only carousel.', keywords: ['source review'],
  }), production: content.strategy?.production || production } }
}
