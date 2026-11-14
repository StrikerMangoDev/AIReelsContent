import type { StudioPackage } from './studio-api'
import type { ContentFormat } from './studio-package'

export type ProductionTeam = 'video' | 'audio' | 'graphics' | 'editor'
export type VideoTool = 'heygen' | 'omni' | 'runway'
export type HandoffOptions = { team: ProductionTeam; platform?: string; format?: ContentFormat; videoTool?: VideoTool; sceneIndex?: number; graphic?: 'cover' | 'slide'; ratio?: '9:16' | '16:9' | '4:5' | '1:1' }
export type ProductionPrompt = { title: string; tool: string; guide: string; reason: string; steps: string[]; attachments: string[]; prompt: string; narration: string; missing: string; note: string }

const plain = (text = '') => text.replace(/\s*\[C\d+\]/g, '').trim()
const section = (heading: string, text?: string) => text?.trim() ? `${heading}\n${plain(text)}` : ''
const lines = (parts: (string | undefined)[]) => parts.filter(Boolean).join('\n\n')

/** Build copy-ready instructions from saved content only. No AI calls or approval claims. */
export function buildProductionPrompt(pack: StudioPackage, options: HandoffOptions): ProductionPrompt {
  const content = pack.content
  const platform = options.platform || pack.settings.platform
  const post = content?.strategy?.platforms?.find(entry => entry.platform === platform) || (!options.platform ? content?.strategy?.platforms?.[0] : undefined)
  const production = content?.strategy?.production
  const scenes = content?.scenes || []
  const index = Math.min(Math.max(0, Math.trunc(options.sceneIndex || 0)), Math.max(0, scenes.length - 1))
  const scene = scenes[index]
  const video = !options.format || options.format === 'reel'
  const spoken = !options.format || options.format === 'reel' || options.format === 'audio'
  const narration = spoken ? plain(content?.script) : ''
  const language = content?.strategy?.language || (pack.settings.language === 'Auto' ? 'Use the saved script language' : pack.settings.language)
  const ratio = options.ratio || (options.format === 'post' || options.format === 'carousel' ? '4:5' : platform === 'YouTube' ? '16:9' : '9:16')
  const voice = pack.settings.voice && pack.settings.voice !== 'Auto' ? pack.settings.voice : content?.strategy?.voice || 'Choose a suitable licensed voice'
  const storyboard = scenes.map((entry, i) => lines([
    `Scene ${i + 1} · ${entry.timing}`,
    spoken ? section('Say:', entry.narration) : '', section('On-screen words:', entry.onScreen),
    section('Visual:', entry.visualPrompt), spoken ? section('Voice delivery:', entry.voiceDirection) : '',
  ])).join('\n\n')
  const base = { narration, attachments: ['Your logo, brand kit and any cleared reference assets, if available.'], missing: '', note: 'Prepared from saved content. Check the external result for factual accuracy, pronunciation, legibility and rights before use. External tools may charge; copying starts no generation.' }
  if (!content) return { ...base, title: 'Production prompt', tool: 'Your production tool', guide: '', reason: 'Prepare content before building assets.', steps: [], prompt: '', narration: '', missing: 'Generate and save content before preparing a production handoff.' }
  const audience = pack.settings.audience && pack.settings.audience !== 'Infer from the brief' ? pack.settings.audience : content.strategy?.audience || 'Readers interested in this topic'
  const tone = pack.settings.tone && pack.settings.tone !== 'Auto' ? pack.settings.tone : content.strategy?.delivery || 'Clear, natural and faithful to the saved copy'
  const context = `Project: ${plain(pack.title)}\nPlatform: ${platform}\nAudience: ${audience}\nLanguage: ${language}\nWriting style: ${tone}`
  const integrity = 'Use the supplied copy literally. Keep its qualifications, dates and figures. Production notes are instructions, not narration. Illustrative visuals must not be presented as real footage of the reported event. Use only cleared assets; apply an attached brand kit when supplied.'

  if (options.team === 'video') {
    if (!options.videoTool || options.videoTool === 'heygen') return {
      ...base, title: 'Complete video prompt', tool: 'HeyGen Video Agent', guide: 'https://help.heygen.com/en/articles/12402907-how-to-get-started-with-video-agent',
      reason: 'A suitable starting point for a full narrated explainer: script, scenes, voiceover and subtitles in one workflow.',
      steps: ['Open Video Agent and select Chat Mode to inspect the plan.', 'Paste the prompt into Instructions. Paste Narration only into the exact-script field.', 'Choose the orientation and voice, attach your cleared assets, then check the plan before generating.'],
      missing: narration ? '' : 'No spoken script is saved. In Setup, choose the Reel or Audio pack and generate a script first. A post caption is not substituted for narration.',
      prompt: narration ? lines([`Create a complete ${pack.settings.duration}-second narrated video in ${ratio}.`, context, integrity, `Read the exact narration below without rewriting it. Match scene pacing to the speech; preserve all words rather than cutting them to force the target duration.`, section('Exact narration:', narration), section('Scene plan:', storyboard), section('Saved video direction:', production?.videoPrompt), section('Subtitles:', production?.subtitleStyle || 'Readable captions following the exact narration; check final timing against the audio.'), section('Music:', production?.musicDirection || 'Keep the speech clear. Use cleared music only when supplied.'), section('Editing notes:', production?.editingNotes)]) : '',
    }
    const runway = options.videoTool === 'runway'
    return {
      ...base, title: `Scene ${index + 1} · single-shot prompt`, tool: runway ? 'Runway Gen-4 image-to-video' : 'Gemini Omni 1.2 Flash',
      guide: runway ? 'https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide' : 'https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-omni-1-2-flash/',
      reason: runway ? 'For animating a prepared scene image. Its prompt focuses on motion; the image supplies the appearance.' : 'For an individual illustrative shot, not a complete long video. Assemble shots with your saved voiceover afterward.',
      steps: runway ? [`Create or choose a cleared ${ratio} scene image using Graphics → Slide / scene.`, 'Upload that image to Gen-4 and paste the shot prompt. Choose 5 or 10 seconds.', 'Repeat for other scenes. Add narration and exact on-screen words in your editor.'] : ['Paste this shot prompt in the video-generation tool.', 'Choose a supported duration between 3 and 15 seconds. Split longer planned scenes into multiple shots.', 'Repeat for other scenes, then assemble them using the Editor brief and your voiceover.'],
      attachments: runway ? ['Required: a cleared input image for this scene.', 'Optional: cleared visual references for consistent appearance.'] : ['Optional: cleared character, product or style references.'],
      missing: scene?.visualPrompt?.trim() ? '' : 'No scene image brief is saved. Choose a Reel or carousel pack in Setup to generate scene directions first.',
      // Gen-4 prefers positive descriptions, without conversational instructions or negative prompts.
      prompt: scene?.visualPrompt?.trim() ? runway ? `${plain(scene.visualPrompt).replace(/[.!?]+$/, '')}. Controlled, natural subject movement. Locked camera unless the supplied scene direction specifies camera movement. Consistent visual appearance throughout the shot.` : lines([`Create one illustrative ${ratio} shot for this saved scene.`, section('Scene visual:', scene.visualPrompt), 'Use controlled movement and consistent subjects, lighting and framing. Deliver illustrative B-roll; narration and exact text will be added separately in the editor.', `The scene is planned for ${scene.timing}. This is a planning range, not a supported single-clip duration; generate short shots within the tool limit.`, integrity]) : '',
      narration: '',
    }
  }
  if (options.team === 'audio') return {
    ...base, title: 'Voiceover & recording brief', tool: 'ElevenLabs Text to Speech / your voice artist', guide: 'https://elevenlabs.io/docs/overview/capabilities/text-to-speech',
    reason: 'Use a speech tool or voice artist for the saved narration. Keep recording directions out of the spoken text.',
    steps: ['Copy Narration only into the speech tool’s Text field, or give it to your voice artist.', 'Choose a licensed voice and language. Use the recording brief to guide delivery; do not paste these instructions into the spoken-text field.', 'Listen to the full recording, correct pronunciation, and align subtitles to the actual audio.'],
    attachments: ['Optional: pronunciation notes and a cleared reference for the desired delivery.'],
    missing: narration ? '' : 'No narration script is saved. Generate the Script output first; captions and visual directions are not spoken scripts.',
    prompt: narration ? lines([context, `Voice preference: ${voice}\nTarget duration: ${pack.settings.duration} seconds. Keep all script words; adjust pacing naturally and recheck the recorded length.`, section('Delivery:', content?.strategy?.delivery || 'Clear, natural speech with pauses at sentence boundaries.'), section('Scene delivery notes:', scenes.map((entry, i) => `Scene ${i + 1}: ${plain(entry.voiceDirection)}`).join('\n')), section('Saved recording direction:', production?.audioPrompt), section('Music / sound direction (separate from narration):', production?.musicDirection), 'Speak only the separate Narration text. Check names, abbreviations and figures; do not invent pronunciation facts. Supply clean narration without unrequested background music.']) : '',
  }
  if (options.team === 'graphics') {
    const slide = options.graphic === 'slide'
    const headline = plain(slide ? scene?.onScreen : post?.headline || content?.website?.title || pack.title)
    const visual = plain(slide ? scene?.visualPrompt : post?.thumbnail)
    return {
      ...base, narration: '', title: slide ? `${options.format === 'carousel' ? 'Slide' : options.format === 'reel' ? 'Scene' : 'Slide / scene'} ${index + 1} · image brief` : options.format === 'post' ? 'Post image brief' : 'Cover / thumbnail brief', tool: 'Canva / your designer or image generator', guide: 'https://www.canva.com/create/',
      reason: 'Create the picture first, then place exact words in your design editor for reliable typography.',
      steps: ['Copy the image brief to your designer or image-generation tool. Use the selected aspect ratio.', 'Add the exact on-image words in Canva or your design editor; image models may distort lettering.', 'Check spelling, safe margins and image rights. Export the graphic and keep the attribution record.'],
      missing: slide && !scene ? 'No slide or scene is saved. Choose Cover / thumbnail, or generate scene directions in Setup.' : '',
      prompt: !slide || scene ? lines([`Design a ${ratio} ${slide ? options.format === 'carousel' ? 'carousel slide' : options.format === 'reel' ? 'video scene image' : 'scene / carousel image' : options.format === 'post' ? 'social post image' : 'cover / thumbnail'} for this project.`, context, section('Image brief:', visual || 'Create a clean editorial title card around the supplied headline, using a clear visual hierarchy and generous safe margins.'), section('Exact words to place in the design editor:', headline), 'Keep a clear text area, readable contrast and simple composition. Preserve the supplied wording. Apply the attached brand kit when provided, otherwise use a restrained neutral design.', integrity]) : '',
    }
  }
  return {
    ...base, title: 'Editor assembly brief', tool: options.format === 'audio' ? 'Your audio editor / recording team' : video ? 'Your video editor · DaVinci Resolve / Premiere / CapCut' : 'Your designer / content editor', guide: '',
    reason: 'A human-readable assembly brief, not a command that automatically runs in every editor.',
    steps: options.format === 'audio' ? ['Give the narration and this recording brief to your audio editor.', 'Record the exact words; keep music separate and check pronunciation.', 'Export clean narration and a mixed version only if requested.'] : spoken ? ['Copy this brief to your editor or editing assistant.', 'Collect the generated/recorded voiceover, scene assets and required source credits.', 'Assemble against the saved script, check the final audio and captions, then export for the selected platform.'] : ['Give this brief and the saved copy to your designer or editor.', 'Prepare the image, slide sequence or article using the supplied words and source records.', 'Check the text, layout and asset licences before posting.'],
    attachments: options.format === 'audio' ? ['Voiceover recording and pronunciation notes.', 'Cleared music, if requested, and source/rights records.'] : !spoken ? ['Saved posting, slide or article copy and source records.', 'Cleared image assets and brand kit, if required.'] : ['Voiceover recording, if the package has narration.', 'Cleared scene images/clips, cover graphic and any brand kit.', 'Source/rights records from the Studio download.'],
    prompt: content ? lines([options.format === 'audio' ? `Prepare a clean voiceover for ${platform}. Target: ${pack.settings.duration} seconds; preserve every supplied word.` : spoken ? `Assemble the supplied assets into a ${ratio} deliverable for ${platform}. Target: ${pack.settings.duration} seconds when narration is included.` : `Prepare a ${options.format === 'carousel' ? 'carousel of still images' : options.format === 'article' ? 'written article' : 'social image post'} for ${platform}${options.format === 'article' ? '.' : ` in ${ratio}.`}`, context, integrity, section('Exact narration:', narration), !options.format || options.format === 'reel' || options.format === 'carousel' ? section('Scene-by-scene assembly:', storyboard) : '', spoken && !narration ? 'No narration script is saved. This brief covers the available writing/graphics only; obtain a full script before recording a narrated video.' : '', video ? section('Video direction:', production?.videoPrompt) : '', video ? section('Subtitles:', production?.subtitleStyle || 'Follow the exact spoken words and time captions to the final audio.') : '', spoken ? section('Music:', production?.musicDirection || 'Use cleared music only when supplied; keep speech intelligible.') : '', video ? section('Editing notes:', production?.editingNotes) : '', options.format === 'article' ? section('Article:', content.website?.body) : '', section('Posting title:', post?.headline), section('Closing action:', post?.cta), 'Final check: factual wording, names/figures, legibility, sequence and asset licences. For recorded media also check pronunciation, captions and actual duration. Illustrations are not evidence. This brief does not certify the finished media.']) : '',
    missing: content ? '' : 'Generate and save content before preparing a production handoff.',
  }
}

