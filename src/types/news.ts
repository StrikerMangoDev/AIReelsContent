export type Article = {
  id: string
  title: string
  url: string
  summary: string
  category: string
  regions: string[]
  tags: string[]
  sourceId: string
  sourceName: string
  publishedAt: string
  imageUrl?: string | null
}
export type IngestionRun = { status: string; finishedAt: string | null; errorCode?: string } | null
export type NewsResponse = { articles: Article[]; total: number; page: number; limit: number; lastRun: IngestionRun; updatedAt: string | null; topics: { name: string; count: number }[] }
export type ActivityCount = { region?: string; total: number; research: number; models: number }
export type ActivityResponse = { day: string; timezone: string; period: string; unlocated: number; total: number; regions: ActivityCount[]; global: ActivityCount }
export type Source = { id: string; name: string; homepage: string; tier: string }
