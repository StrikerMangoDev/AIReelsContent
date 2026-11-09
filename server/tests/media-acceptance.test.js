import test from 'node:test'
import assert from 'node:assert/strict'
import { mediaManifest, assessMediaAcceptance, mediaReviewSchema, inspectMediaBytes, assessAutomaticMedia } from '../media/acceptance.js'
import { contentHash } from '../studio/approval.js'
import { createHash } from 'node:crypto'
import { pcmToWav } from '../media/provider.js'

function fixture() {
  const pack = { id: 'package', createdBy: 'owner', reviewerId: 'reviewer', content: { script: 'Attributed script [C1]' }, settings: { language: 'English' }, evidence: [] }
  const assets = ['first', 'second'].map(id => ({ id, kind: 'image', mime: 'image/png', bytes: 100, sha256: 'a'.repeat(64), packageId: pack.id, packageContentHash: contentHash(pack), status: 'completed', createdBy: 'owner' }))
  const now = Date.now()
  const manifest = mediaManifest(pack, assets)
  pack.mediaReview = { assetIds: assets.map(asset => asset.id), manifestHash: manifest.hash, rightsConfirmed: true, consentConfirmed: true, accessibilityConfirmed: true, playbackConfirmed: true, visualTruthConfirmed: true, note: 'Controlled test review of the actual ordered asset requirements.', status: 'passed', method: 'independent-human', reviewerId: 'reviewer', reviewedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000).toISOString() }
  pack.mediaApproval = { method: 'independent-human', approvedBy: 'owner', manifestHash: manifest.hash, approvedAt: new Date(now).toISOString() }
  return { pack, assets, now }
}

test('media review binds actual asset hashes, order and exact content version', () => {
  const { pack, assets, now } = fixture()
  assert.equal(assessMediaAcceptance(pack, assets, { now }).eligible, true)
  assert.equal(assessMediaAcceptance(pack, [...assets].reverse(), { now }).eligible, false)
  assert.equal(assessMediaAcceptance(pack, [{ ...assets[0], sha256: 'b'.repeat(64) }, assets[1]], { now }).eligible, false)
  assert.equal(assessMediaAcceptance({ ...pack, content: { script: 'Changed' } }, assets, { now }).eligible, false)
  for (const changes of [{ packageId: 'other' }, { status: 'running' }, { packageContentHash: undefined }, { createdBy: undefined }, { sha256: undefined }, { bytes: 0 }, { mime: 'text/html' }]) assert.equal(assessMediaAcceptance(pack, [{ ...assets[0], ...changes }], { now }).eligible, false)
  assert.equal(assessMediaAcceptance(pack, [assets[0], assets[0]], { now }).eligible, false)
  assert.equal(assessMediaAcceptance(pack, [], { now }).eligible, false)
})

test('media approval requires independent noncontributor, human attestations, expiry and separate owner', () => {
  const { pack, assets, now } = fixture()
  assert.equal(assessMediaAcceptance(pack, assets, { now, approval: null }).eligible, false)
  assert.equal(assessMediaAcceptance(pack, assets, { now, approval: null, requireApproval: false }).eligible, true)
  assert.equal(assessMediaAcceptance(pack, assets, { now, review: null }).eligible, false)
  assert.equal(assessMediaAcceptance(pack, assets, { now: now + 1000 }).eligible, false)
  for (const changes of [{ method: 'model' }, { rightsConfirmed: false }, { consentConfirmed: false }, { playbackConfirmed: false }, { visualTruthConfirmed: false }, { accessibilityConfirmed: false }, { note: 'short' }, { assetIds: ['first'] }, { reviewedAt: new Date(now + 1).toISOString() }, { expiresAt: new Date(now + 86400001).toISOString() }]) assert.equal(assessMediaAcceptance(pack, assets, { now, review: { ...pack.mediaReview, ...changes } }).eligible, false)
  assert.equal(assessMediaAcceptance({ ...pack, contributorUids: ['reviewer'] }, assets, { now }).eligible, false)
  assert.equal(assessMediaAcceptance(pack, assets.map(asset => ({ ...asset, createdBy: 'reviewer' })), { now }).eligible, false)
  assert.equal(assessMediaAcceptance(pack, assets, { now, approval: { ...pack.mediaApproval, approvedBy: 'reviewer' } }).eligible, false)
  assert.equal(mediaReviewSchema.safeParse({ ...pack.mediaReview, reviewerId: 'forged' }).success, false)
})

test('automatic media inspection measures actual bytes and never invents human review', () => {
  const { pack, assets } = fixture()
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#fff"/><text x="30" y="80">Source-supported illustrative card</text></svg>')
  const asset = { ...assets[0], mime: 'image/svg+xml', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), provenance: { method: 'server-local-render', rights: 'original-text-and-vectors' } }
  const inspection = inspectMediaBytes(asset, bytes)
  assert.equal(inspection.status, 'passed'); assert.equal(inspection.width, 1080); assert.equal(inspection.height, 1920)
  const outcome = assessAutomaticMedia(pack, [asset], [inspection])
  assert.equal(outcome.eligible, true); assert.equal(outcome.method, 'automated-media-v1')
  assert.equal(assessAutomaticMedia(pack, [asset], [{ ...inspection, sha256: 'b'.repeat(64) }]).eligible, false)
  assert.equal(assessAutomaticMedia(pack, [{ ...asset, provenance: null }], [inspection]).eligible, false)
  for (const xml of ['<script>alert(1)</script>', '<image href="https://example.com/a.png"/>', '<text onclick="evil()">Text</text>', '<style>@import "https://example.com/a.css"</style>', '<text style="fill:red">Text</text>', '<rect fill="u&#114;l(https://example.com/a)"/>', '<foreignObject>HTML</foreignObject>', '<?xml-stylesheet href="https://example.com/a.css"?>']) {
    const unsafe = Buffer.from(`<svg width="1080" height="1920"><text>Text</text>${xml}</svg>`)
    assert.equal(inspectMediaBytes(asset, unsafe).status, 'blocked')
  }
  assert.equal(inspectMediaBytes(asset, null).status, 'blocked')
  assert.equal(inspectMediaBytes({ ...asset, kind: 'video', mime: 'video/mp4' }, bytes).status, 'blocked')
  const wav = pcmToWav(Buffer.alloc(48000), 24000)
  const audio = inspectMediaBytes({ id: 'voice', kind: 'audio', mime: 'audio/wav' }, wav)
  assert.equal(audio.status, 'passed'); assert.equal(audio.durationSeconds, 1)
  assert.equal(audio.method, 'byte-inspection-v1')
  assert.equal(inspectMediaBytes({ id: 'voice', kind: 'audio', mime: 'audio/wav' }, wav.subarray(0, 47)).status, 'blocked')
})
