import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

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
