// Postiz Public API: https://docs.postiz.com/public-api/posts/create
export function publishingConfig() {
  let accounts = []
  try { accounts = JSON.parse(process.env.POSTIZ_ACCOUNTS_JSON || '[]') } catch { /* Invalid account configuration stays disabled. */ }
  accounts = Array.isArray(accounts) ? accounts.filter(account => typeof account.ownerScope === 'string' && typeof account.accountId === 'string' && typeof account.platform === 'string' && typeof account.provider === 'string' && typeof account.name === 'string') : []
  return { enabled: process.env.CONTENT_SOCIAL_PUBLISHING === 'true' && Boolean(process.env.POSTIZ_API_KEY) && accounts.length > 0, accounts }
}

export function createPostizProvider({ fetcher = fetch } = {}) {
  async function request(path, init = {}) {
    const base = new URL(process.env.POSTIZ_API_URL || 'https://api.postiz.com/public/v1/')
    if (base.protocol !== 'https:' || base.username || base.password || !process.env.POSTIZ_API_KEY) throw new Error('Publishing provider is not configured')
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    const response = await fetcher(new URL(path, base), { ...init, redirect: 'error', headers: { Authorization: process.env.POSTIZ_API_KEY, ...init.headers }, signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw Object.assign(new Error('Publishing provider rejected the request'), { status: response.status })
    return response.json()
  }
  return {
    async upload(bytes, asset) {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4'].includes(asset.mime)) throw new Error('This asset format is not supported by social publishing')
      const form = new FormData()
      form.append('file', new Blob([bytes], { type: asset.mime }), `${asset.id}.${asset.mime === 'video/mp4' ? 'mp4' : asset.mime.split('/')[1]}`)
      form.append('adjust', 'false')
      const value = await request('upload', { method: 'POST', body: form })
      if (typeof value.id !== 'string' || typeof value.path !== 'string' || new URL(value.path).protocol !== 'https:' || value.status === 'processing') throw new Error('Publishing upload has no ready media receipt')
      return { id: value.id, path: value.path }
    },
    async create(payload) {
      const value = await request('posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!Array.isArray(value) || value.length !== 1 || typeof value[0].postId !== 'string') throw new Error('Publishing returned no unique post receipt')
      return { postId: value[0].postId, integration: value[0].integration }
    },
    async list(startDate, endDate) {
      const value = await request(`posts?${new URLSearchParams({ startDate, endDate })}`)
      if (!Array.isArray(value.posts)) throw new Error('Publishing readback unavailable')
      return value.posts
    },
  }
}
