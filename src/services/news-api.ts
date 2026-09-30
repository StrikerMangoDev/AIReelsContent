import type { ActivityResponse, NewsResponse, Source } from '@/types/news'

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(response.status === 400 ? 'Invalid news filters.' : 'The intelligence feed is temporarily unavailable.')
  return response.json() as Promise<T>
}
export const newsApi = {
  news: (params: URLSearchParams, signal: AbortSignal) => request<NewsResponse>(`/news?${params}`, signal),
  activity: (signal: AbortSignal, period = 'today') => request<ActivityResponse>(`/activity?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}&period=${period}`, signal),
  sources: (signal: AbortSignal) => request<{ sources: Source[] }>('/sources', signal),
}
