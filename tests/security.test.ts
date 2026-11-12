import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { createAccount, changePassword } from '../src/server/accounts';
import { HttpError, login, sameSecret, sessionFor, tokenHash } from '../src/server/auth';
import { clientAddress, RATE_LIMITS, trustedProxyHops } from '../src/server/rate-limit';
import { authenticateIntegration, configuredKeyHashes } from '../src/server/integration';
import { deliverPending, webhookAddressProblem, WebhookAddressRefused } from '../src/server/delivery';
import { domainRefusal, execute, getSnapshot } from '../src/server/workspace';
import { databaseErrorText, failure } from '../src/server/http';
import { receiveResult } from '../src/server/intake';
import { API_POLICY, newNonce, pagePolicy } from '../src/server/csp';
import { proxy } from '../src/proxy';
import { POST as signIn, DELETE as signOut } from '../src/app/api/session/route';
import { POST as workspaceWrite } from '../src/app/api/workspace/route';
// The Halqa web server (plain JavaScript, run by node directly).
import { setClientAddress } from '../scripts/web.mjs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../next.config.js') as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-security-')), 'workspace.sqlite');
delete process.env.HALQA_TRUST_PROXY;
delete process.env.HALQA_TEST_CONTROLS;
delete process.env.HALQA_ORIGIN;
after(closeDatabases);

const ORIGIN = 'http://localhost:3000';
const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : 500; } };
const signInRequest = (email: string, password: string, forwardedFor: string, cookie?: string) => new NextRequest(`${ORIGIN}/api/session`, {
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': forwardedFor, ...(cookie ? { cookie: `halqa_session=${cookie}` } : {}) },
  body: JSON.stringify({ email, password }),
});
const account = (slug: string, role: 'NAVIGATOR' | 'PCP' | 'LEAD' = 'NAVIGATOR', org = 'Hub') => {
  const made = createAccount({ email: `${slug}@example.test`, name: `Account ${slug}`, role, org, ...(role === 'LEAD' ? { licence: 'LIC-1234' } : {}) }, 'clinic', 'setup');
  const password = `${slug}-own-password-1`;
  changePassword(made.account.id, { currentPassword: made.temporaryPassword, newPassword: password });
  return { ...made.account, password };
};
const events = (action: string) => database().prepare('SELECT user_id, detail FROM events WHERE action=?').all(action) as { user_id: string; detail: string }[];

test('client address: a caller cannot choose it by sending X-Forwarded-For', () => {
  // Without a trusted proxy the web server replaces whatever the caller sent with the connection address.
  const incoming = { headers: { 'x-forwarded-for': '10.9.9.9, 10.8.8.8' } as Record<string, string>, socket: { remoteAddress: '192.0.2.10' } };
  setClientAddress(incoming, 0);
  assert.equal(incoming.headers['x-forwarded-for'], '192.0.2.10');
  const kept = { headers: { 'x-forwarded-for': '10.9.9.9, 192.0.2.20' } as Record<string, string>, socket: { remoteAddress: '192.0.2.1' } };
  setClientAddress(kept, 1);
  assert.equal(kept.headers['x-forwarded-for'], '10.9.9.9, 192.0.2.20', 'a trusted proxy chain is passed on');

  const request = (value: string) => new NextRequest(`${ORIGIN}/`, { headers: { 'x-forwarded-for': value } });
  // One trusted proxy appends the address it saw: the right-most entry. Entries to the left came from the caller.
  assert.equal(clientAddress(request('10.9.9.9, 192.0.2.20'), 1), '192.0.2.20');
  assert.equal(clientAddress(request('192.0.2.20'), 1), '192.0.2.20');
  assert.equal(clientAddress(request('10.9.9.9, 192.0.2.30, 198.51.100.7'), 2), '192.0.2.30');
  assert.equal(clientAddress(request('192.0.2.40'), 0), '192.0.2.40');
  assert.equal(clientAddress(new NextRequest(`${ORIGIN}/`), 0), 'local');

  assert.equal(trustedProxyHops(undefined), 0);
  assert.equal(trustedProxyHops('1'), 1);
  assert.equal(trustedProxyHops('yes'), 0, 'an unclear value never widens trust');
  assert.equal(trustedProxyHops('9'), 0);
});

test('sign-in: changing the left part of X-Forwarded-For does not reset the per-email lock', async () => {
  process.env.HALQA_TRUST_PROXY = '1';
  try {
    const target = account('lock-target');
    for (let i = 0; i < 8; i++) assert.equal((await signIn(signInRequest(target.email, 'wrong-password', `10.0.0.${i}, 192.0.2.50`))).status, 401, `attempt ${i + 1}`);
    assert.equal((await signIn(signInRequest(target.email, target.password, '10.0.0.99, 192.0.2.50'))).status, 429, 'a new spoofed entry is the same client');
    assert.equal((await signIn(signInRequest(target.email, target.password, '192.0.2.51'))).status, 200, 'a different client is not locked out');
    const locked = events('SIGN_IN_LOCKED');
    assert.equal(locked.length, 1, 'the lock is audited once');
    assert.equal(locked[0].user_id, target.id);
    assert.ok(!locked[0].detail.includes('192.0.2'), 'the audit entry holds no address');
  } finally { delete process.env.HALQA_TRUST_PROXY; }
});

