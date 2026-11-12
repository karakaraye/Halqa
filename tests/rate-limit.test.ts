import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { HttpError, login, tokenHash } from '../src/server/auth';
import { createAccount } from '../src/server/accounts';
import { RATE_LIMITS, rateLimit, RateLimitRule } from '../src/server/rate-limit';
import { POST as intake } from '../src/app/api/intake/results/route';
import { POST as delivery } from '../src/app/api/intake/delivery/route';
import { POST as password } from '../src/app/api/account/password/route';
import { GET as listUsers, POST as createUser } from '../src/app/api/admin/users/route';
import { POST as disableUser } from '../src/app/api/admin/users/[id]/disable/route';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-limits-')), 'workspace.sqlite');
process.env.HALQA_INTAKE_KEY_SHA256 = tokenHash('limits-intake-key');
process.env.HALQA_DELIVERY_KEY_SHA256 = tokenHash('limits-delivery-key');
after(closeDatabases);

const from = (address: string, path = '/api/intake/results', init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? 'POST', headers: { 'x-forwarded-for': address, 'content-type': 'application/json', origin: 'http://localhost:3000', ...init.headers }, body: init.body ?? (init.method === 'GET' ? undefined : '{}') });
const status = (fn: () => void) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : 500; } };

test('each limit allows its maximum per client and window, then answers 429 until the window resets', () => {
  const now = Date.now();
  for (const rule of Object.keys(RATE_LIMITS) as RateLimitRule[]) {
    const { maximum, windowMs } = RATE_LIMITS[rule];
    const client = from(`198.51.100.${rule.length}`);
    for (let i = 0; i < maximum; i++) assert.equal(status(() => rateLimit(client, rule, now)), 200, `${rule} ${i}`);
    assert.equal(status(() => rateLimit(client, rule, now + 1)), 429, rule);
    assert.equal(status(() => rateLimit(from('198.51.100.200'), rule, now + 1)), 200, 'another client is not affected');
    assert.equal(status(() => rateLimit(client, rule, now + windowMs)), 200, `${rule} resets`);
  }
  // Only hashes of client addresses are stored.
  assert.ok(!JSON.stringify(database().prepare('SELECT * FROM rate_limits').all()).includes('198.51.100'));
});

async function untilLimited(rule: RateLimitRule, send: () => Promise<Response>) {
  for (let i = 0; i < RATE_LIMITS[rule].maximum; i++) assert.notEqual((await send()).status, 429, `${rule} request ${i + 1}`);
  const limited = await send();
  assert.equal(limited.status, 429, rule);
  assert.match((await limited.json()).error, /Too many requests/);
}

test('the intake, delivery, password and admin routes answer 429 per client and recover after the window', async () => {
  await untilLimited('intake', () => intake(from('203.0.113.1', '/api/intake/results', { headers: { authorization: 'Bearer wrong' } })));
  await untilLimited('delivery', () => delivery(from('203.0.113.2', '/api/intake/delivery', { headers: { authorization: 'Bearer wrong' } })));
  await untilLimited('password', () => password(from('203.0.113.3', '/api/account/password')));
  await untilLimited('admin', () => listUsers(from('203.0.113.4', '/api/admin/users', { method: 'GET' })));
  // Admin routes share one counter per client.
  assert.equal((await createUser(from('203.0.113.4', '/api/admin/users'))).status, 429);
  assert.equal((await disableUser(from('203.0.113.4', '/api/admin/users/x/disable'), { params: Promise.resolve({ id: 'x' }) })).status, 429);
  // A different client still gets through to authentication.
  assert.equal((await intake(from('203.0.113.9', '/api/intake/results', { headers: { authorization: 'Bearer wrong' } }))).status, 401);
  // Once the window has passed the client is served again.
  database().prepare('UPDATE rate_limits SET reset_at=?').run(Date.now() - 1);
  assert.equal((await intake(from('203.0.113.1', '/api/intake/results', { headers: { authorization: 'Bearer wrong' } }))).status, 401);
  assert.equal((await password(from('203.0.113.3', '/api/account/password'))).status, 401);
});

test('the sign-in limit is unchanged: eight failures per email and client', () => {
  const account = createAccount({ email: 'limit-check@example.test', name: 'Limit check', role: 'PCP', org: 'Test clinic' }, 'clinic', 'setup');
  for (let i = 0; i < 8; i++) assert.equal(status(() => login(account.account.email, 'wrong', 'client-x')), 401);
  assert.equal(status(() => login(account.account.email, account.temporaryPassword, 'client-x')), 429);
  assert.equal(status(() => login(account.account.email, account.temporaryPassword, 'client-y')), 200);
});
