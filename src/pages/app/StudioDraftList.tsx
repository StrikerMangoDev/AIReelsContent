import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Search } from 'lucide-react'
import type { StudioPackage } from '@/services/studio-api'
import { savedContentFormats, formatLabels } from '@/services/studio-package'

export function StudioDraftList({ packages, loading, error, onRetry }: { packages: StudioPackage[]; loading: boolean; error: string; onRetry: () => void }) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('all')
  const [platform, setPlatform] = useState('all')
  const [sort, setSort] = useState('recent')
  const [page, setPage] = useState(1)
  const date = (value: string) => Date.parse(value) || 0
  const platforms = [...new Set(packages.flatMap(pack => pack.settings.platform.split(',').map(value => value.trim()).filter(Boolean)))].sort()
  const filtered = packages.filter(pack => {
    const matchesText = `${pack.title} ${pack.settings.platform}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    return matchesText && (stage === 'all' || Boolean(pack.content) === (stage === 'content')) && (platform === 'all' || pack.settings.platform.split(',').some(value => value.trim() === platform))
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) || a.id.localeCompare(b.id) : (sort === 'oldest' ? date(a.updatedAt) - date(b.updatedAt) : date(b.updatedAt) - date(a.updatedAt)) || a.id.localeCompare(b.id))
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10)
  function resetFilters() { setQuery(''); setStage('all'); setPlatform('all'); setPage(1) }

  return <section className="studio-home-drafts" aria-labelledby="studio-drafts-title" aria-busy={loading}>
    <header className="studio-home-section-heading"><div><h2 id="studio-drafts-title">Continue your work</h2><p>Find a saved draft and pick up where you left off.</p></div><span className="studio-home-count">{loading ? 'Loading…' : `${packages.length} saved`}</span></header>
    {!loading && !error && packages.length > 0 && <div className="studio-draft-filters">
      <label className="studio-draft-search">Search drafts<span><Search size={18} aria-hidden="true" /><input type="search" name="draft-search" autoComplete="off" placeholder="Search by title or platform…" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /></span></label>
      <label>Content stage<select name="draft-stage" value={stage} onChange={event => { setStage(event.target.value); setPage(1) }}><option value="all">All stages</option><option value="brief">Brief only</option><option value="content">Content saved</option></select></label>
      <label>Platform<select name="draft-platform" value={platform} onChange={event => { setPlatform(event.target.value); setPage(1) }}><option value="all">All platforms</option>{platforms.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Sort by<select name="draft-sort" value={sort} onChange={event => { setSort(event.target.value); setPage(1) }}><option value="recent">Recently updated</option><option value="oldest">Oldest updated</option><option value="title">Title A–Z</option></select></label>
    </div>}
    {loading ? <p className="studio-home-empty" role="status">Loading your saved drafts…</p> : error ? <div className="studio-home-empty" role="alert"><p>{error}</p><button type="button" className="studio-home-secondary" onClick={onRetry}>Try loading drafts again</button></div> : !packages.length ? <div className="studio-home-empty"><h3>Your first draft starts above</h3><p>Browse a researched idea or add an article link. Your saved work will appear here.</p></div> : <>
      <div className="studio-draft-results"><span role="status">{filtered.length} {filtered.length === 1 ? 'draft' : 'drafts'}{query || stage !== 'all' || platform !== 'all' ? (filtered.length === 1 ? ' matches your filters' : ' match your filters') : ' in your workspace'}</span>{(query || stage !== 'all' || platform !== 'all') && <button type="button" onClick={resetFilters}>Clear filters</button>}</div>
      {!filtered.length ? <div className="studio-home-empty"><h3>No matching drafts</h3><p>Try a different title, or clear the filters to see all your work.</p></div> : <>
        <div className="studio-draft-columns" aria-hidden="true"><span>Content & formats</span><span>Platform</span><span>Content stage</span><span>Last updated</span><span>Next step</span></div>
        <ul className="studio-draft-rows">{visible.map(pack => <li key={pack.id}><Link to={`/studio/${pack.id}`} className="studio-draft-row" aria-label={`${pack.content ? 'Continue' : 'Finish setup'}: ${pack.title}`}>
          <div className="studio-draft-title"><strong title={pack.title}>{pack.title}</strong><span>{pack.content ? savedContentFormats(pack.content).map(format => formatLabels[format]).join(' / ') || 'Saved writing' : 'Choose your deliverables in Setup'}</span></div>
          <span className="studio-draft-platforms">{pack.settings.platform || 'Platform not selected'}</span>
          <span className="studio-draft-stage" data-stage={pack.content ? 'content' : 'brief'}>{pack.content ? 'Content saved' : 'Brief only'}</span>
          <span className="studio-draft-date"><span className="studio-draft-mobile-label">Updated </span>{date(pack.updatedAt) ? <time dateTime={pack.updatedAt}>{new Date(pack.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time> : 'Date unavailable'}</span>
          <span className="studio-draft-continue">{pack.content ? 'Continue' : 'Finish setup'}<ArrowRight size={16} aria-hidden="true" /></span>
        </Link></li>)}</ul>
        {pages > 1 && <nav className="studio-draft-pagination" aria-label="Draft pages"><button type="button" className="studio-home-secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous drafts</button><span role="status">Page {currentPage} of {pages}</span><button type="button" className="studio-home-secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next drafts</button></nav>}
      </>}
      <p className="studio-draft-footnote">Content saved means writing is available. Source checks and publishing approval are separate.</p>
    </>}
  </section>
}
