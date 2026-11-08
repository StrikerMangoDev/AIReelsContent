import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { DatabaseSync } from 'node:sqlite'
import { createRepository } from '../storage/repository.js'

const hash = 'a'.repeat(64)
const conflict = error => ['STUDIO_CONFLICT', 'P0002'].includes(error.code)
const quota = error => ['STUDIO_QUOTA', 'P0003'].includes(error.code)

async function contract(repository) {
  const scope = { packageId: 'package-one', revision: 3, quoteId: 'quote-one', platforms: ['X'] }
  const first = await repository.studioJobReserve('alice', 'request-one', hash, 2, scope)
  assert.equal(first.reserved, true)
  assert.deepEqual(first.job.scope, scope)
  assert.equal(first.job.status, 'reserved')
  assert.equal((await repository.studioPendingJobs()).some(item => item.id === 'request-one'), false)
  await repository.studioJobReserve('ready-owner', 'ready-one', hash, 1, scope)
  await repository.studioJobUpdate('ready-owner', 'ready-one', { status: 'reserved', ready: true }, 1, 'reserved')
  assert.ok((await repository.studioPendingJobs()).some(item => item.uid === 'ready-owner' && item.id === 'ready-one'))
  await repository.studioJobUpdate('ready-owner', 'ready-one', { status: 'cancelled' }, 2, 'reserved')
  assert.equal((await repository.studioPendingJobs()).some(item => item.id === 'ready-one'), false)
  assert.deepEqual(await repository.studioJobReserve('alice', 'request-one', hash, 0, scope), { reserved: false, job: first.job })
  await assert.rejects(async () => repository.studioJobReserve('alice', 'request-one', 'b'.repeat(64), 2, scope), conflict)
  assert.equal(await repository.studioJobGet('bob', 'request-one'), null)
  await assert.rejects(async () => repository.studioJobUpdate('bob', 'request-one', { status: 'running' }, 1, 'reserved'), conflict)
  const running = await repository.studioJobUpdate('alice', 'request-one', { status: 'running' }, 1, 'reserved')
  assert.equal(running.revision, 2)
  await assert.rejects(async () => repository.studioJobUpdate('alice', 'request-one', { status: 'running' }, 1, 'reserved'), conflict)
  await assert.rejects(async () => repository.studioJobUpdate('alice', 'request-one', { status: 'completed', scope: {} }, 2, 'running'), conflict)
  const unknown = await repository.studioJobUpdate('alice', 'request-one', { status: 'dispatch_unknown', error: 'Provider response was not received' }, 2, 'running')
  assert.equal(unknown.status, 'dispatch_unknown')
  await assert.rejects(async () => repository.studioJobUpdate('alice', 'request-one', { status: 'running' }, 3, 'dispatch_unknown'), conflict)
  const attempts = await Promise.allSettled(['request-two', 'request-three'].map(id => Promise.resolve().then(() => repository.studioJobReserve('alice', id, hash, 2, scope))))
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(item => item.status === 'rejected' && quota(item.reason)).length, 1)
  const completed = await repository.studioJobUpdate('alice', 'request-one', { status: 'completed', result: { packageRevision: 4 } }, 3, 'dispatch_unknown')
  assert.equal(completed.revision, 4)
  assert.deepEqual(completed.scope, scope)
  await assert.rejects(async () => repository.studioJobUpdate('alice', 'request-one', { status: 'running' }, 4, 'completed'), conflict)
  await assert.rejects(async () => repository.studioJobReserve('alice', 'request-four', hash, 2), quota)
  assert.equal((await repository.studioJobReserve('bob', 'request-one', hash, 1)).reserved, true)
  // Assistance cannot exhaust research/content, and arbitrary purposes cannot open buckets.
  const help = { purpose: 'idea-assistance', operation: 'research' }
  for (let i = 0; i < 10; i++) await repository.studioJobReserve('buckets', `content-${i}`, hash, 10, i ? { purpose: 'anything' } : {})
  await assert.rejects(async () => repository.studioJobReserve('buckets', 'other', hash, 10, { purpose: 'other' }), quota)
  for (let i = 0; i < 9; i++) await repository.studioJobReserve('buckets', `help-${i}`, hash, 10, help)
  const admissions = await Promise.allSettled(['help-nine', 'help-ten'].map(id => Promise.resolve().then(() => repository.studioJobReserve('buckets', id, hash, 99, help))))
  assert.equal(admissions.filter(value => value.status === 'fulfilled').length, 1)
  assert.equal(admissions.filter(value => value.status === 'rejected' && quota(value.reason)).length, 1)
  assert.equal((await repository.studioJobReserve('buckets', 'help-0', hash, 0, help)).reserved, false)
  await assert.rejects(async () => repository.studioJobReserve('buckets', 'help-0', 'b'.repeat(64), 10, {}), conflict)
  assert.equal((await repository.studioJobReserve('another-owner', 'help-0', hash, 10, help)).reserved, true)
  await repository.studioJobReserve('reverse', 'help', hash, 1, help)
  await assert.rejects(async () => repository.studioJobReserve('reverse', 'help2', hash, 1, help), quota)
  assert.equal((await repository.studioJobReserve('reverse', 'content', hash, 1)).reserved, true)
}

