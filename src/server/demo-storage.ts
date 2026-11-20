import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabases, database, SCHEMA_VERSION, sqlitePath, transaction } from './db';

const MAX_BYTES = 8 * 1024 * 1024;
let pool: Pool | undefined;
let loadedRevision: string | undefined;
let initialized = false;

async function rotateSeedPassword() {
  const previous = [process.env.HALQA_DEMO_PREVIOUS_PASSWORD, process.env.HALQA_DEMO_SEED_PASSWORD].filter(Boolean) as string[];
  const next = process.env.HALQA_DEMO_ROTATED_PASSWORD;
  if (!previous.length || !next) return;
  if (next.length < 12) throw new Error('The replacement demo password must have at least 12 characters.');
  const marker = createHash('sha256').update(next).digest('hex');
  const { hashPassword, verifyPassword } = await import('./auth');
  transaction(db => {
    const applied = db.prepare("SELECT value FROM meta WHERE key='demo_password_rotation'").get() as { value: string } | undefined;
    if (applied?.value === marker) return;
    const accounts = db.prepare('SELECT id, password_hash FROM users').all() as { id: string; password_hash: string }[];
    const update = db.prepare('UPDATE users SET password_hash=? WHERE id=?');
    for (const account of accounts) {
      if (previous.some(password => password !== next && verifyPassword(password, account.password_hash))) {
        update.run(hashPassword(next), account.id);
      }
    }
    db.exec('DELETE FROM sessions');
    db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('demo_password_rotation',?)").run(marker);
  });
}

/**
 * Temporary synthetic-demo storage. Serialize API requests and worker ticks across
 * processes, preserving the existing SQLite constraints and transactions. Persist a
 * closed, consistent copy before returning a response for a mutation.
 */
export async function withDemoStorage<T>(work: () => T | Promise<T>): Promise<T> {
  const connectionString = process.env.HALQA_DEMO_POSTGRES_URL;
  if (!connectionString) return work();
  if (!process.env.HALQA_DB_PATH || process.env.HALQA_TEST_CONTROLS === '1' || process.env.HALQA_MESSAGE_WEBHOOK_URL) {
    throw new Error('Demo storage requires a process-local SQLite path and synthetic-only settings.');
  }
  if (!pool) {
    pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
    pool.on('error', () => console.error('The demo database disconnected while idle.'));
  }
  const client = await pool.connect();
  const file = sqlitePath();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '8s'");
    await client.query('SELECT pg_advisory_xact_lock(176910, 1)');
    if (!initialized) await client.query(`
      CREATE TABLE IF NOT EXISTS halqa_demo_snapshot (
        id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL, sqlite bytea NOT NULL
      )
    `);
    const { rows: [head] } = await client.query<{ revision: string }>('SELECT revision FROM halqa_demo_snapshot WHERE id = 1');
    let migrated = false;
    if (!head || loadedRevision !== head.revision) {
      loadedRevision = undefined;
      closeDatabases();
      for (const path of [file, `${file}-wal`, `${file}-shm`]) rmSync(path, { force: true });
      if (head) {
        const { rows: [snapshot] } = await client.query<{ sqlite: Buffer }>('SELECT sqlite FROM halqa_demo_snapshot WHERE id = 1');
        writeFileSync(file, snapshot.sqlite, { mode: 0o600 });
        const restored = new DatabaseSync(file, { readOnly: true });
        try {
          migrated = (restored.prepare('PRAGMA user_version').get() as { user_version: number }).user_version < SCHEMA_VERSION;
        } finally {
          restored.close();
        }
      } else {
        const password = process.env.HALQA_DEMO_SEED_PASSWORD;
        if (!password || password.length < 24) throw new Error('Set a private demo seed password of at least 24 characters.');
        const { bootstrap } = await import('./bootstrap');
        bootstrap(password);
      }
    }
    const db = database();
    const changes = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    if (!initialized) await rotateSeedPassword();
    const result = await work();
    let revision = head?.revision;
    if (!head || migrated || changes() !== before) {
      const copy = `${file}.snapshot`;
      try {
        rmSync(copy, { force: true });
        db.prepare('VACUUM INTO ?').run(copy);
        if (statSync(copy).size > MAX_BYTES) throw new Error('Demo storage limit reached.');
        const bytes = readFileSync(copy);
        const update = await client.query<{ revision: string }>(`
          INSERT INTO halqa_demo_snapshot (id, revision, sqlite) VALUES (1, 1, $1)
          ON CONFLICT (id) DO UPDATE SET revision = halqa_demo_snapshot.revision + 1, sqlite = EXCLUDED.sqlite
          RETURNING revision
        `, [bytes]);
        revision = update.rows[0].revision;
      } finally {
        rmSync(copy, { force: true });
      }
    }
    await client.query('COMMIT');
    loadedRevision = revision;
    initialized = true;
    return result;
  } catch (error) {
    loadedRevision = undefined;
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) { releaseError = rollbackError as Error; }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
