import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { bootstrap } from '../src/server/bootstrap';
import { createAccount, changePassword as setNewPassword } from '../src/server/accounts';
import { login, tokenHash, verifyPassword } from '../src/server/auth';
import { cleanup, RECEIPT_KEEP_MS } from '../src/server/maintenance';
import { RATE_LIMITS } from '../src/server/rate-limit';
import { GET as health } from '../src/app/api/health/route';
import { POST as signIn } from '../src/app/api/session/route';
import { POST as createUser } from '../src/app/api/admin/users/route';
import { backupDatabase, backupName } from '../scripts/backup';

const root = mkdtempSync(join(tmpdir(), 'halqa-ops-'));
process.env.HALQA_DB_PATH = join(root, 'workspace.sqlite');
process.env.HALQA_TEST_CONTROLS = '1';
after(() => { closeDatabases(); rmSync(root, { recursive: true, force: true }); });

const req = (path: string, init: { method?: string; headers?: Record<string, string>; payload?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? 'GET',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...(init.payload === undefined ? {} : { body: JSON.stringify(init.payload) }),
  });

/** Runs the work and returns every line written with console.log. */
async function captureLog(work: () => Promise<void>) {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => { lines.push(parts.join(' ')); };
  try { await work(); } finally { console.log = original; }
  return lines;
}

test('health answers 200 {ok:true} with no sign-in and no cookie, and says nothing else', async () => {
  const response = await health(req('/api/health'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-halqa-error-name'), null);
  assert.equal(RATE_LIMITS.health.maximum, 600);
});

test('health answers 503 {ok:false} when the database cannot be read', async () => {
  closeDatabases();
  const saved = process.env.HALQA_DB_PATH;
  process.env.HALQA_DB_PATH = root; // a directory, so it cannot be opened as a database
  try {
    const lines = await captureLog(async () => {
      const response = await health(req('/api/health'));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false });
    });
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).status, 503);
  } finally { process.env.HALQA_DB_PATH = saved; }
});

test('health is answered while an account must still change its password', async () => {
  const made = createAccount({ email: 'forced@example.test', name: 'Forced Change', role: 'PCP', org: 'Test clinic' }, 'ops-network', 'setup');
  const session = login(made.account.email, made.temporaryPassword);
  assert.equal(session.user.mustChangePassword, true);
  const response = await health(req('/api/health', { headers: { cookie: `halqa_session=${session.token}` } }));
  assert.equal(response.status, 200);
});

test('request logs hold only time, route, method, status and error name', async () => {
  const lead = createAccount({ email: 'ops.lead@example.test', name: 'Ops Lead', role: 'LEAD', org: 'Programme office' }, 'ops-network', 'setup');
  const own = setNewPassword(lead.account.id, { currentPassword: lead.temporaryPassword, newPassword: 'ops-lead-own-password-1' });
  const secrets = [lead.account.email, 'wrong-password-value', lead.temporaryPassword, 'ops-lead-own-password-1', own.token, own.csrf, 'new.person@example.test', 'New Person Name', '+971500000000'];
  const lines = await captureLog(async () => {
    const failed = await signIn(req('/api/session', { method: 'POST', payload: { email: lead.account.email, password: 'wrong-password-value' } }));
    assert.equal(failed.status, 401);
    const wrote = await createUser(req('/api/admin/users', {
      method: 'POST',
      headers: { cookie: `halqa_session=${own.token}`, 'x-halqa-csrf': own.csrf },
      payload: { email: 'new.person@example.test', name: 'New Person Name', role: 'PCP', org: 'Clinic' },
    }));
    assert.equal(wrote.status, 201);
    assert.equal((await wrote.json()).account.email, 'new.person@example.test'); // the answer has it; the log must not
  });
  assert.equal(lines.length, 2, 'one line for the failed sign-in and one for the write');
  const [failedLine, writeLine] = lines.map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(failedLine).sort(), ['error', 'method', 'route', 'status', 'time']);
  assert.equal(failedLine.route, '/api/session'); assert.equal(failedLine.method, 'POST'); assert.equal(failedLine.status, 401); assert.equal(failedLine.error, 'HttpError');
  assert.deepEqual(Object.keys(writeLine).sort(), ['method', 'route', 'status', 'time']);
  assert.equal(writeLine.route, '/api/admin/users'); assert.equal(writeLine.status, 201);
  assert.ok(!Number.isNaN(Date.parse(failedLine.time)));
  const all = lines.join('\n');
  for (const secret of secrets) assert.ok(!all.includes(secret), `the log must not contain ${secret}`);
  // A plain read that succeeds is not logged.
  assert.deepEqual(await captureLog(async () => { await health(req('/api/health')); }), []);
});

