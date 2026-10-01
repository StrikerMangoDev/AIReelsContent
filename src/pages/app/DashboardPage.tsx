import { ArrowUpRight, RefreshCw, Cpu, FileText, Network } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DeferredWorldMap as WorldMap } from '@/components/common/DeferredWorldMap'
import { useNews } from '@/hooks/useNews'
import type { Article } from '@/types/news'
import { UpdatedAgo } from '@/components/common/UpdatedAgo'
import { RegionPicker } from '@/components/ui/RegionPicker'

function visualFor(category: string) { return category === 'Compute' ? 'silicon' : category === 'Robotics' || category === 'Policy' ? 'wave' : 'neural' }
function publishedLabel(value: string) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }

function NewsCard({ article, index }: { article: Article; index: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  const destination = `/api/articles/${article.id}/source`
  const FallbackIcon = article.category === 'Compute' ? Cpu : article.category === 'Research' ? FileText : Network
  return <article className="editorial-story">
    <Link to={`/articles/${article.id}`} className={`abstract-visual abstract-visual--${visualFor(article.category)}`} aria-label={`Explore update: ${article.title}`}>
      {article.imageUrl && !imageFailed ? <img className="article-image" src={article.imageUrl} alt="" loading={index < 3 ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <div className="article-fallback"><FallbackIcon size={48} strokeWidth={1} /><span>{article.sourceName}</span></div>}<ArrowUpRight size={18} />
    </Link>
    <div className="editorial-story__meta"><span>{article.category}</span><span>{article.regions.join(' · ') || 'Global'}</span></div>
    <h3><Link to={`/articles/${article.id}`}>{article.title}</Link></h3><p>{article.summary}</p>
    <div className="article-published"><time dateTime={article.publishedAt}>{publishedLabel(article.publishedAt)}</time></div>
    <div className="editorial-story__footer"><span>{article.sourceName}</span><a href={destination}>Read original <ArrowUpRight size={14} /></a></div>
  </article>
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams()
  const region = params.get('region') ?? 'Global'
  const category = params.get('category') ?? 'All signals'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [period, setPeriod] = useState('today')
  function changePage(target: number) {
    if (loading || !data || data.page !== page) return
    const next = new URLSearchParams(params)
    if (target === 1) next.delete('page'); else next.set('page', String(target))
    setParams(next)
    const feed = document.getElementById('stories')
    if (feed) {
      const top = Math.max(0, feed.getBoundingClientRect().top + window.scrollY - 112)
      window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }
  const { data, activity, sources, error, loading, retry } = useNews(region, category, params.get('q') ?? '', page, period)
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value === 'Global' || value === 'All signals') next.delete(key)
    else next.set(key, value)
    next.delete('page')
    if (key === 'region') { next.delete('category'); next.delete('q') }
    setParams(next)
  }
  const counts = region === 'Global' ? activity?.global : activity?.regions.find(item => item.region === region)
  const lastRun = data?.lastRun
  const articles = data?.articles ?? []
  const categories = [...new Set(['All signals', ...(data?.topics?.map(topic => topic.name) ?? []), ...(category !== 'All signals' ? [category] : [])])]
  return <div className="news-home">
    {page === 1 && Boolean(data?.hotArticles?.length) && <section className="hot-topics" aria-labelledby="hot-heading"><div className="section-heading"><div><h2 id="hot-heading">Hot topics.</h2><p className="section-description">Recent launches and announcements, selected from the last 72 hours.</p></div><span className="hot-ranking-note" title="Ranked by announcement keywords, official-source status and recency. Not measured popularity.">Editorial priority</span></div><div className="editorial-stories">{data!.hotArticles!.map((article,index) => <NewsCard key={article.id} article={article} index={index} />)}</div></section>}
    <section id="stories" className="feed-section">
      <div className="section-heading"><div><h2>The latest in technology.</h2><p className="section-description">Announcements, discoveries and launches — directly from the source.</p></div><UpdatedAgo timestamp={data?.updatedAt ?? null} /></div>
      <div className="feed-tabs" role="group" aria-label="Filter by subject">{categories.map(item => <button key={item} className={category === item ? 'is-active' : ''} aria-pressed={category === item} onClick={() => filter('category', item)}>{item === 'All signals' ? 'All updates' : item}</button>)}</div>
      {error && <div className="feed-notice" role="alert"><span>{error} {data ? 'Showing the last loaded feed.' : ''}</span><button onClick={retry}><RefreshCw size={14} /> Retry</button></div>}
      {!error && lastRun && ['failed', 'degraded'].includes(lastRun.status) && <div className="feed-notice">Some sources could not refresh. Available articles remain readable.</div>}
      {loading && !data ? <div className="feed-empty" role="status">Loading the intelligence feed…</div> : <>
        <div className="feed-results" aria-busy={loading}>
          <span className={`feed-updating${loading ? ' is-visible' : ''}`} role="status">{loading ? 'Updating results…' : ''}</span>
          <div className="editorial-stories feed-enter" key={articles.map(article => article.id).join(',')}>{articles.map((article, index) => <NewsCard key={article.id} article={article} index={index} />)}</div>
        </div>
        {!articles.length && !error && <div className="feed-empty"><h3>{lastRun ? 'No matching signals.' : 'The feed is getting ready.'}</h3><p>{lastRun ? 'Try another subject, region or search term.' : 'Verified articles will appear after the first successful refresh.'}</p>{lastRun && <button onClick={() => setParams({})}>Reset filters</button>}</div>}
        {data && data.total > data.limit && <nav className="feed-pagination" aria-label="News pages"><button type="button" disabled={loading || data.page !== page || page <= 1} onClick={() => changePage(page - 1)}>Previous</button><span aria-live="polite">Page {data.page} of {Math.ceil(data.total / data.limit)}</span><button type="button" disabled={loading || data.page !== page || page * data.limit >= data.total} onClick={() => changePage(page + 1)}>Next</button></nav>}
      </>}
    </section>
    <section id="regional" className="world-section"><div className="world-copy"><h2>Where AI is<br />moving today.</h2><p>Follow developments across borders. Markers indicate supported regional connections, including named organizations—not exact event locations.</p><div className="period-switch" role="group" aria-label="Activity time range"><button aria-pressed={period === 'today'} onClick={() => setPeriod('today')}>Today</button><button aria-pressed={period === '72h'} onClick={() => setPeriod('72h')}>Last 72 hours</button></div><div className="world-current"><span>Region</span><RegionPicker value={region} onChange={value => filter('region', value)} /></div><div className="activity-metrics"><span>Updates<strong>{counts?.total ?? '—'}</strong></span><span>Research<strong>{counts?.research ?? '—'}</strong></span><span>Models<strong>{counts?.models ?? '—'}</strong></span></div><small className="data-pending">{activity ? `${activity.unlocated} ${activity.unlocated === 1 ? 'update has' : 'updates have'} no supported region. ${period === 'today' ? 'Today uses your local timezone. Try 72 hours for a wider view.' : 'Showing the last 72 hours.'}` : 'Activity is loading…'}</small><button className="reset-region" onClick={() => filter('region', 'Global')}>Explore all regions <ArrowUpRight size={13} /></button></div><WorldMap region={region} onSelect={value => filter('region', value)} activity={activity?.regions} /></section>
    <section id="sources" className="sources-section"><div className="section-heading"><div><h2>From the source.</h2></div></div><div className="source-directory">{sources.map(source => <a key={source.id} href={source.homepage} target="_blank" rel="noreferrer"><span>{source.tier === 'primary' ? 'Official announcements' : source.tier === 'research' ? 'Original research' : 'Technology reporting'}</span><strong>{source.name}</strong><ArrowUpRight size={17} /></a>)}</div></section>
    <footer className="site-footer"><span>Signal AI</span><span className="footer-copyright">© {new Date().getFullYear()}</span></footer>
  </div>
}
