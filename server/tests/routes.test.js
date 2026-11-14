import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import handler, { apiRequestUrl } from '../../api/[...path].js'
import authConfig from '../../api/auth/config.js'
import authMe from '../../api/auth/me.js'
import adminOverview from '../../api/admin/overview.js'
import articleSource from '../../api/articles/[id]/source.js'
import { createApp } from '../http/app.js'
import { createRepository } from '../storage/repository.js'
import { studioRequestUrl } from '../../api/studio.js'
import { createServer } from 'node:http'
import express from 'express'
import { z } from 'zod'

test('explicit nested Vercel entry points share the existing API handler', () => {
  for (const entry of [authConfig, authMe, adminOverview, articleSource]) assert.equal(entry, handler)
})

test('studio Vercel rewrite preserves nested paths and query values without permitting traversal', () => {
  assert.equal(studioRequestUrl({ url: '/api/studio?__studioPath=packages%2Fabc%2Fgenerate&limit=5' }), '/api/studio/packages/abc/generate?limit=5')
  assert.equal(studioRequestUrl({ url: '/api/studio/assets/abc/file?__studioPath=assets%2Fabc%2Ffile' }), '/api/studio/assets/abc/file')
  assert.equal(studioRequestUrl({ url: '/api/studio', query: { __studioPath: 'library/sources' } }), '/api/studio/library/sources')
  const rewritten = { url: '/api/studio?__studioPath=packages%2Fabc%2Fsocial-preview&platform=Instagram', query: { __studioPath: 'packages/abc/social-preview', platform: 'Instagram' } }
  assert.equal(studioRequestUrl(rewritten), '/api/studio/packages/abc/social-preview?platform=Instagram')
  assert.equal(Object.hasOwn(rewritten, 'query'), false)
  const getterRequest = { url: '/api/studio?__studioPath=packages%2Fabc%2Fsocial-preview&platform=Instagram' }
  Object.defineProperty(getterRequest, 'query', { configurable: true, get: () => ({ __studioPath: 'packages/abc/social-preview', platform: 'Instagram' }) })
  assert.equal(studioRequestUrl(getterRequest), '/api/studio/packages/abc/social-preview?platform=Instagram')
  assert.equal(Object.hasOwn(getterRequest, 'query'), false)
  assert.throws(() => studioRequestUrl({ url: '/api/studio?__studioPath=..%2Fadmin' }))
  assert.throws(() => studioRequestUrl({ url: '/api/studio?__studioPath=config&__studioPath=packages' }))
})

test('Vercel query getters cannot contaminate strict preview filters; public filter validation remains intact', async () => {
  const app = express()
  app.get('/api/studio/packages/abc/social-preview', (req, res) => {
    const result = z.object({ platform: z.enum(['Instagram', 'Facebook']) }).strict().safeParse(req.query)
    res.status(result.success ? 200 : 400).json(result.success ? result.data : { error: 'Invalid filters' })
  })
  const server = createServer((req, res) => {
    const original = req.url
    Object.defineProperty(req, 'query', { configurable: true, get: () => Object.fromEntries(new URL(original, 'http://localhost').searchParams) })
    req.url = studioRequestUrl(req)
    app(req, res)
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/api/studio?__studioPath=packages%2Fabc%2Fsocial-preview&platform=Instagram`
  try {
    const response = await fetch(base)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { platform: 'Instagram' })
    for (const suffix of ['&unexpected=true', '&platform=Facebook']) assert.equal((await fetch(base + suffix)).status, 400)
  } finally { server.closeAllConnections(); server.close() }
})

test('nested auth routes return configuration JSON and enforce authentication', async () => {
  const repository = createRepository(':memory:')
  const server = createApp({ repository, sources: [] }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const response = await fetch(`${base}/api/auth/config`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(typeof body.configured, 'boolean')
    assert.ok(Object.hasOwn(body, 'config'))
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 401)
    assert.equal((await fetch(`${base}/api/admin/overview`)).status, 401)
  } finally {
    await new Promise(resolve => server.close(resolve))
    repository.close()
  }
})

 test('catch-all routing metadata is removed only for the exact request path', () => {
  assert.equal(apiRequestUrl('/api/studio/packages/abc/social-preview?path=studio%2Fpackages%2Fabc%2Fsocial-preview&platform=Instagram'), '/api/studio/packages/abc/social-preview?platform=Instagram')
  assert.equal(apiRequestUrl('/api/studio/config?path=unrelated'), '/api/studio/config?path=unrelated')
  assert.equal(apiRequestUrl('/api/studio/config?path=studio%2Fconfig&path=studio%2Fconfig'), '/api/studio/config?path=studio%2Fconfig&path=studio%2Fconfig')
 })
