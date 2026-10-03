import { generateJson } from './llm.js'
import { readFileSync } from 'node:fs'
import { categories, regions, validateClassifications } from '../domain/article.js'
import { retry } from '../infrastructure/retry.js'

const responseJsonSchema = {
  type: 'object', required: ['articles'], properties: {
    articles: { type: 'array', items: { type: 'object', required: ['candidateId', 'relevant', 'summary', 'category', 'regions', 'regionEvidence', 'tags'], properties: {
      candidateId: { type: 'string' }, relevant: { type: 'boolean' }, summary: { type: 'string' }, category: { type: 'string', enum: categories },
      regions: { type: 'array', items: { type: 'string', enum: regions } }, regionEvidence: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    } } },
  },
}

export async function classifyWithVertex(candidates, onAttempt = () => {}) {
  const prompt = readFileSync(new URL('../prompts/news-curator.md', import.meta.url), 'utf8')
  const response = await retry(async () => {
    await onAttempt()
    return generateJson({ system: prompt, input: { candidates }, schema: responseJsonSchema, maxTokens: 20000 })
  }, { attempts: 1 })
  return validateClassifications(candidates, response)
}
