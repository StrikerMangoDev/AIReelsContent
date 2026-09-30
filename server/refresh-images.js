import { sources } from './config/sources.js'
import { repository } from './bootstrap.js'
import { articleImage } from './ingestion/images.js'

// Metadata-only repair; never calls Gemini or reserves a model request.
let updated = 0
try {
  for (const article of (await repository.allArticles()).filter(item => !item.imageUrl).slice(0, 100)) {
    const imageUrl = await articleImage(article, sources)
    if (imageUrl) { await repository.updateImage(article.id, imageUrl); updated++ }
  }
  console.log(JSON.stringify({ imageMetadataUpdated: updated, vertexCalls: 0 }))
} finally { repository.close() }
