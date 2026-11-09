import { Resvg } from '@resvg/resvg-js'
import ffmpeg from 'ffmpeg-static'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { contentHash } from '../studio/approval.js'

const execute = promisify(execFile)
const rendererVersion = 'editorial-local-v1'
const fonts = ['plus-jakarta-sans.ttf', 'source-sans-3.ttf'].map(name => fileURLToPath(new URL(`../../public/fonts/${name}`, import.meta.url)))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const clean = text => String(text || '').replace(/\s*\[C\d+\]/g, '').replace(/\s+/g, ' ').trim()
const xml = text => clean(text).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
function lines(text, width, maximum) {
  const result = []; let line = ''
  for (const word of clean(text).split(' ')) {
    if (word.length > width) throw new Error('Shorten long words before rendering this social card.')
    if (line && line.length + word.length + 1 > width) { result.push(line); line = word } else line += `${line ? ' ' : ''}${word}`
  }
  if (line) result.push(line)
  if (result.length > maximum) throw new Error('Shorten this content before rendering; complete claims are never cropped.')
  return result
}
const textRows = (rows, x, y, size, step, family, fill, weight = 400) => rows.map((row, index) => `<text x="${x}" y="${y + index * step}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${xml(row)}</text>`).join('')

function card(pack, claim, index, count) {
  const title = pack.content?.website?.title || pack.title || 'Research briefing'
  const source = pack.evidence.find(item => item.id === claim.evidenceId)
  if (!source) throw new Error('A rendered claim must have its saved source.')
  const publisher = source.publisher || new URL(source.url).hostname
  const titleLines = lines(title, 25, 5)
  const bodyLines = lines(claim.text, 34, 10)
  const sourceLines = lines(`${publisher} · ${claim.id}`, 43, 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#F6F8FA"/><rect width="1080" height="234" fill="#142C38"/><text x="80" y="108" font-family="Plus Jakarta Sans" font-size="52" font-weight="700" fill="#FFFFFF">AIReels</text><text x="80" y="158" font-family="Source Sans 3" font-size="38" font-weight="600" fill="#D7EEE8">Content</text><text x="1000" y="112" text-anchor="end" font-family="Source Sans 3" font-size="36" fill="#FFFFFF">${index + 1} / ${count}</text><rect x="56" y="290" width="968" height="1272" rx="12" fill="#FFFFFF"/><rect x="80" y="338" width="8" height="54" fill="#2344C7"/><text x="112" y="378" font-family="Source Sans 3" font-size="34" fill="#566176">A sourced perspective</text>${textRows(titleLines, 80, 492, 68, 82, 'Plus Jakarta Sans', '#142C38', 700)}${textRows(bodyLines, 80, 990, 48, 62, 'Source Sans 3', '#142C38')}<rect x="56" y="1610" width="968" height="230" rx="12" fill="#D7EEE8"/><text x="80" y="1668" font-family="Source Sans 3" font-size="34" font-weight="600" fill="#0F766E">Publisher-attributed · read the source</text>${textRows(sourceLines, 80, 1724, 38, 48, 'Source Sans 3', '#142C38')}<text x="80" y="1810" font-family="Source Sans 3" font-size="30" fill="#566176">Original text layout · illustrative, not documentary</text></svg>`
}

function stamp(seconds) {
  const milliseconds = Math.round(seconds * 1000)
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`
}

export async function renderLocalMedia(kind, pack, { durationSeconds = 18 } = {}) {
  if (!['image', 'video'].includes(kind) || !pack?.content?.claims?.length) throw new Error('Choose an image or captioned video with saved attributed claims.')
  const claims = []; let words = 0
  for (const claim of pack.content.claims) {
    const length = clean(claim.text).split(' ').length
    if (length > 48 || clean(claim.text).length > 330 || words + length > 48) continue
    claims.push(claim); words += length
    if (claims.length === (kind === 'image' ? 1 : 3)) break
  }
  if (!claims.length) throw new Error('Create a complete source-backed claim under 49 words before rendering.')
  const svgs = claims.map((claim, index) => card(pack, claim, index, claims.length))
  const frames = svgs.map(svg => {
    const renderer = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: fonts, defaultFontFamily: 'Source Sans 3' } })
    if (renderer.imagesToResolve().length) throw new Error('External images are not allowed in local rendering.')
    const rendered = renderer.render()
    if (rendered.width !== 1080 || rendered.height !== 1920 || !rendered.pixels.length) throw new Error('The rendered frame has invalid dimensions.')
    return rendered.asPng()
  })
  const provenance = { method: 'server-local-render', rights: 'original-text-and-vectors', rendererVersion, contentHash: contentHash(pack), sourceSvgHashes: svgs.map(hash), fonts: ['Plus Jakarta Sans', 'Source Sans 3'], silent: true, limitations: ['No voiceover, music, stock footage or documentary imagery.', 'Publisher-attributed text; rendering is not independent fact verification.'] }
  if (kind === 'image') {
    const bytes = frames[0]
    return { bytes, mime: 'image/png', provenance, technicalReport: { method: 'server-render-verification-v1', rendererVersion, sha256: hash(bytes), bytes: bytes.length, mime: 'image/png', width: 1080, height: 1920, frameRenderVerified: true, sourceSvgHashes: provenance.sourceSvgHashes, contentHash: provenance.contentHash }, captions: { format: 'text', text: claims[0].text }, sourceSvg: svgs[0] }
  }
  if (!ffmpeg) throw new Error('The local MP4 encoder is unavailable.')
  const seconds = Math.min(20, Math.max(8, Math.ceil(words / 2.5), Number.isFinite(durationSeconds) ? durationSeconds : 18))
  const directory = await mkdtemp(join(tmpdir(), 'aireels-render-'))
  if (!relative(resolve(tmpdir()), directory) || relative(resolve(tmpdir()), directory).startsWith('..')) throw new Error('Temporary media path is outside the expected directory.')
  try {
    await Promise.all(frames.map((frame, index) => writeFile(join(directory, `frame-${index}.png`), frame)))
    const duration = seconds / claims.length
    await writeFile(join(directory, 'frames.txt'), `${frames.map((_frame, index) => `file 'frame-${index}.png'\nduration ${duration}`).join('\n')}\nfile 'frame-${frames.length - 1}.png'\n`)
    await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '1', '-i', 'frames.txt', '-t', String(seconds), '-vf', 'fps=24,format=yuv420p', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-crf', '24', '-movflags', '+faststart', '-an', 'output.mp4'], { cwd: directory, timeout: 90000, maxBuffer: 1024 * 1024, windowsHide: true })
    const decoded = await execute(ffmpeg, ['-hide_banner', '-i', 'output.mp4', '-map', '0:v:0', '-f', 'null', '-', '-progress', 'pipe:1'], { cwd: directory, timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true })
    const measured = [...decoded.stdout.matchAll(/out_time_us=(\d+)/g)].at(-1)
    const decodedSeconds = measured ? Number(measured[1]) / 1000000 : 0
    const decodedFrames = Number([...decoded.stdout.matchAll(/frame=(\d+)/g)].at(-1)?.[1] || 0)
    if (!/Video: h264[^\r\n]*1080x1920/.test(decoded.stderr) || decodedSeconds < seconds - 0.15 || decodedSeconds > seconds + 0.15 || decodedFrames < seconds * 24 - 1 || !/progress=end/.test(decoded.stdout)) throw new Error('The encoded MP4 failed full-frame decode verification.')
    const bytes = await readFile(join(directory, 'output.mp4'))
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Rendered video exceeds the storage limit.')
    const subtitles = claims.map((claim, index) => `${index + 1}\n${stamp(index * duration)} --> ${stamp((index + 1) * duration)}\n${claim.text}`).join('\n\n')
    return { bytes, mime: 'video/mp4', provenance, technicalReport: { method: 'server-render-verification-v1', rendererVersion, sha256: hash(bytes), bytes: bytes.length, mime: 'video/mp4', width: 1080, height: 1920, durationSeconds: decodedFrames / 24, lastFrameSeconds: decodedSeconds, decodedFrames, fullDecodeVerified: true, captionsRendered: true, silent: true, sourceSvgHashes: provenance.sourceSvgHashes, contentHash: provenance.contentHash }, captions: { format: 'srt', text: subtitles }, sourceSvg: svgs[0] }
  } finally {
    if (relative(resolve(tmpdir()), directory).startsWith('aireels-render-')) await rm(directory, { recursive: true, force: true })
  }
}
