import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { budgetError, validateAmount, validateBudgetOwner, validateQuote, nextReservation } from '../budget/policy.js'

export function createRepository(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, published_at TEXT NOT NULL, source_id TEXT NOT NULL, payload TEXT NOT NULL, ingested_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS articles_date ON articles(published_at DESC);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, payload TEXT);
    CREATE TABLE IF NOT EXISTS model_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS model_attempts (attempted_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS model_attempts_time ON model_attempts(attempted_at);
    CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS processed (id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, last_seen TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT, type TEXT NOT NULL, path TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_date ON events(created_at);
    CREATE TABLE IF NOT EXISTS studio_records (uid TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(uid,kind,id));
    CREATE TABLE IF NOT EXISTS studio_revisions (uid TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(uid,kind,id,revision));
    CREATE TABLE IF NOT EXISTS studio_reservations (uid TEXT NOT NULL, request_id TEXT NOT NULL, attempted_at INTEGER NOT NULL, PRIMARY KEY(uid,request_id));
    CREATE INDEX IF NOT EXISTS studio_reservations_time ON studio_reservations(uid,attempted_at);
    CREATE TABLE IF NOT EXISTS studio_jobs (uid TEXT NOT NULL, request_id TEXT NOT NULL, attempted_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(uid,request_id));
    CREATE INDEX IF NOT EXISTS studio_jobs_time ON studio_jobs(uid,attempted_at);
    CREATE TABLE IF NOT EXISTS budget_limits (owner TEXT NOT NULL, currency TEXT NOT NULL, limit_micros INTEGER NOT NULL, PRIMARY KEY(owner,currency));
    CREATE TABLE IF NOT EXISTS budget_reservations (owner TEXT NOT NULL, request_id TEXT NOT NULL, currency TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,request_id));
    INSERT OR IGNORE INTO schema_versions VALUES (1);`)

  if (!db.prepare('SELECT 1 FROM schema_versions WHERE version=2').get()) {
    db.exec('BEGIN IMMEDIATE')
    try {
      // Old counters did not record exact timestamps. Preserve their recent usage
      // conservatively when migrating, rather than resetting the user's quota.
      const recent = db.prepare('SELECT calls FROM model_usage WHERE day >= ?').all(new Date(Date.now() - 86400000).toISOString().slice(0, 10))
      const record = db.prepare('INSERT INTO model_attempts VALUES (?)')
      for (const row of recent) for (let index = 0; index < Math.min(Number(row.calls), 10000); index++) record.run(Date.now())
      db.exec('INSERT INTO schema_versions VALUES (2); COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }

  const insert = db.prepare("INSERT INTO articles VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE json_extract(articles.payload, '$.summaryBasis')='publisher-excerpt' AND coalesce(json_extract(excluded.payload, '$.summaryBasis'),'curated') != 'publisher-excerpt'")
  return {
    budgetConfigure(currency, owner, globalLimitMicros, ownerLimitMicros) {
      validateBudgetOwner(owner, currency); validateAmount(globalLimitMicros); validateAmount(ownerLimitMicros)
      db.exec('BEGIN IMMEDIATE')
      try {
        const put = db.prepare('INSERT INTO budget_limits VALUES (?,?,?) ON CONFLICT(owner,currency) DO UPDATE SET limit_micros=excluded.limit_micros')
        put.run('*', currency, globalLimitMicros); put.run(owner, currency, ownerLimitMicros)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    budgetGet(owner, requestId) {
      const row = db.prepare('SELECT payload FROM budget_reservations WHERE owner=? AND request_id=?').get(owner, requestId)
      return row ? JSON.parse(row.payload) : null
    },
    budgetSummary(owner, currency = 'USD') {
      validateBudgetOwner(owner, currency)
      const summary = { currency, limitMicros: db.prepare('SELECT limit_micros FROM budget_limits WHERE owner=? AND currency=?').get(owner, currency)?.limit_micros || 0, heldMicros: 0, settledMicros: 0, overageBlocked: false, unreconciledCount: 0 }
      for (const row of db.prepare('SELECT payload FROM budget_reservations WHERE owner=? AND currency=?').all(owner, currency)) {
        const value = JSON.parse(row.payload)
        if (value.status === 'settled') summary.settledMicros += value.actualMicros
        else if (value.status !== 'cancelled') { summary.heldMicros += value.quote.upperBoundMicros; summary.unreconciledCount++ }
        summary.overageBlocked ||= Boolean(value.overage)
      }
      return summary
    },
    budgetReserve(owner, requestId, scopeHash, quote) {
      validateBudgetOwner(owner, quote?.currency); validateQuote(quote)
      if (typeof requestId !== 'string' || !requestId || requestId.length > 200 || !/^[a-f0-9]{64}$/.test(scopeHash)) throw budgetError('Invalid monetary request')
      db.exec('BEGIN IMMEDIATE')
      try {
        const prior = db.prepare('SELECT payload FROM budget_reservations WHERE owner=? AND request_id=?').get(owner, requestId)
        if (prior) {
          const reservation = JSON.parse(prior.payload)
          if (reservation.scopeHash !== scopeHash || reservation.quote.currency !== quote.currency || reservation.quote.upperBoundMicros !== quote.upperBoundMicros) throw budgetError('Monetary request scope changed')
          db.exec('COMMIT'); return { reserved: false, reservation }
        }
        const rows = db.prepare('SELECT owner,payload FROM budget_reservations WHERE currency=?').all(quote.currency)
        if (rows.some(row => JSON.parse(row.payload).overage)) throw budgetError('Unreconciled overage blocks further reservations')
        let globalUsed = 0; let ownerUsed = 0
        for (const row of rows) {
          const value = JSON.parse(row.payload)
          const amount = value.status === 'settled' ? value.actualMicros : value.status === 'cancelled' ? 0 : value.quote.upperBoundMicros
          globalUsed += amount; if (row.owner === owner) ownerUsed += amount
        }
        const cap = key => db.prepare('SELECT limit_micros FROM budget_limits WHERE owner=? AND currency=?').get(key, quote.currency)?.limit_micros || 0
        if (globalUsed + quote.upperBoundMicros > cap('*') || ownerUsed + quote.upperBoundMicros > cap(owner)) throw budgetError('Global or owner budget exhausted')
        const now = new Date().toISOString()
        const reservation = { id: requestId, scopeHash, quote, status: 'reserved', revision: 1, createdAt: now, updatedAt: now, cancellationRequested: false }
        db.prepare('INSERT INTO budget_reservations VALUES (?,?,?,?)').run(owner, requestId, quote.currency, JSON.stringify(reservation))
        db.exec('COMMIT'); return { reserved: true, reservation }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    budgetTransition(owner, requestId, expectedRevision, action, actualMicros) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const row = db.prepare('SELECT payload FROM budget_reservations WHERE owner=? AND request_id=?').get(owner, requestId)
        const current = row && JSON.parse(row.payload)
        if (!current || !Number.isInteger(expectedRevision) || current.revision !== expectedRevision) throw budgetError('Monetary reservation changed or is unavailable')
        if (action === 'dispatch' && db.prepare("SELECT 1 FROM budget_reservations WHERE currency=? AND json_extract(payload,'$.overage')=1 LIMIT 1").get(current.quote.currency)) throw budgetError('Unreconciled overage blocks dispatch')
        if (action === 'dispatch') {
          let total = 0; let owned = 0
          for (const row of db.prepare('SELECT owner,payload FROM budget_reservations WHERE currency=?').all(current.quote.currency)) {
            const value = JSON.parse(row.payload)
            const amount = value.status === 'settled' ? value.actualMicros : value.status === 'cancelled' ? 0 : value.quote.upperBoundMicros
            total += amount; if (row.owner === owner) owned += amount
          }
          const cap = key => db.prepare('SELECT limit_micros FROM budget_limits WHERE owner=? AND currency=?').get(key, current.quote.currency)?.limit_micros || 0
          if (total > cap('*') || owned > cap(owner)) throw budgetError('Current global or owner budget blocks dispatch')
        }
        const reservation = nextReservation(current, action, actualMicros)
        db.prepare('UPDATE budget_reservations SET payload=? WHERE owner=? AND request_id=?').run(JSON.stringify(reservation), owner, requestId)
        db.exec('COMMIT'); return reservation
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    studioPendingJobs(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid pending job limit')
      return db.prepare("SELECT uid,request_id AS id FROM studio_jobs WHERE json_extract(payload,'$.status')='reserved' AND json_extract(payload,'$.ready')=1 ORDER BY attempted_at,uid,request_id LIMIT ?").all(limit)
    },
    studioJobGet(uid, requestId) {
      const row = db.prepare('SELECT payload FROM studio_jobs WHERE uid=? AND request_id=?').get(uid, requestId)
      return row ? JSON.parse(row.payload) : null
    },
    studioJobReserve(uid, requestId, scopeHash, limit, scope = {}) {
      if (!uid || !requestId || !/^[a-f0-9]{64}$/.test(scopeHash) || !Number.isInteger(limit) || limit < 0 || !scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Invalid job reservation')
      db.exec('BEGIN IMMEDIATE')
      try {
        const row = db.prepare('SELECT payload FROM studio_jobs WHERE uid=? AND request_id=?').get(uid, requestId)
        if (row) {
          const job = JSON.parse(row.payload)
          if (job.scopeHash !== scopeHash) throw Object.assign(new Error('Request scope changed'), { code: 'STUDIO_CONFLICT' })
          db.exec('COMMIT')
          return { reserved: false, job }
        }
        const now = Date.now()
        // Unresolved attempts retain their reservation even after the rolling window.
        const assistance = scope.purpose === 'idea-assistance'
        const used = Number(db.prepare("SELECT count(*) AS total FROM studio_jobs WHERE uid=? AND coalesce(json_extract(payload,'$.scope.purpose')='idea-assistance',0)=? AND (attempted_at>? OR json_extract(payload,'$.status') IN ('reserved','running','dispatch_unknown'))").get(uid, Number(assistance), now - 86400000).total)
        if (used >= (assistance ? Math.min(limit, 10) : limit)) throw Object.assign(new Error('Job allowance reached'), { code: 'STUDIO_QUOTA' })
        const timestamp = new Date(now).toISOString()
        const job = { id: requestId, scopeHash, scope, status: 'reserved', revision: 1, createdAt: timestamp, updatedAt: timestamp }
        db.prepare('INSERT INTO studio_jobs VALUES (?,?,?,?)').run(uid, requestId, now, JSON.stringify(job))
        db.exec('COMMIT')
        return { reserved: true, job }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    studioJobUpdate(uid, requestId, patch, expectedRevision, expectedStatus) {
      const transitions = { reserved: ['running', 'failed', 'cancelled'], running: ['completed', 'failed', 'dispatch_unknown'], dispatch_unknown: ['completed', 'failed'] }
      const publishingReady = expectedStatus === 'reserved' && patch?.status === 'reserved' && patch.ready === true && Object.keys(patch).length === 2
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['status', 'result', 'error', 'ready'].includes(key)) || ('ready' in patch && !publishingReady) || !Number.isInteger(expectedRevision) || (!publishingReady && !transitions[expectedStatus]?.includes(patch.status))) throw Object.assign(new Error('Invalid job transition'), { code: 'STUDIO_CONFLICT' })
      db.exec('BEGIN IMMEDIATE')
      try {
        const row = db.prepare('SELECT payload FROM studio_jobs WHERE uid=? AND request_id=?').get(uid, requestId)
        const current = row && JSON.parse(row.payload)
        if (!current || current.revision !== expectedRevision || current.status !== expectedStatus) throw Object.assign(new Error('Job state changed'), { code: 'STUDIO_CONFLICT' })
        const job = { ...current, ...patch, revision: current.revision + 1, updatedAt: new Date().toISOString() }
        db.prepare('UPDATE studio_jobs SET payload=? WHERE uid=? AND request_id=?').run(JSON.stringify(job), uid, requestId)
        db.exec('COMMIT')
        return job
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    studioDueNiches() {
      return db.prepare("SELECT uid,id FROM studio_records WHERE kind='niche' AND json_extract(payload,'$.autoRefresh')=1 AND json_extract(payload,'$.autoRefreshConsent')=1 ORDER BY id").all()
    },
    studioGet(uid, kind, id) {
      const row = db.prepare('SELECT payload FROM studio_records WHERE uid=? AND kind=? AND id=?').get(uid, kind, id)
      return row ? JSON.parse(row.payload) : null
    },
    studioResearchPage(uid, before = '', beforeId = '') {
      return db.prepare("SELECT id,json_extract(payload,'$.nicheId') AS nicheId,json_extract(payload,'$.researchedAt') AS researchedAt,json_extract(payload,'$.createdAt') AS createdAt FROM studio_records WHERE uid=? AND kind='research' AND (?='' OR json_extract(payload,'$.createdAt')<? OR (json_extract(payload,'$.createdAt')=? AND id<?)) ORDER BY json_extract(payload,'$.createdAt') DESC,id DESC LIMIT 21").all(uid, before, before, before, beforeId)
    },
    studioList(uid, kind) {
      return db.prepare("SELECT payload FROM studio_records WHERE uid=? AND kind=? ORDER BY json_extract(payload,'$.updatedAt') DESC,id").all(uid, kind).map(row => JSON.parse(row.payload))
    },
    studioHistory(uid, kind, id) {
      return db.prepare('SELECT payload FROM studio_revisions WHERE uid=? AND kind=? AND id=? ORDER BY revision DESC').all(uid, kind, id).map(row => JSON.parse(row.payload))
    },
    studioPut(uid, kind, id, payload, expectedRevision) {
      if (!uid || !kind || !id || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid studio record')
      db.exec('BEGIN IMMEDIATE')
      try {
        const row = db.prepare('SELECT revision,payload FROM studio_records WHERE uid=? AND kind=? AND id=?').get(uid, kind, id)
        if (expectedRevision !== undefined && expectedRevision !== (row?.revision ?? 0)) throw Object.assign(new Error('Content changed; reload before saving'), { code: 'STUDIO_CONFLICT' })
        const now = new Date().toISOString()
        const result = { ...payload, id, revision: (row?.revision ?? 0) + 1, createdAt: row ? JSON.parse(row.payload).createdAt : now, updatedAt: now }
        const encoded = JSON.stringify(result)
        db.prepare('INSERT INTO studio_records VALUES (?,?,?,?,?) ON CONFLICT(uid,kind,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(uid, kind, id, result.revision, encoded)
        db.prepare('INSERT INTO studio_revisions VALUES (?,?,?,?,?)').run(uid, kind, id, result.revision, encoded)
        db.exec('COMMIT')
        return result
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    studioReserve(uid, requestId, limit) {
      if (!uid || !requestId || !Number.isInteger(limit) || limit < 0) throw new Error('Invalid studio reservation')
      db.exec('BEGIN IMMEDIATE')
      try {
        const now = Date.now()
        const used = Number(db.prepare('SELECT count(*) AS total FROM studio_reservations WHERE uid=? AND attempted_at>?').get(uid, now - 86400000).total)
        const exists = Boolean(db.prepare('SELECT 1 FROM studio_reservations WHERE uid=? AND request_id=?').get(uid, requestId))
        if (!exists && used >= limit) throw Object.assign(new Error('Studio rolling 24-hour request limit reached'), { code: 'STUDIO_QUOTA' })
        if (!exists) db.prepare('INSERT INTO studio_reservations VALUES (?,?,?)').run(uid, requestId, now)
        db.exec('COMMIT')
        return { reserved: !exists, used: used + Number(!exists), limit }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    close: () => db.close(),
    ping: () => db.prepare('SELECT 1').get(),
    renewLease(name, owner) {
      const now = Date.now()
      const result = db.prepare('UPDATE leases SET expires_at=? WHERE name=? AND owner=? AND expires_at>?').run(now + 600000, name, owner, now)
      if (!result.changes) throw new Error('Ingestion lease lost')
    },
    acquireLease(name, owner, ttlMs = 600000) {
      const now = Date.now()
      return db.prepare('INSERT INTO leases VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE leases.expires_at < ?').run(name, owner, now + ttlMs, now).changes > 0
    },
    releaseLease(name, owner) { db.prepare('DELETE FROM leases WHERE name=? AND owner=?').run(name, owner) },
    reserveModelCall(limit) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const now = Date.now()
        const count = Number(db.prepare('SELECT count(*) AS total FROM model_attempts WHERE attempted_at > ?').get(now - 86400000).total)
        if (count >= Math.min(limit, 2)) throw new Error('Rolling 24-hour Gemini request limit reached')
        db.prepare('INSERT INTO model_attempts VALUES (?)').run(now)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    updateImage(id, imageUrl) {
      db.prepare("UPDATE articles SET payload=json_set(payload, '$.imageUrl', ?) WHERE id=?").run(imageUrl, id)
    },
    updateArticle(article) { db.prepare('UPDATE articles SET payload=? WHERE id=?').run(JSON.stringify(article), article.id) },
    lastSuccessfulRun() {
      const row = db.prepare("SELECT * FROM runs WHERE status IN ('success','degraded') ORDER BY finished_at DESC LIMIT 1").get()
      return row ? { id: row.id, finishedAt: row.finished_at, status: row.status } : null
    },
    upsertUser(user) { db.prepare('INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET email=excluded.email,name=excluded.name,role=excluded.role,last_seen=excluded.last_seen').run(user.uid, user.email, user.name, user.role, new Date().toISOString()) },
    recordEvent(event, uid = null) {
      const now = new Date().toISOString()
      db.prepare('DELETE FROM events WHERE created_at < ?').run(new Date(Date.now() - 90 * 86400000).toISOString())
      db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), event.sessionId, uid, event.type, event.path, JSON.stringify(event), now)
    },
    adminOverview() {
      const since = new Date(Date.now() - 30 * 86400000).toISOString()
      const events = db.prepare('SELECT type,count(*) AS total FROM events WHERE created_at>=? GROUP BY type').all(since)
      const sessions = db.prepare('SELECT count(DISTINCT session_id) AS total FROM events WHERE created_at>=?').get(since)
      const daily = db.prepare('SELECT substr(created_at,1,10) AS day,count(*) AS total FROM events WHERE created_at>=? GROUP BY day ORDER BY day').all(since)
      const recent = db.prepare('SELECT id,type,path,user_id AS userId,created_at AS createdAt,payload FROM events ORDER BY created_at DESC LIMIT 100').all().map(row => ({ ...row, payload: JSON.parse(row.payload) }))
      const users = db.prepare('SELECT uid,email,name,role,last_seen AS lastSeen FROM users ORDER BY last_seen DESC LIMIT 100').all()
      return { period: '30 days', sessions: Number(sessions.total), events, daily, recent, users }
    },
    processed(id) { return Boolean(db.prepare('SELECT 1 FROM processed WHERE id=?').get(id)) },
    processedIds(ids) { const query = db.prepare('SELECT 1 FROM processed WHERE id=?'); return ids.filter(id => query.get(id)) },
    persistBatch(articles, candidates) {
      db.exec('BEGIN IMMEDIATE')
      try {
        let saved = 0
        const now = new Date().toISOString()
        for (const article of articles) saved += Number(insert.run(article.id, article.url, article.publishedAt, article.sourceId, JSON.stringify(article), now).changes)
        const mark = db.prepare('INSERT OR IGNORE INTO processed VALUES (?, ?)')
        for (const candidate of candidates) mark.run(candidate.id, now)
        db.exec('COMMIT')
        return saved
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    startRun() {
      const id = randomUUID()
      db.prepare('INSERT INTO runs VALUES (?, ?, NULL, ?, NULL)').run(id, new Date().toISOString(), 'running')
      return id
    },
    finishRun(id, status, payload) { db.prepare('UPDATE runs SET finished_at=?, status=?, payload=? WHERE id=?').run(new Date().toISOString(), status, JSON.stringify(payload), id) },
    lastRun() {
      const row = db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 1').get()
      return row ? { id: row.id, startedAt: row.started_at, finishedAt: row.finished_at, status: row.status, ...JSON.parse(row.payload || '{}') } : null
    },
    allArticles() { return db.prepare('SELECT payload FROM articles ORDER BY published_at DESC').all().map(row => JSON.parse(row.payload)) },
    articlesSince(since) { return db.prepare('SELECT payload FROM articles WHERE published_at >= ? ORDER BY published_at DESC').all(since).map(row => JSON.parse(row.payload)) },
    queryArticles({ region, category, q, page, limit }) {
      const clauses = []
      const values = []
      if (region && region !== 'Global') { clauses.push("EXISTS (SELECT 1 FROM json_each(articles.payload, '$.regions') WHERE value=?)"); values.push(region) }
      if (category && category !== 'All signals') { clauses.push("json_extract(payload, '$.category')=?"); values.push(category) }
      if (q) {
        clauses.push("instr(lower(json_extract(payload, '$.title') || ' ' || json_extract(payload, '$.summary') || ' ' || json_extract(payload, '$.sourceName') || ' ' || json_extract(payload, '$.tags')), ?) > 0")
        values.push(q.toLowerCase())
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const total = Number(db.prepare(`SELECT count(*) AS total FROM articles${where}`).get(...values).total)
      const articles = db.prepare(`SELECT payload FROM articles${where} ORDER BY published_at DESC LIMIT ? OFFSET ?`).all(...values, limit, (page - 1) * limit).map(row => JSON.parse(row.payload))
      return { articles, total, page, limit }
    },
    find(id) { const row = db.prepare('SELECT payload FROM articles WHERE id=?').get(id); return row ? JSON.parse(row.payload) : null },
  }
}