test('sign-in: one client is limited across many emails', async () => {
  const { maximum } = RATE_LIMITS.signin;
  for (let i = 0; i < maximum; i++) assert.equal((await signIn(signInRequest(`nobody-${i}@example.test`, 'wrong-password', '198.51.100.77'))).status, 401);
  assert.equal((await signIn(signInRequest('nobody-x@example.test', 'wrong-password', '198.51.100.77'))).status, 429);
  assert.equal((await signIn(signInRequest('nobody-x@example.test', 'wrong-password', '198.51.100.78'))).status, 401);
});

test('sign-in ends the session the browser already held, and sign-out is audited', async () => {
  const user = account('fixation');
  const first = await signIn(signInRequest(user.email, user.password, '192.0.2.60'));
  const firstToken = first.cookies.get('halqa_session')!.value;
  assert.ok(sessionFor(firstToken));
  const second = await signIn(signInRequest(user.email, user.password, '192.0.2.60', firstToken));
  assert.equal(second.status, 200);
  assert.equal(sessionFor(firstToken), undefined, 'the old cookie no longer works');
  const secondToken = second.cookies.get('halqa_session')!.value;
  const { csrf } = await second.json();
  const out = await signOut(new NextRequest(`${ORIGIN}/api/session`, { method: 'DELETE', headers: { origin: ORIGIN, cookie: `halqa_session=${secondToken}`, 'x-halqa-csrf': csrf } }));
  assert.equal(out.status, 200);
  assert.equal(sessionFor(secondToken), undefined);
  assert.ok(events('SIGN_OUT').some((e) => e.user_id === user.id));
});

test('CSRF tokens are compared in constant time and still refused when wrong', async () => {
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abd', 'abc'), false);
  assert.equal(sameSecret('abcd', 'abc'), false);
  assert.equal(sameSecret(null, 'abc'), false);
  assert.equal(sameSecret('', ''), true);
  const user = account('csrf-user');
  const session = login(user.email, user.password);
  const write = (csrf?: string) => workspaceWrite(new NextRequest(`${ORIGIN}/api/workspace`, {
    method: 'POST', headers: { origin: ORIGIN, cookie: `halqa_session=${session.token}`, 'content-type': 'application/json', ...(csrf !== undefined ? { 'x-halqa-csrf': csrf } : {}) }, body: '{}',
  }));
  assert.equal((await write()).status, 403);
  assert.equal((await write(session.csrf.slice(0, -1))).status, 403);
  assert.equal((await write(session.csrf)).status, 422, 'the right token passes the check and reaches validation');
});

test('integration keys: up to three hashes are accepted so a key can be replaced without a gap', () => {
  const oldKey = 'old-intake-key-' + randomUUID(); const newKey = 'new-intake-key-' + randomUUID();
  process.env.HALQA_INTAKE_KEY_SHA256 = `${tokenHash(oldKey)}, ${tokenHash(newKey).toUpperCase()}`;
  try {
    assert.equal(status(() => authenticateIntegration(`Bearer ${oldKey}`, 'HALQA_INTAKE_KEY_SHA256')), 200);
    assert.equal(status(() => authenticateIntegration(`Bearer ${newKey}`, 'HALQA_INTAKE_KEY_SHA256')), 200);
    assert.equal(status(() => authenticateIntegration('Bearer another-key', 'HALQA_INTAKE_KEY_SHA256')), 401);
    assert.equal(status(() => authenticateIntegration(null, 'HALQA_INTAKE_KEY_SHA256')), 401);
    process.env.HALQA_INTAKE_KEY_SHA256 = [1, 2, 3, 4].map((n) => tokenHash(`key-${n}`)).join(',');
    assert.equal(status(() => authenticateIntegration(`Bearer key-1`, 'HALQA_INTAKE_KEY_SHA256')), 503, 'more than three is a setup mistake');
    process.env.HALQA_INTAKE_KEY_SHA256 = `${tokenHash(oldKey)},not-a-hash`;
    assert.equal(status(() => authenticateIntegration(`Bearer ${oldKey}`, 'HALQA_INTAKE_KEY_SHA256')), 503);
  } finally { delete process.env.HALQA_INTAKE_KEY_SHA256; }
  assert.equal(configuredKeyHashes(undefined), undefined);
  assert.equal(configuredKeyHashes(tokenHash('x'))?.length, 1);
});

