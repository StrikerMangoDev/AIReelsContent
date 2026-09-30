import { createClient } from '@supabase/supabase-js'

export function createSupabaseRepository(config) {
  if (!config.SUPABASE_URL || !config.SUPABASE_SECRET_KEY) throw new Error('Supabase URL and server secret key are required')
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  async function call(op, args = {}) {
    const { data, error } = await client.rpc('signal_repository', { operation: op, args })
    if (error) throw new Error(`Storage operation failed: ${op}`, { cause: error })
    return data
  }
  return {
    close() {}, ping: () => call('ping'),
    acquireLease: (name, owner, ttlMs = 600000) => call('acquire_lease', { name, owner, ttlMs }),
    renewLease: (name, owner) => call('renew_lease', { name, owner }),
    releaseLease: (name, owner) => call('release_lease', { name, owner }),
    reserveModelCall: limit => call('reserve_call', { limit: Math.min(limit, 2) }),
    processed: id => call('processed', { id }),
    processedIds: ids => call('processed_ids', { ids }),
    persistBatch: (articles, candidates) => call('persist_batch', { articles, candidates }),
    startRun: () => call('start_run'),
    finishRun: (id, status, payload) => call('finish_run', { id, status, payload }),
    lastRun: () => call('last_run'), lastSuccessfulRun: () => call('last_successful_run'),
    allArticles: () => call('all_articles'), articlesSince: since => call('articles_since', { since }),
    queryArticles: query => call('query_articles', query), find: id => call('find', { id }),
    updateArticle: article => call('update_article', { article }), updateImage: (id, imageUrl) => call('update_image', { id, imageUrl }),
    upsertUser: user => call('upsert_user', { user }), recordEvent: (event, uid) => call('record_event', { event, uid }),
    adminOverview: () => call('admin_overview'),
  }
}
