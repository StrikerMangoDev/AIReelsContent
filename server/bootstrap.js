import { env } from './config/env.js'
import { sources } from './config/sources.js'
import { readSource } from './ingestion/feeds.js'
import { classifyWithVertex } from './providers/vertex.js'
import { createIngestion } from './services/ingestion.js'
import { repository } from './storage/index.js'

export { repository }
export const ingest = createIngestion({ repository, sources, readSource, classify: classifyWithVertex, config: env })
