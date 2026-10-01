import { createClient } from '@supabase/supabase-js'

export function createSupabaseRepository(config) {
  if (!config.SUPABASE_URL || !config.SUPABASE_SECRET_KEY) throw new Error('Supabase URL and server secret key are required')
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  async function call(op, args = {}, rpc = 'signal_repository') {
    const { data, error } = await client.rpc(rpc, { operation: op, args })
    if (error) {
      const failure = new Error(`Storage operation failed: ${op}`, { cause: error })
      failure.operation = op
      if (error.code === 'P0002') failure.code = 'STUDIO_CONFLICT'
      if (error.code === 'P0003') failure.code = 'STUDIO_QUOTA'
      throw failure
    }
    return data
  }
  return {
    studioGet: (uid, kind, id) => call('get', { uid, kind, id }, 'signal_studio'),
    studioList: (uid, kind) => call('list', { uid, kind }, 'signal_studio'),
    studioHistory: (uid, kind, id) => call('history', { uid, kind, id }, 'signal_studio'),
    studioPut: (uid, kind, id, payload, expectedRevision) => call('put', { uid, kind, id, payload, expectedRevision }, 'signal_studio'),
    studioReserve: (uid, requestId, limit) => call('reserve', { uid, requestId, limit }, 'signal_studio'),
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
