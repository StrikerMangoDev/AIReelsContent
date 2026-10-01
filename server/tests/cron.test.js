import test from 'node:test'
import assert from 'node:assert/strict'
import { createCronHandler } from '../http/cron.js'

const secret = 'test-secret-with-at-least-32-characters'
function response() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value }, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
}
const request = { method: 'GET', headers: { authorization: `Bearer ${secret}` } }

test('cron rejects unauthenticated requests before loading ingestion', async () => {
  const handler = createCronHandler({ secret, loadCollection: () => { throw new Error('must not load') } })
  const res = response()
  await handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 401)
})

test('cron identifies failed storage operation without logging database details or credentials', async () => {
  const logs = []
  const failure = Object.assign(new Error('sensitive row value'), { operation: 'acquire_lease', cause: { code: '42883', message: 'private credential', details: 'private row' } })
  const handler = createCronHandler({ secret, loadCollection: async () => async () => { throw failure }, log: value => logs.push(value) })
  const res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 500)
  assert.equal(logs[0].operation, 'acquire_lease')
  assert.equal(logs[0].causeCode, '42883')
  assert.equal(logs[0].stage, 'collect_feeds')
  assert.equal(res.body.requestId, logs[0].requestId)
  assert.doesNotMatch(JSON.stringify([logs, res.body]), /private|sensitive/)
})

test('publisher-only refresh never loads Vertex and records startup import failures', async () => {
  const handler = createCronHandler({ secret, now: () => new Date('2026-10-01T07:00:00Z'), loadCollection: async () => async () => ({ status: 'success', saved: 5 }), loadIngestion: () => { throw new Error('must not load Vertex') } })
  const res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.collected.saved, 5)
  assert.equal(res.body.curated.status, 'skipped')
  const logs = []
  const broken = createCronHandler({ secret, loadCollection: async () => { throw Object.assign(new Error('private path'), { code: 'ERR_MODULE_NOT_FOUND' }) }, log: value => logs.push(value) })
  await broken(request, response())
  assert.equal(logs[0].stage, 'load_collection')
  assert.equal(logs[0].code, 'ERR_MODULE_NOT_FOUND')
})
