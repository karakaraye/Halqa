import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { changePassword, createAccount } from '../src/server/accounts';
import { LAST_SEEN_STEP_MS, SESSION_HOURS, login, sessionFor, sessionIdleMs, tokenHash } from '../src/server/auth';
import { cleanup } from '../src/server/maintenance';
import { POST as signIn } from '../src/app/api/session/route';
import { POST as revokeAll } from '../src/app/api/session/revoke-all/route';
import { POST as setPassword } from '../src/app/api/account/password/route';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-sessions-')), 'workspace.sqlite');
delete process.env.HALQA_SESSION_IDLE_MINUTES;
delete process.env.HALQA_ORIGIN;
after(closeDatabases);
afterEach(() => { delete process.env.HALQA_SESSION_IDLE_MINUTES; delete process.env.HALQA_ORIGIN; });

let count = 0;
function person(mustChange = false) {
  count++;
  const made = createAccount({ email: `session-${count}@example.test`, name: `Session person ${count}`, role: 'NAVIGATOR', org: 'Hub' }, 'clinic', 'setup');
  if (mustChange) return { ...made.account, password: made.temporaryPassword };
  const password = `session-own-password-${count}`;
  changePassword(made.account.id, { currentPassword: made.temporaryPassword, newPassword: password });
  return { ...made.account, password };
}
const lastSeen = (token: string) => (database().prepare('SELECT last_seen_at FROM sessions WHERE token_hash=?').get(tokenHash(token)) as { last_seen_at: number } | undefined)?.last_seen_at;

test('idle limit: default 30 minutes, configurable, and bad values fall back to the default', () => {
  assert.equal(sessionIdleMs(undefined), 30 * 60_000);
  assert.equal(sessionIdleMs('5'), 5 * 60_000);
  assert.equal(sessionIdleMs('0'), 30 * 60_000);
  assert.equal(sessionIdleMs('481'), 30 * 60_000);
  assert.equal(sessionIdleMs('ten'), 30 * 60_000);
});

test('a session ends after the idle limit without requests, and activity keeps it going up to the absolute limit', () => {
  const user = person();
  const start = Date.now();
  const { token } = login(user.email, user.password);
  const idle = sessionIdleMs();
  // Activity just before the limit is accepted and recorded.
  assert.ok(sessionFor(token, start + idle - 1000));
  assert.equal(lastSeen(token), start + idle - 1000);
  // Measured from that last request, not from sign-in.
  assert.ok(sessionFor(token, start + 2 * idle - 2000));
  // Then a full idle period passes with nothing.
  assert.equal(sessionFor(token, start + 3 * idle), undefined);
  assert.equal(lastSeen(token), undefined, 'the idle session is deleted');

  // Constant activity never outlasts the absolute lifetime.
  const busy = login(user.email, user.password);
  const t0 = Date.now();
  for (let t = t0; t < t0 + SESSION_HOURS * 3600_000; t += idle / 2) assert.ok(sessionFor(busy.token, t));
  assert.equal(sessionFor(busy.token, t0 + SESSION_HOURS * 3600_000 + 1), undefined);
});

test('the idle limit follows HALQA_SESSION_IDLE_MINUTES', () => {
  process.env.HALQA_SESSION_IDLE_MINUTES = '5';
  const user = person();
  const start = Date.now();
  const { token } = login(user.email, user.password);
  assert.ok(sessionFor(token, start + 4 * 60_000));
  assert.equal(sessionFor(token, start + 9 * 60_000 + 1), undefined);
});

test('last_seen_at is written at most once a minute, so polling does not write on every read', () => {
  const user = person();
  const start = Date.now();
  const { token } = login(user.email, user.password);
  const first = lastSeen(token)!;
  sessionFor(token, first + 3000);
  assert.equal(lastSeen(token), first);
  sessionFor(token, first + LAST_SEEN_STEP_MS);
  assert.equal(lastSeen(token), first + LAST_SEEN_STEP_MS);
  assert.ok(first >= start);
});

test('cleanup removes idle sessions as well as expired ones', () => {
  const user = person();
  const { token } = login(user.email, user.password);
  const now = Date.now();
  assert.equal(cleanup(now).sessions, 0);
  assert.ok(lastSeen(token));
  assert.ok(cleanup(now + sessionIdleMs()).sessions >= 1);
  assert.equal(lastSeen(token), undefined);
});

const signInRequest = (email: string, password: string, origin = 'http://localhost:3000') => new NextRequest(`${origin}/api/session`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
});

