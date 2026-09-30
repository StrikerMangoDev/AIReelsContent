import { useEffect, useState } from 'react'
import { newsApi } from '@/services/news-api'
import type { ActivityResponse, NewsResponse, Source } from '@/types/news'

const cache = new Map<string, { data: NewsResponse; expires: number }>()
export function useNews(region: string, category: string, query: string, page: number, period: string) {
  const [data, setData] = useState<NewsResponse | null>(null)
  const [activity, setActivity] = useState<ActivityResponse | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ region, category, q: query, page: String(page), limit: '24', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    const key = params.toString()
    const timer = window.setTimeout(() => {
      const cached = cache.get(key)
      if (cached && cached.expires > Date.now()) { setData(cached.data); setLoading(false); setError(''); return }
      setLoading(true)
      void newsApi.news(params, controller.signal).then(news => {
        if (cache.size >= 30) cache.delete(cache.keys().next().value!)
        cache.set(key, { data: news, expires: Date.now() + 60000 })
        setData(news); setError('')
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load the feed.') })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, query ? 250 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [region, category, query, page, refresh])
  useEffect(() => {
    const controller = new AbortController()
    void newsApi.activity(controller.signal, period).then(setActivity).catch(() => {})
    return () => controller.abort()
  }, [period, refresh])
  useEffect(() => {
    const controller = new AbortController()
    void newsApi.sources(controller.signal).then(result => setSources(result.sources)).catch(() => {})
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const interval = window.setInterval(() => { if (!document.hidden) { cache.clear(); setRefresh(value => value + 1) } }, 300000)
    return () => window.clearInterval(interval)
  }, [])
  return { data, activity, sources, error, loading, retry: () => { cache.clear(); setRefresh(value => value + 1) } }
}
