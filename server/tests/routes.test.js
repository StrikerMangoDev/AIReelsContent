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

test('explicit nested Vercel entry points share the existing API handler', () => {
  for (const entry of [authConfig, authMe, adminOverview, articleSource]) assert.equal(entry, handler)
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