test('the session cookie is Secure whenever HALQA_ORIGIN is https, even when the proxy talks plain http to the app', async () => {
  const user = person();
  const plain = await signIn(signInRequest(user.email, user.password));
  assert.match(plain.headers.get('set-cookie')!, /HttpOnly/i);
  assert.match(plain.headers.get('set-cookie')!, /SameSite=strict/i);
  assert.doesNotMatch(plain.headers.get('set-cookie')!, /Secure/i, 'local development over http');

  process.env.HALQA_ORIGIN = 'https://halqa.example.org';
  const proxied = new NextRequest('http://127.0.0.1:3000/api/session', {
    method: 'POST', headers: { origin: 'https://halqa.example.org', 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const secure = await signIn(proxied);
  assert.equal(secure.status, 200);
  assert.match(secure.headers.get('set-cookie')!, /;\s*Secure/i);
  const { csrf } = await secure.json();
  const token = secure.cookies.get('halqa_session')!.value;
  const changed = await setPassword(new NextRequest('http://127.0.0.1:3000/api/account/password', {
    method: 'POST', headers: { origin: 'https://halqa.example.org', cookie: `halqa_session=${token}`, 'x-halqa-csrf': csrf, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: user.password, newPassword: 'a-different-password-9' }),
  }));
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get('set-cookie')!, /;\s*Secure/i, 'the cookie issued after a password change is Secure too');
});

const revoke = (token: string, csrf?: string, origin = 'http://localhost:3000') => revokeAll(new NextRequest('http://localhost:3000/api/session/revoke-all', {
  method: 'POST', headers: { origin, cookie: `halqa_session=${token}`, ...(csrf ? { 'x-halqa-csrf': csrf } : {}) },
}));

test('POST /api/session/revoke-all ends every session of the account and only that account', async () => {
  const user = person();
  const other = person();
  const phone = login(user.email, user.password);
  const desk = login(user.email, user.password);
  const someoneElse = login(other.email, other.password);
  assert.equal((await revoke(desk.token)).status, 403, 'CSRF token required');
  assert.equal((await revoke(desk.token, desk.csrf, 'https://elsewhere.example')).status, 403, 'origin checked');
  assert.equal((await revoke('not-a-session', desk.csrf)).status, 401);
  assert.ok(sessionFor(phone.token) && sessionFor(desk.token), 'refused calls changed nothing');

  // Two sign-ins here plus the session issued when the account set its own password.
  const held = (database().prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(user.id) as { n: number }).n;
  assert.equal(held, 3);
  const response = await revoke(desk.token, desk.csrf);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sessions: 3 });
  assert.equal((database().prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(user.id) as { n: number }).n, 0);
  assert.match(response.headers.get('set-cookie')!, /halqa_session=;/);
  assert.match(response.headers.get('set-cookie')!, /Max-Age=0/i);
  assert.equal(sessionFor(phone.token), undefined);
  assert.equal(sessionFor(desk.token), undefined);
  assert.ok(sessionFor(someoneElse.token), 'another account keeps its session');
  const audit = database().prepare("SELECT user_id, detail FROM events WHERE action='SESSIONS_REVOKED'").all() as { user_id: string; detail: string }[];
  assert.deepEqual(audit.map((a) => ({ ...a })), [{ user_id: user.id, detail: '{"sessions":3}' }]);
});

test('revoke-all works while the password is still temporary', async () => {
  const fresh = person(true);
  const s = login(fresh.email, fresh.password);
  assert.equal(s.user.mustChangePassword, true);
  assert.equal((await revoke(s.token, s.csrf)).status, 200);
  assert.equal(sessionFor(s.token), undefined);
});

test('recording activity never waits for the write lock held by another process', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const user = person();
  const { token } = login(user.email, user.password);
  const before = lastSeen(token)!;
  const other = new DatabaseSync(process.env.HALQA_DB_PATH!);
  other.exec('BEGIN IMMEDIATE');
  try {
    const started = Date.now();
    assert.ok(sessionFor(token, before + LAST_SEEN_STEP_MS), 'the session still works');
    assert.ok(Date.now() - started < 1000, 'answered without waiting for the lock');
  } finally { other.exec('ROLLBACK'); other.close(); }
  assert.equal(lastSeen(token), before, 'the write was skipped, not queued');
  sessionFor(token, before + LAST_SEEN_STEP_MS);
  assert.equal(lastSeen(token), before + LAST_SEEN_STEP_MS, 'and made on the next request');
});
