import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('PostgreSQL lease repair is repeatable and preserves lease ownership and run history', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;')
    const schema = await readFile(new URL('../../supabase/migrations/001_signal.sql', import.meta.url), 'utf8')
    const repair = await readFile(new URL('../../supabase/migrations/002_fix_lease_interval.sql', import.meta.url), 'utf8')
    // Reproduce the deployed defect, then apply the forward migration.
    await db.exec(schema.replace('make_interval(secs => ', 'make_interval(secs='))
    const call = async (operation, args = {}) => (await db.query('select public.signal_repository($1, $2::jsonb) as value', [operation, JSON.stringify(args)])).rows[0].value
    await assert.rejects(call('acquire_lease', { name: 'ingestion', owner: 'first' }), error => error.code === '42703')
    await db.exec(repair)
    await db.exec(repair)
    assert.equal(await call('acquire_lease', { name: 'ingestion', owner: 'first' }), true)
    assert.equal(await call('acquire_lease', { name: 'ingestion', owner: 'second' }), false)
    await call('release_lease', { name: 'ingestion', owner: 'second' })
    assert.equal(await call('acquire_lease', { name: 'ingestion', owner: 'second' }), false)
    await call('release_lease', { name: 'ingestion', owner: 'first' })
    assert.equal(await call('acquire_lease', { name: 'ingestion', owner: 'second' }), true)
    const run = await call('start_run')
    await call('finish_run', { id: run, status: 'success', payload: { saved: 2 } })
    assert.equal((await call('last_successful_run')).saved, 2)
  } finally { await db.close() }
})
