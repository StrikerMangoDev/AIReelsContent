import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/context/auth-state'
import { qualityDimensions, studioRead, studioRequest, type QualityDimension, type QualityRating, type StudioPackage } from '@/services/studio-api'
import { ContentPreview } from './ContentPreview'
import '@/styles/studio.css'
import '@/styles/content-workflow.css'

const ratingGuidance: Record<QualityDimension, string> = {
  relevance: 'Show how the source-backed topic serves the stated audience and brief. Audience demand remains unknown without observed audience evidence.',
  originality: 'Name the comparison you checked and the distinct contribution. Without a comparison, originality is unknown; do not claim uniqueness.',
  clarity: 'Identify the actual lines and sequence you checked for readable, understandable language.',
  hookStrength: 'Compare the opening promise with the supported content. Attention and retention benefits are hypotheses until measured.',
  brandFit: 'Name the supplied brand guidance and brief in your rationale; check voice, language and subject framing against them.',
  factualAccuracy: 'Check every material claim against the attached source passages, scope, dates and qualifications. Source count alone is not factual support.',
  cta: 'Explain how the next action fits the brief. A deliberate choice to omit a CTA can be appropriate when justified; do not invent a CTA to earn points.',
}

export function StudioReviewPage() {
  const { owner, packageId } = useParams()
  const { identity, loading } = useAuth()
  if (!identity) return loading ? <p role="status">Checking reviewer access…</p> : <section className="studio"><p>Sign in with the assigned reviewer account.</p><Link to={`/login?next=${encodeURIComponent(`/studio-review/${owner}/${packageId}`)}`}>Sign in</Link></section>
  const path = `/reviews/${encodeURIComponent(owner || '')}/${encodeURIComponent(packageId || '')}`
  return <ReviewWorkspace key={`${identity.uid}:${path}`} path={path} checkingIdentity={loading} />
}

