import { env } from './config/env.js'
import { createRepository } from './storage/repository.js'
import { createSupabaseRepository } from './storage/supabase.js'
const local = createRepository(env.DATABASE_PATH)
try {
  const remote = createSupabaseRepository(env)
  const articles = local.allArticles()
  let saved = 0
  for (let offset = 0; offset < articles.length; offset += 100) saved += await remote.persistBatch(articles.slice(offset, offset + 100), [])
  console.log(JSON.stringify({ saved, total: articles.length }))
} finally { local.close() }
