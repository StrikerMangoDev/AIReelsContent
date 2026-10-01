import handler from './[...path].js'

// One function handles the nested studio API, keeping Vercel function count small.
export function studioRequestUrl(request) {
  const url = new URL(request.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/studio/')) {
    const paths = url.searchParams.getAll('__studioPath')
    const path = paths.length ? (paths.length === 1 ? paths[0] : null) : request.query?.__studioPath
    if (typeof path !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) throw new Error('Invalid studio route')
    url.pathname = `/api/studio/${path}`
  }
  url.searchParams.delete('__studioPath')
  return url.pathname + url.search
}

export default function studioHandler(request, response) {
  try { request.url = studioRequestUrl(request) }
  catch { return response.status(400).json({ error: 'Invalid studio route' }) }
  return handler(request, response)
}
