import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createRepository } from '../storage/repository.js'

async function contract(repo) {
  const first = await repo.studioPut('alice', 'package', 'same', { text: 'original', revision: 99, id: 'forged' }, 0)
  assert.equal(first.revision, 1)
  assert.equal(first.id, 'same')
  assert.equal(await repo.studioGet('bob', 'package', 'same'), null)
  assert.deepEqual(await repo.studioList('bob', 'package'), [])
  assert.deepEqual(await repo.studioHistory('bob', 'package', 'same'), [])
  await assert.rejects(async () => repo.studioPut('alice', 'package', 'same', { text: 'overwrite' }, 0), error => error.code === 'STUDIO_CONFLICT')
  const second = await repo.studioPut('alice', 'package', 'same', { text: 'edited' }, 1)
  assert.equal(second.revision, 2)
  assert.equal(second.createdAt, first.createdAt)
  assert.deepEqual((await repo.studioHistory('alice', 'package', 'same')).map(row => row.text), ['edited', 'original'])
  await repo.studioPut('bob', 'package', 'same', { text: 'private' }, 0)
  assert.equal((await repo.studioGet('alice', 'package', 'same')).text, 'edited')
  assert.deepEqual(await repo.studioReserve('alice', 'request', 1), { reserved: true, used: 1, limit: 1 })
  assert.deepEqual(await repo.studioReserve('alice', 'request', 1), { reserved: false, used: 1, limit: 1 })
  await assert.rejects(async () => repo.studioReserve('alice', 'different', 1), error => error.code === 'STUDIO_QUOTA')
  assert.equal((await repo.studioReserve('bob', 'request', 1)).reserved, true)
  const edits = await Promise.allSettled(['first', 'second'].map(text => Promise.resolve().then(() => repo.studioPut('alice', 'package', 'same', { text }, 2))))
  assert.equal(edits.filter(value => value.status === 'fulfilled').length, 1)
  assert.equal(edits.find(value => value.status === 'rejected').reason.code, 'STUDIO_CONFLICT')
  const attempts = await Promise.allSettled(['one', 'two'].map(id => Promise.resolve().then(() => repo.studioReserve('concurrent', id, 1))))
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1)
  assert.equal(attempts.find(value => value.status === 'rejected').reason.code, 'STUDIO_QUOTA')
  const duplicate = await Promise.all(['same', 'same'].map(id => Promise.resolve().then(() => repo.studioReserve('duplicate', id, 2))))
  assert.deepEqual(duplicate.map(value => value.reserved).sort(), [false, true])
}

test('SQLite studio preserves owner isolation, history, optimistic updates and quota idempotency', async () => {
  const repo = createRepository(':memory:')
  try { await contract(repo) } finally { repo.close() }
})

test('PostgreSQL studio migration is repeatable and matches SQLite contract with server-only permissions', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
    const sql = await readFile(new URL('../../supabase/migrations/003_studio.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    async function call(operation, args) {
      try { return (await db.query('select public.signal_studio($1,$2::jsonb) as value', [operation, JSON.stringify(args)])).rows[0].value }
      catch (error) { if (error.code === 'P0002') error.code = 'STUDIO_CONFLICT'; if (error.code === 'P0003') error.code = 'STUDIO_QUOTA'; throw error }
    }
    await db.exec('set role service_role')
    await contract({
      studioGet: (uid, kind, id) => call('get', { uid, kind, id }),
      studioList: (uid, kind) => call('list', { uid, kind }),
      studioHistory: (uid, kind, id) => call('history', { uid, kind, id }),
      studioPut: (uid, kind, id, payload, expectedRevision) => call('put', { uid, kind, id, payload, expectedRevision }),
      studioReserve: (uid, requestId, limit) => call('reserve', { uid, requestId, limit }),
    })
    await db.exec('reset role')
    await db.exec("update signal_studio_reservations set attempted_at=now()-interval '25 hours' where uid='alice'")
    assert.equal((await call('reserve', { uid: 'alice', requestId: 'request', limit: 1 })).reserved, false)
    assert.equal((await call('reserve', { uid: 'alice', requestId: 'new', limit: 1 })).reserved, true)
    await db.exec('set role anon')
    await assert.rejects(call('get', { uid: 'alice', kind: 'package', id: 'same' }), /permission denied/)
    await assert.rejects(db.query('select * from public.signal_studio_records'), /permission denied/)
  } finally { await db.close() }
})
