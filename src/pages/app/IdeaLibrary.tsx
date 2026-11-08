import { useEffect, useState } from 'react'
import { studioRead } from '@/services/studio-api'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, Search } from 'lucide-react'

type CategoryImage = { url: string; title: string; author: string; attribution?: string; sourceUrl: string; license: string; licenseUrl: string }

export function CategoryCover({ name, image }: { name: string; image?: CategoryImage }) {
  const category = /astrolog|horoscope|zodiac|jyotish|ज्योतिष|राशिफल/i.test(name) ? 'astrology'
    : /vastu|vaastu|वास्तु/i.test(name) ? 'vastu'
    : /comedy|humou?r|jokes?|stand.?up|कॉमेडी/i.test(name) ? 'comedy'
    : /\b(news|headlines|journalism)\b|समाचार|खबर/i.test(name) ? 'news'
    : /\b(ai|artificial intelligence|tech|technology|software|robotics?|coding)\b/i.test(name) ? 'technology'
    : /fitness|health|food|wellness|sport/i.test(name) ? 'wellness'
    : /finance|business|market|money|startup/i.test(name) ? 'business'
    : /film|cinema|music|art|design|entertainment/i.test(name) ? 'creative' : 'discovery'
  const fallback = `/category-covers/${category}.svg`
  return <img className="category-cover" src={image?.url || fallback} alt="" width="480" height="270" loading="lazy" onError={event => { if (event.currentTarget.getAttribute('src') !== fallback) event.currentTarget.src = fallback }} />
}

type Category = { id?: string; name: string; brief: string }
type Snapshot = { niche: Category; reportId: string; topicCount: number; researchedAt: string }
export function IdeaLibrary({ categories, collections, search, setSearch, personal, loading, jobs }: { categories: Category[]; collections: Snapshot[]; search: string; setSearch: (value: string) => void; personal: boolean; loading: boolean; jobs: Record<string, { status: string }> }) {
  const [images, setImages] = useState<Record<string, CategoryImage>>({})
  useEffect(() => {
    if (loading) return
    let active = true; let cursor = 0
    // Two lookups at a time; the server caches successes and unsuccessful searches.
    void Promise.all(Array.from({ length: Math.min(2, categories.length) }, async () => {
      while (active && cursor < categories.length) {
        const category = categories[cursor++]
        if (!category.id) continue
        try {
          const path = `/intelligence/niches/${encodeURIComponent(category.id)}/image`
          let result = await studioRead<{ status: string; image: CategoryImage | null }>(path)
          for (let attempt = 0; active && result.status === 'pending' && attempt < 3; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 2000))
            if (!active) break
            result = await studioRead<{ status: string; image: CategoryImage | null }>(path)
          }
          if (active && result.status === 'ready' && result.image && /^\/api\/studio\/category-images\/assets\/[a-f0-9]{64}$/.test(result.image.url)) {
            const image = result.image
            setImages(previous => ({ ...previous, [category.id!]: image }))
          }
        } catch { /* A missing image must not hide saved categories or interrupt research. */ }
      }
    }))
    return () => { active = false }
  }, [categories, loading])
  const filtered = categories.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase()))
  return <>
    <header className="idea-library-heading"><div><h1>Topic Library</h1><p>Pick a category to explore its saved ideas.</p></div><Link className="idea-action" to="/find-ideas"><Plus size={18} aria-hidden="true" /> Find new ideas</Link></header>
    <div className="library-tools"><label className="library-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search categories</span><input name="category-search" autoComplete="off" type="search" placeholder="Search your categories…" value={search} onChange={event => setSearch(event.target.value)} /></label><span aria-live="polite">{loading ? <span className="library-loading-status" role="status"><span className="library-loading-spinner" aria-hidden="true" />Getting your categories ready…</span> : <>{search.trim() ? `${filtered.length} of ${categories.length} categories` : `${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`} · {personal ? 'Personal library' : 'Shared with your team'}</>}</span></div>
    {loading ? <div className="library-loading" aria-busy={true} aria-label="Loading Topic Library">
      <div className="category-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className="category-tile category-skeleton" key={index}><div className="category-cover skeleton-block" /><div className="category-tile-body"><span className="skeleton-line skeleton-line-short" /><span className="skeleton-line skeleton-line-title" /><span className="skeleton-line" /><span className="skeleton-line skeleton-line-medium" /><div className="category-tile-footer"><span className="skeleton-line skeleton-line-short" /></div></div></div>)}</div>
    </div> : <div className="category-grid">{filtered.map(item => {
      const snapshot = collections.find(value => value.niche.id === item.id)
      const pending = ['reserved', 'running'].includes(jobs[item.id || '']?.status)
      const image = images[item.id || '']
      return <article className="category-card" key={item.id}><Link className="category-tile" to={`/ideas/${encodeURIComponent(item.id || '')}`}><CategoryCover name={item.name} image={image} /><div className="category-tile-body"><h2>{item.name}</h2><div className="category-meta"><span className="category-count">{pending ? 'Finding fresh ideas…' : snapshot ? `${snapshot.topicCount} saved ${snapshot.topicCount === 1 ? 'idea' : 'ideas'}` : 'No saved ideas yet'}</span><span className="category-updated">{snapshot ? `Updated ${new Date(snapshot.researchedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Ready to research'}</span></div><div className="category-tile-footer"><span>{snapshot?.topicCount ? 'Explore ideas' : 'Open category'}</span><ArrowRight size={20} aria-hidden="true" /></div></div></Link>{image && <p className="category-image-credit">Image: <a href={image.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${image.title} by ${image.attribution || image.author}`}>{image.attribution || image.author}</a> · <a href={image.licenseUrl} target="_blank" rel="noreferrer">{image.license}</a> · Cropped</p>}</article>
    })}</div>}
    {!loading && !filtered.length && <div className="library-empty" role="status"><h2>{search ? 'No matching categories' : 'Start your Topic Library'}</h2><p>{search ? 'Try a different category name.' : 'Choose any subject to find ideas worth creating.'}</p>{search ? <button type="button" onClick={() => setSearch('')}>Clear search</button> : <Link className="idea-action" to="/find-ideas">Find new ideas</Link>}</div>}
  </>
}
