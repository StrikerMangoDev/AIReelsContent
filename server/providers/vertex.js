import { GoogleGenAI } from '@google/genai'
import { readFileSync } from 'node:fs'
import { env } from '../config/env.js'
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
  if (!env.GOOGLE_CLOUD_PROJECT) throw new Error('Vertex project not configured')
  const googleAuthOptions = env.GOOGLE_SERVICE_ACCOUNT_JSON ? { credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) } : { keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS }
  const client = new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION, googleAuthOptions, httpOptions: { timeout: 60000 } })
  const response = await retry(async () => {
    await onAttempt()
    return client.models.generateContent({ model: env.GEMINI_MODEL, contents: JSON.stringify({ candidates }), config: { systemInstruction: prompt, temperature: 0.1, responseMimeType: 'application/json', responseJsonSchema, maxOutputTokens: 20000, thinkingConfig: { thinkingBudget: 0 } } })
  }, { attempts: 1 })
  if (!response.text) throw new Error('Vertex returned no structured content')
  return validateClassifications(candidates, JSON.parse(response.text))
}
