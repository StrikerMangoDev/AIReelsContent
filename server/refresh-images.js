import { sources } from './config/sources.js'
import { repository } from './bootstrap.js'
import { enrichImages } from './ingestion/images.js'

// Metadata-only repair; never calls Gemini or reserves a model request.
try {
  const result = await enrichImages(await repository.allArticles(), sources, repository, 100)
  console.log(JSON.stringify({ ...result, vertexCalls: 0 }))
} finally { repository.close() }