export function productionHandoffs(pack: StudioPackage, format?: ContentFormat) {
  return { version: 'production-handoff-v1', packageId: pack.id, revision: pack.revision, format,
    video: !format || format === 'reel' ? buildProductionPrompt(pack, { team: 'video', format }) : undefined, audio: !format || format === 'reel' || format === 'audio' ? buildProductionPrompt(pack, { team: 'audio', format }) : undefined,
    graphics: format !== 'audio' ? { cover: buildProductionPrompt(pack, { team: 'graphics', format }), scenes: (!format || format === 'carousel' || format === 'reel' ? pack.content?.scenes || [] : []).map((_scene, sceneIndex) => buildProductionPrompt(pack, { team: 'graphics', graphic: 'slide', sceneIndex, format })) } : undefined,
    editor: buildProductionPrompt(pack, { team: 'editor', format }),
  }
}

export function productionHandoffMarkdown(pack: StudioPackage, format?: ContentFormat) {
  const handoffs = productionHandoffs(pack, format)
  const entries = [handoffs.video, handoffs.audio, handoffs.graphics?.cover, ...handoffs.graphics?.scenes || [], handoffs.editor].filter((entry): entry is ProductionPrompt => Boolean(entry))
  return `## Team production prompts · revision ${pack.revision}${format ? ` · ${format}` : ''}\n\n${entries.map(entry => lines([`### ${entry.title}`, `Suggested destination: ${entry.tool}`, ...entry.steps.map((step, index) => `${index + 1}. ${step}`), section('Attachments:', entry.attachments.join('\n')), entry.missing || entry.prompt, entry.narration ? section('Narration only:', entry.narration) : '', entry.note])).join('\n\n')}`
}