test('SQLite jobs persist scope, isolate owners, serialize admission and reject stale transitions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'content-jobs-'))
  const path = join(directory, 'jobs.sqlite')
  let repository = createRepository(path)
  try {
    await contract(repository)
    const fixture = new DatabaseSync(path)
    fixture.prepare('UPDATE studio_jobs SET attempted_at=? WHERE uid=?').run(Date.now() - 172800000, 'buckets')
    fixture.close()
    await assert.rejects(async () => repository.studioJobReserve('buckets', 'aged-help', hash, 10, { purpose: 'idea-assistance' }), quota)
    await assert.rejects(async () => repository.studioJobReserve('buckets', 'aged-content', hash, 10), quota)
    repository.close()
    repository = createRepository(path)
    const job = await repository.studioJobGet('alice', 'request-one')
    assert.equal(job.status, 'completed')
    assert.equal(job.scope.quoteId, 'quote-one')
    assert.equal((await repository.studioJobReserve('alice', 'request-one', hash, 0)).reserved, false)
  } finally { repository.close(); await rm(directory, { recursive: true, force: true }) }
})

test('PostgreSQL job RPC matches SQLite contract and denies browser roles', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;')
    const migration = await readFile(new URL('../../supabase/migrations/005_content_jobs.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const quotaMigration = await readFile(new URL('../../supabase/migrations/007_idea_assistance_quota.sql', import.meta.url), 'utf8')
    await db.exec(quotaMigration)
    await db.exec(quotaMigration)
    const call = async (operation, args) => (await db.query('select public.signal_studio_jobs($1,$2::jsonb) value', [operation, JSON.stringify(args)])).rows[0].value
    await db.exec('set role service_role')
    await contract({
      studioPendingJobs: (limit = 20) => call('pending', { limit }),
      studioJobGet: (uid, requestId) => call('get', { uid, requestId }),
      studioJobReserve: (uid, requestId, scopeHash, limit, scope = {}) => call('reserve', { uid, requestId, scopeHash, limit, scope }),
      studioJobUpdate: (uid, requestId, patch, expectedRevision, expectedStatus) => call('update', { uid, requestId, patch, expectedRevision, expectedStatus }),
    })
    // Unknown dispatch must not age out of admission while its cost is unresolved.
    await call('reserve', { uid: 'pending', requestId: 'old', scopeHash: hash, limit: 1, scope: {} })
    await call('update', { uid: 'pending', requestId: 'old', patch: { status: 'running' }, expectedRevision: 1, expectedStatus: 'reserved' })
    await call('update', { uid: 'pending', requestId: 'old', patch: { status: 'dispatch_unknown' }, expectedRevision: 2, expectedStatus: 'running' })
    await db.exec('reset role')
    await db.exec("update public.signal_studio_jobs set attempted_at=now()-interval '2 days' where uid='pending'")
    await db.exec('set role service_role')
    await assert.rejects(call('reserve', { uid: 'pending', requestId: 'new', scopeHash: hash, limit: 1, scope: {} }), quota)
    await db.exec('reset role')
    await db.exec("update public.signal_studio_jobs set attempted_at=now()-interval '2 days' where uid='buckets'")
    await db.exec('set role service_role')
    await assert.rejects(call('reserve', { uid: 'buckets', requestId: 'aged-help', scopeHash: hash, limit: 10, scope: { purpose: 'idea-assistance' } }), quota)
    await assert.rejects(call('reserve', { uid: 'buckets', requestId: 'aged-content', scopeHash: hash, limit: 10, scope: {} }), quota)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      const denied = error => error.code === '42501'
      await assert.rejects(call('pending', { limit: 20 }), denied)
      await assert.rejects(call('get', { uid: 'alice', requestId: 'request-one' }), denied)
      await assert.rejects(call('reserve', { uid: 'alice', requestId: 'browser-request', scopeHash: hash, limit: 99, scope: {} }), denied)
      await assert.rejects(call('update', { uid: 'alice', requestId: 'request-one', patch: { status: 'running' }, expectedRevision: 1, expectedStatus: 'reserved' }), denied)
      await assert.rejects(db.query('select * from public.signal_studio_jobs'), denied)
      await db.exec('reset role')
    }
  } finally { await db.close() }
})
