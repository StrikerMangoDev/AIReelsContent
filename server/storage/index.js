import { env } from '../config/env.js'
import { createSupabaseRepository } from './supabase.js'

if (process.env.VERCEL && env.STORAGE_PROVIDER !== 'supabase') throw new Error('Vercel requires persistent Supabase storage')
// Production API startup must not import SQLite or the Vertex ingestion engine.
export const repository = env.STORAGE_PROVIDER === 'supabase'
  ? createSupabaseRepository(env)
  : (await import('./repository.js')).createRepository(env.DATABASE_PATH)
