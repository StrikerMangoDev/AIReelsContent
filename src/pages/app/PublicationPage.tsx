import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { studioRequest, type StudioPackage } from '@/services/studio-api'
import '@/styles/studio.css'
type Publication = { id: string; title: string; body: string; evidence: StudioPackage['evidence']; claims: { id: string; text: string; evidenceId: string }[]; publishedAt: string; correctionRequired?: boolean }
export function PublicationPage() {
  const { publicationId } = useParams()
  return <PublicationContent key={publicationId ?? 'list'} />
}
function PublicationContent() {
  const { publicationId } = useParams()
  const [publications, setPublications] = useState<Publication[]>([])
  const [item, setItem] = useState<Publication | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { let active = true; const request = publicationId ? studioRequest<Publication>(`/publications/${encodeURIComponent(publicationId)}`, undefined, 'GET', false).then(data => { if (active) setItem(data) }) : studioRequest<{ publications: Publication[] }>('/publications', undefined, 'GET', false).then(data => { if (active) setPublications(data.publications) }); request.catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Articles could not be loaded.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [publicationId])
  return <section className="studio"><Link to={publicationId ? '/insights' : '/'}>← {publicationId ? 'All insights' : 'Latest updates'}</Link>{loading ? <p role="status">Loading insights…</p> : error ? <p role="alert">{error}</p> : item ? <article><header className="studio-heading"><span className="studio-eyebrow">Published insight · {new Date(item.publishedAt).toLocaleDateString()}</span><h1>{item.title}</h1></header>{item.correctionRequired && <p className="studio-alert" role="alert">Source evidence changed; this publication needs editorial review.</p>}<div className="studio-panel" style={{ whiteSpace: 'pre-wrap' }}>{item.body}</div><section className="studio-panel"><h2>Claims and sources</h2>{item.claims?.map(claim => <p key={claim.id}><strong>{claim.id}</strong>: {claim.text} · Source {claim.evidenceId}</p>)}<h3>Sources and limitations</h3>{item.evidence.map(evidence => <article key={evidence.id}><h3><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.title} ↗</a></h3><p>{evidence.id} · {evidence.publisher}</p>{evidence.limitations.map((limit, index) => <p key={index}>{limit}</p>)}</article>)}</section></article> : <><header className="studio-heading"><span className="studio-eyebrow">From the content studio</span><h1>Published insights.</h1><p>Reviewed articles with their source references and limitations.</p></header><div className="studio-panel studio-package-list">{publications.length ? publications.map(entry => <Link key={entry.id} to={`/insights/${entry.id}`}><strong>{entry.title}</strong><span>{new Date(entry.publishedAt).toLocaleDateString()}</span></Link>) : <p>No insights have been published yet.</p>}</div></>}</section>
}