test('the message address must use https (plain http only on this machine); nothing is sent otherwise', async () => {
  assert.equal(webhookAddressProblem('https://messages.example.org/send'), undefined);
  assert.equal(webhookAddressProblem('http://127.0.0.1:9/messages'), undefined);
  assert.equal(webhookAddressProblem('http://localhost:8080/send'), undefined);
  assert.equal(webhookAddressProblem('http://[::1]:8080/send'), undefined);
  assert.match(webhookAddressProblem('http://messages.example.org/send')!, /https/);
  assert.match(webhookAddressProblem('http://127.0.0.1.example.org/send')!, /https/);
  assert.match(webhookAddressProblem('https://user:secret@messages.example.org/send')!, /user name or password/);
  assert.match(webhookAddressProblem('ftp://messages.example.org')!, /https/);
  assert.match(webhookAddressProblem('not an address')!, /valid/);

  account('webhook-doctor', 'PCP', 'Test clinic');
  const nav = account('webhook-nav');
  const { id } = receiveResult({
    externalId: 'webhook-1', network: 'clinic',
    patient: { id: 'p-webhook', name: 'Patient webhook', age: 50, sex: 'F', phone: '+2348000000002', lang: 'en', preferredChannel: 'SMS' },
    pathwayId: 'CRC_FIT', finding: 'Positive stool test', resultCode: 'FIT+', urgency: 'ROUTINE', sourceLab: 'Test lab', issuedAt: Date.now(),
  });
  const session = sessionFor(login(nav.email, nav.password).token)!;
  execute(session, { requestId: randomUUID(), revision: getSnapshot(session).revision, action: { type: 'NOTIFY', id, channel: 'SMS' } });
  process.env.HALQA_MESSAGE_WEBHOOK_URL = 'http://messages.example.org/send';
  process.env.HALQA_MESSAGE_WEBHOOK_TOKEN = 'webhook-token';
  try {
    await assert.rejects(() => deliverPending(), WebhookAddressRefused);
    const row = database().prepare('SELECT status, attempts FROM outbox WHERE case_id=?').get(id) as { status: string; attempts: number };
    assert.deepEqual({ ...row }, { status: 'QUEUED', attempts: 0 }, 'the message stays queued and untouched');
  } finally { delete process.env.HALQA_MESSAGE_WEBHOOK_URL; delete process.env.HALQA_MESSAGE_WEBHOOK_TOKEN; }
});

test('internal faults never reach the user as text; domain refusals still do', () => {
  const refused = domainRefusal(new Error('Choose a receiving service for this programme.'));
  assert.ok(refused instanceof HttpError && refused.status === 422 && refused.message === 'Choose a receiving service for this programme.');
  const fault = new TypeError("Cannot read properties of undefined (reading 'facility')");
  assert.equal(domainRefusal(fault), fault, 'passed on, so the route answers with the generic 500 sentence');
  const response = failure(fault);
  assert.equal(response.status, 500);
});

test('database faults are logged with SQLite\'s fixed result text only', () => {
  const locked = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errstr: 'database is locked' });
  assert.equal(databaseErrorText(locked), 'database is locked');
  assert.equal(databaseErrorText(new Error('x')), undefined);
  assert.equal(failure(locked).headers.get('x-halqa-database-error'), 'database is locked');
});

test('pages get a fresh script nonce and no inline script allowance; JSON routes allow nothing', async () => {
  const policy = pagePolicy('abc123');
  const script = policy.split('; ').find((d) => d.startsWith('script-src'))!;
  assert.equal(script, "script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  assert.ok(!script.includes('unsafe-inline') && !script.includes('unsafe-eval'));
  assert.ok(policy.includes("object-src 'none'") && policy.includes("frame-ancestors 'none'"));
  assert.ok(!policy.includes('upgrade-insecure-requests'));
  assert.ok(pagePolicy('n', { https: true }).includes('upgrade-insecure-requests'));
  assert.ok(pagePolicy('n', { development: true }).includes("'unsafe-eval'"));
  assert.notEqual(newNonce(), newNonce());
  assert.ok(Buffer.from(newNonce(), 'base64').length === 16);

  const first = proxy(new NextRequest(`${ORIGIN}/`));
  const second = proxy(new NextRequest(`${ORIGIN}/`));
  const csp = first.headers.get('content-security-policy')!;
  assert.match(csp, /'nonce-[A-Za-z0-9+/=]+'/);
  assert.notEqual(csp, second.headers.get('content-security-policy'));
  // The policy is also handed to the renderer, which reads the nonce from it.
  assert.equal(first.headers.get('x-middleware-request-content-security-policy'), csp);

  const rules = await nextConfig.headers();
  const everywhere = rules.find((r) => r.source === '/:path*')!.headers;
  assert.ok(!everywhere.some((h) => h.key === 'Content-Security-Policy'), 'no static page policy with inline scripts');
  assert.equal(everywhere.find((h) => h.key === 'X-Frame-Options')?.value, 'DENY');
  assert.equal(rules.find((r) => r.source === '/api/:path*')!.headers.find((h) => h.key === 'Content-Security-Policy')?.value, API_POLICY);
});
