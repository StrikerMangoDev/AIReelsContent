import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { renderLocalMedia } from '../media/render.js'
import { contentHash } from '../studio/approval.js'
import { inspectMediaBytes, assessAutomaticMedia } from '../media/acceptance.js'

const pack = { id: 'local-render-test', title: 'An AI model enters preview', settings: { language: 'English' }, evidence: [{ id: 'E1', url: 'https://example.com/announcement', publisher: 'Example publisher' }], content: { claims: [{ id: 'C1', evidenceId: 'E1', text: 'The publisher announced a limited preview for developers, with access and capabilities subject to change.' }, { id: 'C2', evidenceId: 'E1', text: 'The announcement describes tool support and asks developers to review the published limitations before adoption.' }] } }

test('local renderer produces actual branded PNG and fully decoded captioned H264 video', { timeout: 120000 }, async () => {
  const png = await renderLocalMedia('image', pack)
  assert.equal(png.mime, 'image/png'); assert.equal(png.bytes.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(png.technicalReport.width, 1080); assert.equal(png.technicalReport.height, 1920)
  assert.equal(png.provenance.contentHash, contentHash(pack))
  assert.match(png.sourceSvg, /#142C38/); assert.match(png.sourceSvg, /Plus Jakarta Sans/)
  assert.equal(png.technicalReport.sha256, createHash('sha256').update(png.bytes).digest('hex'))
  const video = await renderLocalMedia('video', pack, { durationSeconds: 12 })
  assert.equal(video.mime, 'video/mp4'); assert.equal(video.bytes.toString('ascii', 4, 8), 'ftyp')
  assert.equal(video.technicalReport.fullDecodeVerified, true); assert.ok(video.technicalReport.decodedFrames >= video.technicalReport.durationSeconds * 24 - 1)
  assert.ok(video.technicalReport.durationSeconds >= 12); assert.ok(video.technicalReport.durationSeconds <= 20.1)
  assert.equal(video.technicalReport.silent, true); assert.match(video.captions.text, /00:00:00,000/)
  assert.match(video.captions.text, /limited preview/)
  const asset = { id: 'rendered-video', kind: 'video', status: 'completed', createdBy: 'owner', packageId: pack.id, packageContentHash: contentHash(pack), bytes: video.bytes.length, sha256: video.technicalReport.sha256, mime: video.mime, provenance: video.provenance, technicalReport: video.technicalReport }
  const inspection = inspectMediaBytes(asset, video.bytes)
  assert.equal(inspection.status, 'passed'); assert.equal(inspection.fullDecodeVerified, true)
  assert.equal(assessAutomaticMedia(pack, [asset], [inspection]).eligible, true)
  assert.equal(inspectMediaBytes({ ...asset, technicalReport: { ...video.technicalReport, fullDecodeVerified: false } }, video.bytes).status, 'blocked')
  assert.equal(assessAutomaticMedia(pack, [{ ...asset, provenance: { ...asset.provenance, sourceSvgHashes: ['forged'] } }], [inspection]).eligible, false)
  const altered = Buffer.from(video.bytes); altered[20] ^= 1
  assert.equal(inspectMediaBytes(asset, altered).status, 'blocked')
  await writeFile('D:/AIReelsContent/validation/local-media-render-test.png', png.bytes)
  await writeFile('D:/AIReelsContent/validation/local-media-render-test.mp4', video.bytes)
})

test('renderer rejects unsupported kinds and refuses to crop a complete long claim', async () => {
  await assert.rejects(renderLocalMedia('audio', pack))
  await assert.rejects(renderLocalMedia('image', { ...pack, content: { claims: [] } }))
  await assert.rejects(renderLocalMedia('image', { ...pack, content: { claims: [{ id: 'C1', evidenceId: 'E1', text: 'A long complete claim '.repeat(40) }] } }))
})
