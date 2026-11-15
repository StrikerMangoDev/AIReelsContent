import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { createRepository } from '../storage/repository.js'
import { createApp } from '../http/app.js'
import { hashPassword, verifyPassword } from '../auth/password.js'

const password = 'Only-for-local-test-123!'
const account = { uid: 'existing-owner', email: 'owner@example.com', name: 'Owner', role: 'user' }

test('passwords are salted hashes, reject wrong input, and never accept missing hashes', async () => {
  const first = await hashPassword(password)
  const second = await hashPassword(password)
  assert.notEqual(first, second)
  assert.ok(await verifyPassword(password, first))
  assert.equal(await verifyPassword('incorrect', first), false)
  assert.equal(await verifyPassword(password, null), false)
  await assert.rejects(hashPassword('short'))
  assert.doesNotMatch(first, /Only-for/)
})

test('login is exclusive across browsers, preserves ownership, rejects old tokens and revokes sessions on reset', async () => {
  const repository = createRepository(':memory:')
  await repository.authProvision({ ...account, passwordHash: await hashPassword(password) })
  repository.studioPut(account.uid, 'package', 'saved-content', { title: 'Existing draft' }, 0)
  const server = createApp({ repository, sources: [] }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (path, body, cookie, headers = {}) => fetch(`${base}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(body || {}) })
  const login = (pw = password, cookie) => post('login', { email: 'OWNER@example.com', password: pw }, cookie)
  try {
    assert.equal((await login('wrong')).status, 401)
    const results = await Promise.all([login(), login()])
    assert.deepEqual(results.map(r => r.status).sort(), [200,409])
    const success = results.find(r => r.ok)
    const header = success.headers.get('set-cookie')
    assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/)
    let cookie = header.split(';')[0]
    const profile = await success.json()
    assert.equal(profile.uid, account.uid)
    assert.doesNotMatch(JSON.stringify(profile), /password|session_hash/)
    const get = cookie => fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })
    assert.equal((await get(cookie)).status, 200)
    assert.equal(repository.studioGet(account.uid, 'package', 'saved-content').title, 'Existing draft')
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Authorization: 'Bearer old-firebase-token' } })).status, 401)
    for (const path of ['signup','register','reset-password','change-password']) assert.equal((await post(path, {})).status, 404)
    assert.equal((await post('logout', {}, cookie, { 'X-Studio-Request': '' })).status, 403)
    assert.equal((await post('logout', {}, cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
    assert.equal((await get(cookie)).status, 200)
    assert.equal((await post('logout', {}, cookie)).status, 200)
    assert.equal((await get(cookie)).status, 401)
    const second = await login(); assert.equal(second.status, 200)
    cookie = second.headers.get('set-cookie').split(';')[0]
    await repository.authProvision({ ...account, passwordHash: await hashPassword('A-new-backend-password') })
    assert.equal((await get(cookie)).status, 401)
    assert.equal((await login()).status, 401)
    const changed = await login('A-new-backend-password'); assert.equal(changed.status, 200)
    cookie = changed.headers.get('set-cookie').split(';')[0]
    await repository.authRevoke(account.uid)
    assert.equal((await get(cookie)).status, 401)
    assert.equal((await fetch(`${base}/api/admin/overview`, { headers: { Cookie: cookie } })).status, 401)
    for (let i=0;i<10;i++) await login('wrong')
    assert.equal((await login('A-new-backend-password')).status, 429)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); repository.close() }
})

test('Postgres migration enforces private access, exclusive sessions, expiry and reset races', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
    await db.exec(await readFile(new URL('../../supabase/migrations/20261115104332_internal_login.sql', import.meta.url), 'utf8'))
    const call = async (operation, args) => (await db.query('select public.signal_internal_auth($1,$2::jsonb) as result', [operation,JSON.stringify(args)])).rows[0].result
    const passwordHash = await hashPassword(password)
    await call('provision', { ...account, passwordHash })
    const tokenHash = createHash('sha256').update('first').digest('hex')
    const claim = { uid: account.uid,passwordHash,tokenHash,currentHash:'' }
    assert.equal((await call('claim',claim)).uid,account.uid)
    assert.equal(await call('claim',{...claim,tokenHash:'other'}),null)
    assert.equal((await call('session',{tokenHash})).uid,account.uid)
    await db.exec("update public.signal_internal_accounts set last_seen=now()-interval '31 minutes'")
    assert.equal(await call('session',{tokenHash}),null)
    assert.ok(await call('claim',{...claim,tokenHash:'second'}))
    await db.exec("update public.signal_internal_accounts set expires_at=now()-interval '1 second'")
    assert.equal(await call('session',{tokenHash:'second'}),null)
    await call('provision',{...account,passwordHash:await hashPassword('Changed-backend-password')})
    assert.equal(await call('claim',claim),null,'password reset wins over a stale verified login')
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from public.signal_internal_accounts'),/permission denied/)
    await assert.rejects(call('account',{email:account.email}),/permission denied/)
    await db.exec('reset role; set role authenticated')
    await assert.rejects(call('provision',{...account,passwordHash}),/permission denied/)
    await db.exec('reset role; set role service_role')
    assert.equal((await call('account',{email:account.email})).uid,account.uid)
    assert.ok(await call('attempt',{key:'email-test',limit:1}))
    assert.equal(await call('attempt',{key:'email-test',limit:1}),false)
  } finally { await db.close() }
})
