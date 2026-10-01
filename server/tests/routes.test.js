import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import handler from '../../api/[...path].js'
import authConfig from '../../api/auth/config.js'
import authMe from '../../api/auth/me.js'
import adminOverview from '../../api/admin/overview.js'
import articleSource from '../../api/articles/[id]/source.js'
import { createApp } from '../http/app.js'
import { createRepository } from '../storage/repository.js'
import { studioRequestUrl } from '../../api/studio.js'

test('explicit nested Vercel entry points share the existing API handler', () => {
  for (const entry of [authConfig, authMe, adminOverview, articleSource]) assert.equal(entry, handler)
})

test('studio Vercel rewrite preserves nested paths and query values without permitting traversal', () => {
  assert.equal(studioRequestUrl({ url: '/api/studio?__studioPath=packages%2Fabc%2Fgenerate&limit=5' }), '/api/studio/packages/abc/generate?limit=5')
  assert.equal(studioRequestUrl({ url: '/api/studio/assets/abc/file?__studioPath=assets%2Fabc%2Ffile' }), '/api/studio/assets/abc/file')
  assert.equal(studioRequestUrl({ url: '/api/studio', query: { __studioPath: 'library/sources' } }), '/api/studio/library/sources')
  assert.throws(() => studioRequestUrl({ url: '/api/studio?__studioPath=..%2Fadmin' }))
  assert.throws(() => studioRequestUrl({ url: '/api/studio?__studioPath=config&__studioPath=packages' }))
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