function ReviewWorkspace({ path, checkingIdentity }: { path: string; checkingIdentity: boolean }) {
  const [item, setItem] = useState<StudioPackage | null>(null)
  const [claims, setClaims] = useState<Record<string, { supported: boolean; note: string }>>({})
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [promiseAligned, setPromiseAligned] = useState(false)
  const [freshnessConfirmed, setFreshnessConfirmed] = useState(false)
  const [contradictionsResolved, setContradictionsResolved] = useState(false)
  const [accessibilityConfirmed, setAccessibilityConfirmed] = useState(false)
  const [scopeConfirmed, setScopeConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [ratings, setRatings] = useState<Partial<Record<QualityDimension, QualityRating>>>({})
  useEffect(() => {
    let active = true
    studioRead<StudioPackage>(path).then(value => { if (active) setItem(value) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load assigned review.') })
    return () => { active = false }
  }, [path])
  async function submit() {
    if (!item?.content || checkingIdentity || busy) return
    setBusy(true); setError('')
    try {
      const reviewed = await studioRequest<StudioPackage>(path, { revision: item.revision, claims: item.content.claims.map(claim => ({ id: claim.id, supported: Boolean(claims[claim.id]?.supported), note: claims[claim.id]?.note || '' })), rightsConfirmed, promiseAligned, freshnessConfirmed, contradictionsResolved, accessibilityConfirmed, scopeConfirmed, ratings }, 'POST')
      setItem(reviewed)
      setSubmitted(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review was not saved.') } finally { setBusy(false) }
  }
  const ratingKeys = Object.keys(qualityDimensions) as QualityDimension[]
  const ratingsComplete = ratingKeys.every(key => { const rating = ratings[key]; return rating && Number.isFinite(rating.score) && rating.score >= 0 && rating.score <= 10 && rating.note.trim().length >= 20 && rating.evidenceIds.length > 0 })
  const complete = Boolean(item?.content?.claims.every(claim => claims[claim.id]?.supported && claims[claim.id]?.note.trim().length >= 10)) && rightsConfirmed && promiseAligned && freshnessConfirmed && contradictionsResolved && accessibilityConfirmed && scopeConfirmed && ratingsComplete
  function updateRating(key: QualityDimension, patch: Partial<QualityRating>) {
    setRatings(previous => ({ ...previous, [key]: { score: Number.NaN, note: '', evidenceIds: [], ...previous[key], ...patch } }))
  }

  return <section className="studio content-workflow studio-quality-review" aria-busy={busy || checkingIdentity}><Link to="/studio">← Content library</Link><header className="studio-heading"><h1>Independent evidence review</h1><p>Only the assigned reviewer can access this package. Check source support, freshness, rights and the content promise; the writer's notes are not independent verification.</p></header>
    <p role="status" aria-live="polite">{checkingIdentity ? 'Checking reviewer access… Your notes are preserved.' : ''}</p>
    {error && <p role="alert">{error}</p>}{!item && !error && <p role="status">Loading assigned package…</p>}
    {submitted ? <p role="status">{item?.independentReview?.quality?.eligible ? 'Review passed for this exact version. The owner must approve it separately. Later edits invalidate this review.' : 'Ratings recorded. This content needs revision before finalization; send the owner the evidence and changes required.'}</p> : item?.content && <><p>{item.title} · Revision {item.revision}</p><ContentPreview content={item.content} /><details className="studio-panel"><summary>Inspect the complete export content</summary><p>Review every field, including scenes, on-screen copy, captions, website text and production directions, before attesting below. This review covers the saved writing and directions; it does not certify a future rendered video or carousel.</p><pre className="preserve-lines" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(item.content, null, 2)}</pre></details>
      <form className="studio-panel" onSubmit={event => { event.preventDefault(); void submit() }}><fieldset disabled={busy || checkingIdentity}><legend>Claim-by-claim evidence check</legend>
        {item.content.claims.map(claim => { const source = item.evidence.find(value => value.id === claim.evidenceId); return <article key={claim.id} className="studio-evidence"><h2>{claim.id}: {claim.text}</h2><blockquote>{claim.quote}</blockquote>{source && <><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>Retrieved {new Date(source.retrievedAt).toLocaleString()} · {source.type}</p><p>{source.limitations.join(' ')}</p><details><summary>Captured source passage</summary><blockquote>{source.excerpt}</blockquote></details></>}<label className="studio-check"><input type="checkbox" checked={Boolean(claims[claim.id]?.supported)} onChange={event => setClaims(previous => ({ ...previous, [claim.id]: { note: previous[claim.id]?.note || '', supported: event.target.checked } }))} />I checked that the source supports this claim in context and is sufficiently current.</label><label>Review rationale<textarea required minLength={10} maxLength={1000} value={claims[claim.id]?.note || ''} onChange={event => setClaims(previous => ({ ...previous, [claim.id]: { supported: previous[claim.id]?.supported || false, note: event.target.value } }))} /></label></article> })}
        <label className="studio-check"><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} />I checked source and asset usage rights.</label><label className="studio-check"><input type="checkbox" checked={promiseAligned} onChange={event => setPromiseAligned(event.target.checked)} />Titles, hooks and thumbnail promises match the content and evidence.</label>
        <label className="studio-check"><input type="checkbox" checked={freshnessConfirmed} onChange={event => setFreshnessConfirmed(event.target.checked)} />I opened the current sources and rechecked time-sensitive claims. This review expires in 24 hours; it does not guarantee that sources will remain unchanged.</label>
        <label className="studio-check"><input type="checkbox" checked={contradictionsResolved} onChange={event => setContradictionsResolved(event.target.checked)} />I checked conflicting evidence. No unresolved contradiction makes this package misleading; uncertainty is clearly stated.</label>
        <label className="studio-check"><input type="checkbox" checked={accessibilityConfirmed} onChange={event => setAccessibilityConfirmed(event.target.checked)} />I checked readability, language and accessibility requirements in the saved writing and directions.</label>
        <label className="studio-check"><input type="checkbox" checked={scopeConfirmed} onChange={event => setScopeConfirmed(event.target.checked)} />I checked the intended audience, brand, platforms and selected formats. This is a text-package review; future rendered media still needs review.</label>
      </fieldset>
      <fieldset disabled={busy || checkingIdentity}><legend>Evidence-based quality ratings</legend><p>Rate each dimension from 0 to 10 and identify the exact content and sources behind your judgment. No score means unrated. A linked source alone does not prove quality.</p><p>0–3: unsupported or unusable · 4–5: major revision · 6–7: adequate with limitations · 8–9: strong and supported · 10: exceptional with a clear rationale. Finalization requires an average of at least 8, every score at least 6, and factual support at least 8. These editorial thresholds do not predict reach.</p>
        {ratingKeys.map(key => { const rating = ratings[key]; return <section className="studio-evidence" key={key}><h2>{qualityDimensions[key]}</h2><p>{ratingGuidance[key]}</p><label>Score out of 10<input name={`rating-${key}`} type="number" min={0} max={10} step="any" required value={Number.isFinite(rating?.score) ? rating!.score : ''} onChange={event => updateRating(key, { score: event.target.value === '' ? Number.NaN : Number(event.target.value) })} /></label><label>Evidence and rationale<textarea name={`rationale-${key}`} required minLength={20} maxLength={1500} value={rating?.note || ''} onChange={event => updateRating(key, { note: event.target.value })} /></label><fieldset><legend>Supporting sources for {qualityDimensions[key].toLowerCase()}</legend>{item.evidence.map(source => <label key={source.id}><input type="checkbox" checked={Boolean(rating?.evidenceIds.includes(source.id))} onChange={event => updateRating(key, { evidenceIds: event.target.checked ? [...(rating?.evidenceIds || []), source.id] : (rating?.evidenceIds || []).filter(id => id !== source.id) })} />{source.id} · {source.title}</label>)}</fieldset></section> })}
      </fieldset><p>Leave checks unconfirmed if support is missing. Resolve claim, rights and contradiction blockers before recording a rating review. Below-threshold ratings are saved as needing revision.</p>{!complete && <p role="status">Complete every claim check, confirmation, rating, rationale and supporting source to record the review.</p>}<button disabled={busy || checkingIdentity || !complete}>Record independent review</button></form>
    </>}
  </section>
}
