import { createHash } from 'node:crypto'
import { z } from 'zod'
import { contentHash, contributors } from '../studio/approval.js'
import { load } from 'cheerio'

const assetId = z.string().min(1).max(100)
export const mediaReviewSchema = z.object({
  assetIds: z.array(assetId).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  rightsConfirmed: z.literal(true), consentConfirmed: z.literal(true), accessibilityConfirmed: z.literal(true),
  playbackConfirmed: z.literal(true), visualTruthConfirmed: z.literal(true), note: z.string().trim().min(20).max(3000),
}).strict()

export function mediaManifest(pack, assets) {
  if (!pack?.id || !pack.content || !Array.isArray(assets) || !assets.length || assets.length > 20 || new Set(assets.map(asset => asset.id)).size !== assets.length) throw new Error('Select distinct completed assets for this package.')
  const version = contentHash(pack)
  const supported = { image: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], audio: ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg'], video: ['video/mp4', 'video/webm'] }
  const ordered = assets.map(asset => {
    if (!asset.id || asset.packageId !== pack.id || asset.packageContentHash !== version || asset.status !== 'completed'
      || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !Number.isInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 32 * 1024 * 1024
      || !supported[asset.kind]?.includes(asset.mime) || typeof asset.createdBy !== 'string' || !asset.createdBy) throw new Error('Media is incomplete, unbound or belongs to a different content version.')
    return { id: asset.id, sha256: asset.sha256, mime: asset.mime, bytes: asset.bytes, kind: asset.kind }
  })
  const manifest = { scope: 'rendered-media', packageId: pack.id, contentHash: version, assets: ordered }
  return { ...manifest, hash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') }
}

// Text approval and current workspace permissions are additional release gates.
export function assessMediaAcceptance(pack, assets, { review = pack?.mediaReview, approval = pack?.mediaApproval, now = Date.now(), requireApproval = true } = {}) {
  let manifest
  try { manifest = mediaManifest(pack, assets) }
  catch (error) { return { eligible: false, issues: [error.message], manifest: null } }
  const issues = []
  const submitted = review && Object.fromEntries(Object.keys(mediaReviewSchema.shape).map(key => [key, review[key]]))
  const parsed = mediaReviewSchema.safeParse(submitted)
  const reviewedAt = Date.parse(review?.reviewedAt || '')
  const expiresAt = Date.parse(review?.expiresAt || '')
  const contributorsToMedia = new Set([...contributors(pack), ...assets.map(asset => asset.createdBy)])
  if (!parsed.success || review?.status !== 'passed' || review?.method !== 'independent-human'
    || !review?.reviewerId || review.reviewerId !== pack.reviewerId || contributorsToMedia.has(review.reviewerId)
    || review.manifestHash !== manifest.hash || JSON.stringify(review.assetIds) !== JSON.stringify(manifest.assets.map(asset => asset.id))
    || !(reviewedAt <= now && expiresAt > now && expiresAt <= reviewedAt + 86400000)) issues.push('A current independent human review of these exact ordered media assets is required.')
  if (requireApproval && (approval?.method !== 'independent-human' || !approval?.approvedBy || approval.approvedBy === review?.reviewerId
    || approval.manifestHash !== manifest.hash || !(Date.parse(approval.approvedAt || '') >= reviewedAt && Date.parse(approval.approvedAt || '') <= now))) issues.push('Separate owner approval of the reviewed media version is required.')
  return { eligible: issues.length === 0, issues, manifest }
}

export function inspectMediaBytes(asset, bytes, now = Date.now()) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.alloc(0)
  const report = { method: 'byte-inspection-v1', assetId: asset.id, sha256: createHash('sha256').update(bytes).digest('hex'), inspectedAt: new Date(now).toISOString(), mime: asset.mime, bytes: bytes.length, status: 'blocked', issues: [], limitations: ['Technical inspection does not establish semantic truth, subjective visual quality or observed playback.'] }
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 32 * 1024 * 1024) return { ...report, issues: ['Media bytes are missing or exceed the storage limit.'] }
  if (asset.mime === 'image/svg+xml' && asset.kind === 'image') {
    const svg = bytes.toString('utf8')
    const doc = load(svg, { xmlMode: true }); const root = doc('svg')
    if (root.length !== 1 || doc('script,style,foreignObject,image,iframe,object,embed,animate,animateTransform,set').length || /<!DOCTYPE|<!ENTITY|xml-stylesheet|@import|@font-face|url\s*\(/i.test(svg)) return { ...report, issues: ['SVG contains unsupported active or externally sourced content.'] }
    const unsafe = doc('*').toArray().some(element => Object.entries(element.attribs || {}).some(([name, value]) => /^on|href$|^style$/i.test(name) || /:href$/i.test(name) || /url\s*\(|\\|@/i.test(value)))
    if (unsafe) return { ...report, issues: ['SVG contains active handlers or external references.'] }
    const width = Number(root.attr('width')); const height = Number(root.attr('height'))
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 8192 || height > 8192 || !doc('text').text().trim()) return { ...report, issues: ['SVG needs finite dimensions and readable text content.'] }
    return { ...report, status: 'passed', width, height, text: doc('text').text().slice(0, 12000) }
  }
  if (asset.mime === 'image/png' && asset.kind === 'image' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20)
    if (width > 0 && height > 0 && width <= 8192 && height <= 8192) return { ...report, status: 'passed', width, height, limitations: [...report.limitations, 'PNG header inspection does not certify full image decoding or text readability.'] }
  }
  if (asset.mime === 'audio/wav' && asset.kind === 'audio' && bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    let format; let length
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const chunk = bytes.toString('ascii', offset, offset + 4); const size = bytes.readUInt32LE(offset + 4)
      if (size > bytes.length - offset - 8) return { ...report, issues: ['WAV chunk exceeds actual bytes.'] }
      if (chunk === 'fmt ' && size >= 16) format = { encoding: bytes.readUInt16LE(offset + 8), channels: bytes.readUInt16LE(offset + 10), rate: bytes.readUInt32LE(offset + 12), byteRate: bytes.readUInt32LE(offset + 16), bits: bytes.readUInt16LE(offset + 22) }
      if (chunk === 'data') length = size
      offset += 8 + size + size % 2
    }
    if (format?.encoding === 1 && [1, 2].includes(format.channels) && [8, 16, 24, 32].includes(format.bits) && format.rate >= 8000 && format.rate <= 96000 && format.byteRate === format.rate * format.channels * format.bits / 8 && length > 0) return { ...report, status: 'passed', durationSeconds: length / format.byteRate, sampleRate: format.rate, channels: format.channels, limitations: [...report.limitations, 'No transcript alignment, pronunciation or subjective listening check was performed.'] }
  }
  const technical = asset.technicalReport
  if (asset.kind === 'video' && asset.mime === 'video/mp4' && bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
    && technical?.method === 'server-render-verification-v1' && technical.rendererVersion === 'editorial-local-v1' && technical.sha256 === report.sha256 && technical.bytes === bytes.length && technical.mime === asset.mime
    && technical.fullDecodeVerified === true && technical.captionsRendered === true && technical.width === 1080 && technical.height === 1920 && technical.durationSeconds >= 8 && technical.durationSeconds <= 20.1 && technical.decodedFrames >= technical.durationSeconds * 24 - 1) {
    return { ...report, status: 'passed', width: technical.width, height: technical.height, durationSeconds: technical.durationSeconds, decodedFrames: technical.decodedFrames, fullDecodeVerified: true, captionsRendered: true, silent: true, limitations: ['Actual bytes match the stored full-decode server report. Silent captioned slideshow; no narration or subjective visual approval is claimed.'] }
  }
  return { ...report, issues: ['This media format needs a trusted decoder or a supported technical inspection before automatic acceptance.'] }
}

