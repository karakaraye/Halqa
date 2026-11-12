import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Schema changes, applied in order. Each one runs in its own write transaction
 * and re-reads the version inside it, so the web server and the worker can open
 * the same file at the same time without applying a step twice.
 */
const MIGRATIONS: string[] = [
  // 1: account administration.
  `ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN disabled_at INTEGER;`,
  // 2: result intake (one case per lab result per network) and per-client request limits.
  `ALTER TABLE cases ADD COLUMN external_id TEXT;
   CREATE UNIQUE INDEX intake_external_id ON cases(network, external_id);
   CREATE TABLE rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);`,
  // 3: patient message outbox, receipt age and session activity.
  `CREATE TABLE outbox (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), channel TEXT NOT NULL, lang TEXT NOT NULL, to_phone TEXT NOT NULL, template TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED')), attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX pending_outbox ON outbox(status, next_attempt_at);
   ALTER TABLE receipts ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
   UPDATE sessions SET last_seen_at = expires_at - 28800000;`,
  // 4: receiving services of each network and the specialist who answers their referrals.
  `CREATE TABLE services (id TEXT PRIMARY KEY, network TEXT NOT NULL, facility TEXT NOT NULL, specialty TEXT NOT NULL, pathway TEXT NOT NULL,
     specialist_user_id TEXT NOT NULL REFERENCES users(id), disabled_at INTEGER);
   CREATE UNIQUE INDEX service_per_facility ON services(network, facility, pathway);`,
  // 5: a counter that moves on every change to a case row, however it is made, and that stamps the row's
  // version, so parsed cases can be reused safely and only changed rows are read again.
  `INSERT OR IGNORE INTO meta(key,value) VALUES ('cases_version','0');
   CREATE TRIGGER cases_version_insert AFTER INSERT ON cases BEGIN
     UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='cases_version';
     UPDATE cases SET version=(SELECT CAST(value AS INTEGER) FROM meta WHERE key='cases_version') WHERE id=NEW.id; END;
   CREATE TRIGGER cases_version_update AFTER UPDATE ON cases BEGIN
     UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='cases_version';
     UPDATE cases SET version=(SELECT CAST(value AS INTEGER) FROM meta WHERE key='cases_version') WHERE id=NEW.id; END;
   CREATE TRIGGER cases_version_delete AFTER DELETE ON cases BEGIN UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='cases_version'; END;
   UPDATE meta SET value=(SELECT COALESCE(MAX(version),0) FROM cases) WHERE key='cases_version';`,
];
export const SCHEMA_VERSION = MIGRATIONS.length;

const userVersion = (db: DatabaseSync) => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);

function migrate(db: DatabaseSync) {
  for (let step = 1; step <= MIGRATIONS.length; step++) {
    if (userVersion(db) >= step) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (userVersion(db) < step) db.exec(`${MIGRATIONS[step - 1]}\nPRAGMA user_version=${step};`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

const connections = new Map<string, DatabaseSync>();
export function database() {
  const file = resolve(process.env.HALQA_DB_PATH || 'data/halqa.sqlite');
  let db = connections.get(file);
  if (db) return db;
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, person TEXT NOT NULL, network TEXT NOT NULL, patient_case TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, network TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, user_id TEXT, at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits (email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
  `);
  migrate(db);
  connections.set(file, db);
  return db;
}
export function transaction<T>(work: (db: DatabaseSync) => T): T {
  const db = database(); db.exec('BEGIN IMMEDIATE');
  try { const result = work(db); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function closeDatabases() { for (const db of connections.values()) db.close(); connections.clear(); }
