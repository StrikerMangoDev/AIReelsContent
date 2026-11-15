export function sqliteAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS internal_accounts (
    uid TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')),
    password_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, session_hash TEXT UNIQUE, expires_at INTEGER, last_seen INTEGER);
    CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`)
  return {
    authAccount: email => db.prepare('SELECT * FROM internal_accounts WHERE email=?').get(email) || null,
    authAttempt(key, limit) {
      const now = Date.now()
      db.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').run(now)
      const row = db.prepare('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').get(key, now + 900000)
      return row.count <= limit
    },
    authClaim(uid, passwordHash, tokenHash, currentHash) {
      const now = Date.now()
      return db.prepare(`UPDATE internal_accounts SET session_hash=?, expires_at=?, last_seen=?
        WHERE uid=? AND password_hash=? AND disabled=0 AND
        (session_hash IS NULL OR expires_at<=? OR last_seen<=? OR session_hash=?) RETURNING uid,email,name,role`).get(tokenHash, now + 43200000, now, uid, passwordHash, now, now - 1800000, currentHash) || null
    },
    authSession(tokenHash) {
      const now = Date.now()
      return db.prepare('UPDATE internal_accounts SET last_seen=? WHERE session_hash=? AND disabled=0 AND expires_at>? AND last_seen>? RETURNING uid,email,name,role').get(now, tokenHash, now, now - 1800000) || null
    },
    authLogout: tokenHash => db.prepare('UPDATE internal_accounts SET session_hash=NULL,expires_at=NULL,last_seen=NULL WHERE session_hash=?').run(tokenHash),
    authProvision({ uid, email, name, role, passwordHash }) {
      db.prepare(`INSERT INTO internal_accounts(uid,email,name,role,password_hash) VALUES (?,?,?,?,?)
        ON CONFLICT(uid) DO UPDATE SET email=excluded.email,name=excluded.name,role=excluded.role,password_hash=excluded.password_hash,
        disabled=0,session_hash=NULL,expires_at=NULL,last_seen=NULL`).run(uid, email, name, role, passwordHash)
    },
    authRevoke: uid => db.prepare('UPDATE internal_accounts SET session_hash=NULL,expires_at=NULL,last_seen=NULL WHERE uid=?').run(uid),
  }
}
