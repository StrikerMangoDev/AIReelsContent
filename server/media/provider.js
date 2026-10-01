import { GoogleGenAI, GenerateVideosOperation } from '@google/genai'
import { env } from '../config/env.js'

export function mediaConfig() {
  return Object.fromEntries(['image', 'audio', 'video'].map(kind => {
    const model = process.env[`STUDIO_${kind.toUpperCase()}_MODEL`]
    const price = process.env[`STUDIO_${kind.toUpperCase()}_ESTIMATE_USD`]
    const estimatedUsd = price === undefined ? null : Number(price)
    return [kind, { enabled: Boolean(env.GOOGLE_CLOUD_PROJECT && model && estimatedUsd !== null && Number.isFinite(estimatedUsd) && estimatedUsd >= 0 && (env.STORAGE_PROVIDER !== 'supabase' || process.env.STUDIO_MEDIA_BUCKET)), estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : null }]
  }))
}

function client() {
  return new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: process.env.STUDIO_MEDIA_LOCATION || env.GOOGLE_CLOUD_LOCATION,
    googleAuthOptions: env.GOOGLE_SERVICE_ACCOUNT_JSON ? { credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) } : { keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS }, httpOptions: { timeout: 120000 } })
}

export function pcmToWav(bytes, rate = 24000) {
  if (!bytes.length || bytes.length % 2 || !Number.isInteger(rate) || rate < 8000 || rate > 96000) throw new Error('Invalid audio format')
  const header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(bytes.length + 36, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(bytes.length, 40)
  return Buffer.concat([header, bytes])
}

export function videoResult(operation) {
  if (operation.error) throw Object.assign(new Error('Video provider rejected generation'), { code: 'MEDIA_TERMINAL' })
  if (!operation.done) {
    if (!operation.name) throw new Error('Video provider returned no operation')
    return { operation: operation.name }
  }
  const video = operation.response?.generatedVideos?.[0]?.video
  if (!video?.videoBytes) throw Object.assign(new Error('Video provider returned no downloadable bytes; configure a model supporting inline output'), { code: 'MEDIA_TERMINAL' })
  return { bytes: Buffer.from(video.videoBytes, 'base64'), mime: 'video/mp4' }
}

export async function generateMedia(kind, prompt) {
  const ai = client()
  const model = process.env[`STUDIO_${kind.toUpperCase()}_MODEL`]
  if (kind === 'video') return videoResult(await ai.models.generateVideos({ model, prompt, config: { numberOfVideos: 1, durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: true } }))
  if (kind === 'image') {
    const result = await ai.models.generateImages({ model, prompt, config: { numberOfImages: 1, aspectRatio: '9:16', outputMimeType: 'image/png' } })
    const image = result.generatedImages?.[0]?.image
    if (!image?.imageBytes) throw new Error('Image provider returned no image')
    return { bytes: Buffer.from(image.imageBytes, 'base64'), mime: 'image/png' }
  }
  const result = await ai.models.generateContent({ model, contents: prompt, config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.STUDIO_VOICE || 'Kore' } } } } })
  const audio = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.mimeType?.startsWith('audio/'))?.inlineData
  if (!audio?.data) throw new Error('Speech provider returned no audio')
  if (audio.mimeType === 'audio/wav') return { bytes: Buffer.from(audio.data, 'base64'), mime: 'audio/wav' }
  if (!/^audio\/(L16|pcm)/i.test(audio.mimeType)) throw new Error('Unsupported speech encoding')
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] || 24000)
  return { bytes: pcmToWav(Buffer.from(audio.data, 'base64'), rate), mime: 'audio/wav' }
}

export async function refreshVideo(name) {
  const operation = new GenerateVideosOperation()
  operation.name = name
  return videoResult(await client().operations.getVideosOperation({ operation }))
}