// This is technical machine acceptance, never a human review or text approval.
export function assessAutomaticMedia(pack, assets, inspections, { policyVersion = 'automated-media-v1' } = {}) {
  let manifest
  try { manifest = mediaManifest(pack, assets) }
  catch (error) { return { eligible: false, method: policyVersion, issues: [error.message], manifest: null } }
  const issues = []
  for (const asset of assets) {
    const inspection = inspections?.find(item => item.assetId === asset.id)
    if (!inspection || inspection.method !== 'byte-inspection-v1' || inspection.status !== 'passed' || inspection.sha256 !== asset.sha256 || inspection.bytes !== asset.bytes || inspection.mime !== asset.mime) issues.push(`${asset.id}: a matching inspection of actual bytes is required.`)
    const derivative = ['image/png', 'video/mp4'].includes(asset.mime) && asset.technicalReport?.method === 'server-render-verification-v1'
      && asset.technicalReport.rendererVersion === 'editorial-local-v1' && asset.technicalReport.sha256 === asset.sha256 && asset.technicalReport.bytes === asset.bytes
      && asset.technicalReport.contentHash === manifest.contentHash && asset.provenance?.contentHash === manifest.contentHash
      && JSON.stringify(asset.provenance?.sourceSvgHashes) === JSON.stringify(asset.technicalReport.sourceSvgHashes)
      && Array.isArray(asset.technicalReport.sourceSvgHashes) && asset.technicalReport.sourceSvgHashes.length > 0 && asset.technicalReport.sourceSvgHashes.every(value => /^[a-f0-9]{64}$/.test(value))
      && (asset.mime === 'image/png' ? asset.technicalReport.frameRenderVerified === true : asset.technicalReport.fullDecodeVerified === true && asset.technicalReport.captionsRendered === true)
    if (asset.provenance?.method !== 'server-local-render' || asset.provenance?.rights !== 'original-text-and-vectors' || (asset.mime !== 'image/svg+xml' && !derivative)) issues.push(`${asset.id}: automatic rights clearance is available only for original server-rendered text and vector derivatives.`)
  }
  return { eligible: issues.length === 0, method: policyVersion, issues, manifest, limitations: ['Automatic technical acceptance; semantic, visual-quality and audience-performance guarantees are not established.', 'Text release authorization and current workspace permissions remain separate requirements.'] }
}
