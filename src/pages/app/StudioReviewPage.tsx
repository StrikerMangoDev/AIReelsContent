import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/context/auth-state'
import { studioRead, studioRequest, type StudioPackage } from '@/services/studio-api'
import { ContentPreview } from './ContentPreview'
import '@/styles/studio.css'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    let active = true
    studioRead<StudioPackage>(path).then(value => { if (active) setItem(value) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load assigned review.') })
    return () => { active = false }
  }, [path])
  async function submit() {
    if (!item?.content || checkingIdentity || busy) return
    setBusy(true); setError('')
    try {
      await studioRequest(path, { revision: item.revision, claims: item.content.claims.map(claim => ({ id: claim.id, supported: Boolean(claims[claim.id]?.supported), note: claims[claim.id]?.note || '' })), rightsConfirmed, promiseAligned, freshnessConfirmed, contradictionsResolved }, 'POST')
      setSubmitted(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review was not saved.') } finally { setBusy(false) }
  }
  const complete = Boolean(item?.content?.claims.every(claim => claims[claim.id]?.supported && claims[claim.id]?.note.trim().length >= 10)) && rightsConfirmed && promiseAligned && freshnessConfirmed && contradictionsResolved

  return <section className="studio" aria-busy={busy || checkingIdentity}><Link to="/studio">← Content library</Link><header className="studio-heading"><h1>Independent evidence review</h1><p>Only the assigned reviewer can access this package. Check source support, freshness, rights and the content promise; the writer's notes are not independent verification.</p></header>
    <p role="status" aria-live="polite">{checkingIdentity ? 'Checking reviewer access… Your notes are preserved.' : ''}</p>
    {error && <p role="alert">{error}</p>}{!item && !error && <p role="status">Loading assigned package…</p>}
    {submitted ? <p role="status">Review recorded for this exact version. The owner must approve it separately. Later edits invalidate this review.</p> : item?.content && <><p>{item.title} · Revision {item.revision}</p><ContentPreview content={item.content} /><details className="studio-panel"><summary>Inspect the complete export content</summary><p>Review every field, including scenes, on-screen copy, captions, website text and production directions, before attesting below.</p><pre className="preserve-lines" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(item.content, null, 2)}</pre></details>
      <form className="studio-panel" onSubmit={event => { event.preventDefault(); void submit() }}><fieldset disabled={busy || checkingIdentity}><legend>Claim-by-claim evidence check</legend>
        {item.content.claims.map(claim => { const source = item.evidence.find(value => value.id === claim.evidenceId); return <article key={claim.id} className="studio-evidence"><h2>{claim.id}: {claim.text}</h2><blockquote>{claim.quote}</blockquote>{source && <><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>Retrieved {new Date(source.retrievedAt).toLocaleString()} · {source.type}</p><p>{source.limitations.join(' ')}</p><details><summary>Captured source passage</summary><blockquote>{source.excerpt}</blockquote></details></>}<label><input type="checkbox" checked={Boolean(claims[claim.id]?.supported)} onChange={event => setClaims(previous => ({ ...previous, [claim.id]: { note: previous[claim.id]?.note || '', supported: event.target.checked } }))} />I checked that the source supports this claim in context and is sufficiently current.</label><label>Review rationale<textarea required minLength={10} maxLength={1000} value={claims[claim.id]?.note || ''} onChange={event => setClaims(previous => ({ ...previous, [claim.id]: { supported: previous[claim.id]?.supported || false, note: event.target.value } }))} /></label></article> })}
        <label><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} />I checked source and asset usage rights.</label><label><input type="checkbox" checked={promiseAligned} onChange={event => setPromiseAligned(event.target.checked)} />Titles, hooks and thumbnail promises match the content and evidence.</label>
        <label><input type="checkbox" checked={freshnessConfirmed} onChange={event => setFreshnessConfirmed(event.target.checked)} />I opened the current sources and rechecked time-sensitive claims. This review expires in 24 hours; it does not guarantee that sources will remain unchanged.</label>
        <label><input type="checkbox" checked={contradictionsResolved} onChange={event => setContradictionsResolved(event.target.checked)} />I checked conflicting evidence. No unresolved contradiction makes this package misleading; uncertainty is clearly stated.</label>
      </fieldset><p>Leave unchecked if support is missing. Do not pass unresolved claims; ask the owner to revise the package.</p><button disabled={busy || checkingIdentity || !complete}>Record independent review</button></form>
    </>}
  </section>
}
