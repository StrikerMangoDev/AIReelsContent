import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { articleId, canonicalUrl, validateClassifications } from '../domain/article.js'
import { createIngestion } from '../services/ingestion.js'
import { worldActivity, listNews } from '../services/news.js'
import { createApp } from '../http/app.js'
import { safeImageUrl } from '../ingestion/images.js'

const candidate = { id: articleId('https://trusted.example/story'), url: 'https://trusted.example/story', title: 'An AI model announcement in India', excerpt: 'Researchers in India announced a model.', publishedAt: '2026-09-30T20:00:00.000Z', sourceId: 'trusted', sourceName: 'Trusted Publisher' }
const classification = { candidateId: candidate.id, relevant: true, summary: 'Researchers announced a model in India.', category: 'Models', regions: ['India'], regionEvidence: 'Researchers in India', tags: ['models'] }
const article = validateClassifications([candidate], { articles: [classification] })[0]

test('canonical URLs reject untrusted destinations and remove trackers', () => {
  assert.equal(canonicalUrl('https://trusted.example/story?utm_source=a#x', ['trusted.example']), candidate.url)
  for (const url of ['http://trusted.example/story','https://trusted.example.attacker.test/story','https://user:pass@trusted.example/story','https://trusted.example:444/story','javascript:alert(1)']) assert.equal(canonicalUrl(url, ['trusted.example']), null)
})
test('model cannot invent candidates, URLs, categories or omit records', () => {
  assert.throws(() => validateClassifications([candidate], { articles: [{ ...classification, candidateId: 'invented' }] }))
  assert.throws(() => validateClassifications([candidate], { articles: [{ ...classification, url: 'https://attacker.test' }] }))
  assert.throws(() => validateClassifications([candidate], { articles: [{ ...classification, category: 'Invented' }] }))
  assert.throws(() => validateClassifications([candidate], { articles: [] }))
})
test('uncertain geography stays global', () => {
  const result = validateClassifications([candidate], { articles: [{ ...classification, regionEvidence: '' }] })
  assert.deepEqual(result[0].regions, [])
  assert.equal(result[0].url, candidate.url)
})
test('database is idempotent and uses evidence-backed region filters', async () => {
  const repo = createRepository(':memory:')
  try {
    assert.equal(repo.persistBatch([article], [candidate]), 1)
    assert.equal(repo.persistBatch([article], [candidate]), 0)
    assert.equal((await listNews(repo, { region: 'India', page: 1, limit: 24 })).total, 1)
    assert.equal((await listNews(repo, { region: 'China', page: 1, limit: 24 })).total, 0)
    assert.equal((await listNews(repo, { q: 'publisher', page: 1, limit: 24 })).total, 1)
  } finally { repo.close() }
})
test('today boundaries follow viewer timezone', async () => {
  const repo = createRepository(':memory:')
  try {
    repo.persistBatch([article], [candidate])
    assert.equal((await worldActivity(repo, 'Asia/Calcutta', '2026-10-01T01:00:00Z')).regions.find(item => item.region === 'India').total, 1)
    assert.equal((await worldActivity(repo, 'UTC', '2026-10-01T01:00:00Z')).total, 0)
  } finally { repo.close() }
})
test('lease ownership and daily request ceiling prevent duplicate/spendy jobs', () => {
  const repo = createRepository(':memory:')
  try {
    assert.equal(repo.acquireLease('job', 'first'), true)
    assert.equal(repo.acquireLease('job', 'second'), false)
    repo.releaseLease('job', 'second')
    assert.equal(repo.acquireLease('job', 'second'), false)
    repo.reserveModelCall(1)
    assert.throws(() => repo.reserveModelCall(1))
  } finally { repo.close() }
})
test('no configuration can permit more than two model attempts in rolling 24 hours', () => {
  const repo = createRepository(':memory:')
  try { repo.reserveModelCall(99); repo.reserveModelCall(99); assert.throws(() => repo.reserveModelCall(99)); }
  finally { repo.close() }
})
test('metadata image URLs reject unsafe protocols and local hosts', () => {
  assert.equal(safeImageUrl('/cover.jpg', 'https://trusted.example/story'), 'https://trusted.example/cover.jpg')
  for (const url of ['javascript:alert(1)', 'http://images.example/a.jpg', 'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://private.internal/a.jpg']) assert.equal(safeImageUrl(url, candidate.url), null)
})
test('activity period can include older articles without inflating today counts', async () => {
  const repo = createRepository(':memory:')
  try {
    repo.persistBatch([article], [candidate])
    assert.equal((await worldActivity(repo, 'UTC', '2026-10-01T01:00:00Z', '72h')).total, 1)
    assert.equal((await worldActivity(repo, 'UTC', '2026-10-01T01:00:00Z', 'today')).total, 0)
  } finally { repo.close() }
})
test('partial source failure succeeds with degraded status; duplicates skip Gemini', async () => {
  const repo = createRepository(':memory:')
  let calls = 0
  const ingest = createIngestion({ repository: repo, sources: [{ id: 'trusted' }, { id: 'offline' }], readSource: async source => { if (source.id === 'offline') throw new Error('Unavailable'); return [candidate] }, classify: async () => { calls++; return [article] }, config: { MAX_ARTICLES_PER_RUN: 20, MAX_ARTICLE_AGE_HOURS: 72, MAX_MODEL_CALLS_PER_DAY: 10, GEMINI_MODEL: 'test' } })
  try {
    assert.equal((await ingest()).status, 'degraded')
    assert.equal((await ingest()).saved, 0)
    assert.equal(calls, 1)
  } finally { repo.close() }
})
test('model failure retains old articles and leaves candidates retryable', async () => {
  const repo = createRepository(':memory:')
  const fresh = { ...candidate, id: 'fresh', url: 'https://trusted.example/fresh' }
  repo.persistBatch([article], [candidate])
  const ingest = createIngestion({ repository: repo, sources: [{ id: 'trusted' }], readSource: async () => [fresh], classify: async () => { throw new Error('bad model response') }, config: { MAX_ARTICLES_PER_RUN: 20, MAX_ARTICLE_AGE_HOURS: 72, GEMINI_MODEL: 'test' } })
  try {
    await assert.rejects(ingest())
    assert.equal(repo.allArticles().length, 1)
    assert.equal(repo.processed('fresh'), false)
    assert.equal(repo.lastRun().status, 'failed')
  } finally { repo.close() }
})
test('API validates filters and redirects exclusively to stored source', async () => {
  const repo = createRepository(':memory:')
  repo.persistBatch([article], [candidate])
  const server = createApp({ repository: repo, sources: [] }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${base}/api/news?limit=999`)).status, 400)
    assert.equal((await fetch(`${base}/api/activity?timezone=invalid`)).status, 400)
    const response = await fetch(`${base}/api/articles/${article.id}/source?url=https://attacker.test`, { redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), candidate.url)
    assert.equal((await fetch(`${base}/api/articles/missing/source`)).status, 404)
    assert.equal((await fetch(`${base}/vertex.json`)).status, 404)
  } finally { await new Promise(resolve => server.close(resolve)); repo.close() }
})
