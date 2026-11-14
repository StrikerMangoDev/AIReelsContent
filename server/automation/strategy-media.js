import { createHash } from 'node:crypto'
import { contentHash } from '../studio/approval.js'
import { costScopeHash } from '../budget/policy.js'
import { assessAutomaticMedia } from '../media/acceptance.js'
import { assessAutomaticText } from './review.js'
import { automaticStrategyMediaVersion, automaticStrategyChecks, automaticStrategyMediaId, automaticAssetEvidenceHash, currentAutomaticStrategyMedia } from '../media/strategy-evidence.js'

const digest = value => createHash('sha256').update(value).digest('hex')
const clean = text => String(text || '').replace(/\s*\[C\d+\]/g, '').replace(/\s+/g, ' ').trim()

export function assessAutomaticStrategyMedia(pack, profile, assets, inspections, { now = Date.now() } = {}) {
  const text = assessAutomaticText(pack, profile, { now })
  const media = assessAutomaticMedia(pack, assets, inspections)
  const issues = [...text.issues, ...media.issues]
  const rendered = assets.flatMap(asset => asset.technicalReport?.layoutVerification?.renderedClaims || [])
  const layouts = assets.length > 0 && assets.every(asset => {
    const layout = asset.technicalReport?.layoutVerification
    return layout?.method === 'bounded-editorial-layout-v1' && layout.externalAssets === false && layout.width === 1080 && layout.height === 1920 && layout.mainTextSize >= 48 && layout.mainTextMaximumLines <= 10 && layout.horizontalTextMargin >= 80 && layout.completeTextRequired === true && layout.renderedClaims?.length > 0
  })
  const matchedClaims = rendered.length > 0 && rendered.every(renderedClaim => {
    const claim = pack.content?.claims?.find(item => item.id === renderedClaim.id && item.evidenceId === renderedClaim.evidenceId)
    const source = pack.evidence?.find(item => item.id === renderedClaim.evidenceId)
    return claim && source && /^[a-f0-9]{64}$/.test(source.hash || '') && source.hash === renderedClaim.sourceHash && digest(clean(claim.text)) === renderedClaim.textHash
  })
  const captions = assets.every(asset => asset.provenance?.silent === true && asset.captions?.text && (asset.kind === 'image' ? asset.captions.format === 'text' : asset.captions.format === 'srt' && asset.technicalReport?.captionsRendered === true))
  const usedSources = (pack.evidence || []).filter(source => pack.content?.claims?.some(claim => claim.evidenceId === source.id))
  const fresh = usedSources.length > 0 && usedSources.every(source => Date.parse(source.retrievedAt) <= now && now - Date.parse(source.retrievedAt) <= 86400000)
  const publicCopy = JSON.stringify({ industry: pack.settings?.industry, claims: pack.content?.claims, platforms: pack.content?.strategy?.platforms })
  const aiSubject = /\bAI\b|artificial intelligence|machine learning/i.test(`${pack.settings?.industry || ''} ${(profile?.contentPillars || []).join(' ')}`)
  const sensitive = /\b(?:medic(?:al|ine)|health|clinical|diagnos\w*|treat\w*|therap\w*|finance|financial|invest\w*|stocks?|trading|credit|mortgage|legal|lawsuit|court|election\w*|politic\w*|self.harm|suicid\w*|child\w*|sexual\w*|violence|weapons?|crime|religio\w*)\b/i.test(publicCopy)
  const checks = { editorialReview: text.eligible, originalLayout: media.eligible && matchedClaims, boundedLayout: layouts, soundOffText: layouts && matchedClaims && captions, originalAssetRights: media.eligible && assets.every(asset => asset.provenance?.rights === 'original-text-and-vectors'), sourceCaptureCurrent: fresh, lowRiskScope: aiSubject && !sensitive }
  for (const key of automaticStrategyChecks) if (!checks[key]) issues.push(`Automatic strategy check did not pass ${key}.`)
  return {
    version: automaticStrategyMediaVersion, method: 'server-machine-assessment', packageId: pack.id, platform: profile?.platform || null, accountId: profile?.accountId || null,
    eligible: issues.length === 0, contentHash: contentHash(pack), profileHash: costScopeHash(profile, null), manifestHash: media.manifest?.hash || null,
    assets: media.manifest?.assets || [], checkedAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(now + 86400000, Date.parse(pack.automaticReview?.expiresAt) || now)).toISOString(),
    editorialReviewId: pack.automaticReview?.runId || null, editorialReviewHash: costScopeHash(pack.automaticReview, null), assetEvidenceHash: automaticAssetEvidenceHash(assets), checks, issues: [...new Set(issues)],
    limitations: ['Machine checks of actual server-rendered original text/vector assets and a separate automated editorial assessment; not a human review or subject-expert approval.', 'Fixed-layout bounds, complete text and silent captions are checked. Actual phone playback, subjective visual quality and audience performance are not established.', 'Current-event checking is limited to fresh captured sources and a conservative low-risk AI topic screen; legal, medical, financial and sensitive topics remain held.', 'No workspace preview, accessibility, rights or expert-review attestation was automatically checked or renewed.'],
  }
}

export async function recordAutomaticStrategyMedia(repository, owner, pack, profile, assets, inspections, options) {
  const assessment = assessAutomaticStrategyMedia(pack, profile, assets, inspections, options)
  const id = automaticStrategyMediaId(pack.id, profile.platform, profile.accountId)
  const current = await repository.studioGet(owner, 'automatic_strategy_media', id)
  if (assessment.eligible && currentAutomaticStrategyMedia(current, pack, profile, assets, options)) return current
  return repository.studioPut(owner, 'automatic_strategy_media', id, assessment, current?.revision || 0)
}
