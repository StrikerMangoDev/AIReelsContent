import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default('./vertex.json'),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default('global'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  DATABASE_PATH: z.string().default('./server/data/signal.sqlite'),
  REFRESH_INTERVAL_MINUTES: z.coerce.number().int().min(720).default(720),
  FEED_REFRESH_INTERVAL_MINUTES: z.coerce.number().int().min(360).default(360),
  MAX_ARTICLE_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  MAX_ARTICLES_PER_RUN: z.coerce.number().int().min(1).max(40).default(40),
  MAX_MODEL_CALLS_PER_DAY: z.coerce.number().int().min(1).max(2).default(2),
  STUDIO_DAILY_GENERATIONS: z.coerce.number().int().min(1).max(100).default(10),
  ENABLE_SCHEDULER: z.enum(['true', 'false']).default('false'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  STORAGE_PROVIDER: z.enum(['sqlite', 'supabase']).default('sqlite'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_WEB_CONFIG: z.string().optional(),
  FIREBASE_ADMIN_CREDENTIALS: z.string().optional(),
  ADMIN_EMAILS: z.string().default('yeshaswi3@gmail.com'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON: z.string().optional(),
  CRON_SECRET: z.string().min(32).optional(),
})

export const env = schema.parse(process.env)
env.GOOGLE_APPLICATION_CREDENTIALS = resolve(env.GOOGLE_APPLICATION_CREDENTIALS)
// Only the backend reads credentials; never export their contents or log them.
if (!env.GOOGLE_CLOUD_PROJECT) {
  try { env.GOOGLE_CLOUD_PROJECT = JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).project_id }
  catch { /* Read-only API remains available without Vertex credentials. */ }
}