test('backup writes a standalone copy with the same cases and refuses to overwrite', () => {
  const source = join(mkdtempSync(join(root, 'source-')), 'halqa.sqlite');
  closeDatabases();
  process.env.HALQA_DB_PATH = source;
  const accounts = bootstrap('backup-test-password-1');
  const db = database();
  const cases = Number((db.prepare('SELECT COUNT(*) AS n FROM cases').get() as { n: number }).n);
  assert.ok(cases > 0);
  login(accounts[0].email, 'backup-test-password-1'); // a live session exists in the source
  const directory = join(root, 'backups', 'nested');
  const when = new Date(Date.UTC(2026, 10, 12, 8, 30, 15, 123));
  const copy = backupDatabase(directory, when);
  assert.equal(copy, join(directory, 'halqa-20261112T083015Z.sqlite'));
  assert.equal(backupName(when), 'halqa-20261112T083015Z.sqlite');
  assert.throws(() => backupDatabase(directory, when), /already exists/);
  closeDatabases();
  rmSync(join(source, '..'), { recursive: true, force: true });
  assert.ok(!existsSync(source), 'the source is gone; the copy stands alone');
  const restored = new DatabaseSync(copy, { readOnly: true });
  assert.equal(Number((restored.prepare('SELECT COUNT(*) AS n FROM cases').get() as { n: number }).n), cases);
  // Signing in needs only the account row: no session from the source is used.
  const row = restored.prepare('SELECT password_hash FROM users WHERE email=?').get(accounts[0].email) as { password_hash: string };
  assert.ok(verifyPassword('backup-test-password-1', row.password_hash));
  assert.ok(Number((restored.prepare('SELECT user_version FROM pragma_user_version').get() as { user_version: number }).user_version) > 0);
  restored.close();
  assert.throws(() => backupDatabase(''), /Give the directory/);
});

test('cleanup removes expired sessions, old receipts and past limit rows in one pass', () => {
  closeDatabases();
  process.env.HALQA_DB_PATH = join(root, 'cleanup.sqlite');
  const db = database();
  const now = Date.UTC(2026, 10, 12);
  db.prepare("INSERT INTO users(id,email,password_hash,person,network) VALUES ('u1','u1@example.test','x:y','{}','n')").run();
  const session = db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_seen_at) VALUES (?,?,?,?,?)');
  session.run(tokenHash('old'), 'u1', 'c', now - 1, 0);
  session.run(tokenHash('live'), 'u1', 'c', now + 3600_000, now);
  const receipt = db.prepare('INSERT INTO receipts(id,user_id,payload_hash,created_at) VALUES (?,?,?,?)');
  receipt.run('r-old', 'u1', 'h', now - RECEIPT_KEEP_MS - 1);
  receipt.run('r-new', 'u1', 'h', now - RECEIPT_KEEP_MS + 1000);
  const limit = db.prepare('INSERT INTO rate_limits(key,attempts,reset_at) VALUES (?,?,?)');
  limit.run('past', 5, now - 1); limit.run('future', 5, now + 60_000);
  db.prepare('INSERT INTO login_limits(email,attempts,reset_at) VALUES (?,?,?)').run('a|b', 3, now - 1);
  const result = cleanup(now);
  assert.deepEqual(result, { sessions: 1, receipts: 1, rateLimits: 1, loginLimits: 1 });
  const left = (sql: string) => (db.prepare(sql).all() as Record<string, string>[]).map((r) => Object.values(r)[0]);
  assert.deepEqual(left('SELECT token_hash FROM sessions'), [tokenHash('live')]);
  assert.deepEqual(left('SELECT id FROM receipts'), ['r-new']);
  assert.deepEqual(left('SELECT key FROM rate_limits'), ['future']);
  assert.deepEqual(cleanup(now), { sessions: 0, receipts: 0, rateLimits: 0, loginLimits: 0 });
});
