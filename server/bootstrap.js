import { env } from './config/env.js'
import { sources } from './config/sources.js'
import { createRepository } from './storage/repository.js'
import { readSource } from './ingestion/feeds.js'
import { classifyWithVertex } from './providers/vertex.js'
import { createIngestion } from './services/ingestion.js'
import { createSupabaseRepository } from './storage/supabase.js'

if (process.env.VERCEL && env.STORAGE_PROVIDER !== 'supabase') throw new Error('Vercel requires persistent Supabase storage; SQLite is local-development only')
export const repository = env.STORAGE_PROVIDER === 'supabase' ? createSupabaseRepository(env) : createRepository(env.DATABASE_PATH)
export const ingest = createIngestion({ repository, sources, readSource, classify: classifyWithVertex, config: env })
