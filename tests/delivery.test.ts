import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { createAccount } from '../src/server/accounts';
import { login, sessionFor, tokenHash, Session } from '../src/server/auth';
import { execute, getSnapshot } from '../src/server/workspace';
import { receiveResult } from '../src/server/intake';
import { deliverPending, retryDelay, DELIVERY_POLICY } from '../src/server/delivery';
import { POST as report } from '../src/app/api/intake/delivery/route';
import { MESSAGE_SERVICE } from '../src/domain/delivery';
import { Case } from '../src/types/halqa';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-delivery-')), 'workspace.sqlite');
delete process.env.HALQA_TEST_CONTROLS;
delete process.env.HALQA_MESSAGE_WEBHOOK_URL; delete process.env.HALQA_MESSAGE_WEBHOOK_TOKEN;
after(closeDatabases);

const KEY = 'delivery-key-' + '7d1e44a0';
const WEBHOOK_TOKEN = 'webhook-token-' + 'c09b2e51';
const logged: string[] = [];
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); original(...args); };
}

const staff = (slug: string, name: string, role: 'NAVIGATOR' | 'PCP', org: string) => createAccount({ email: `${slug}@example.test`, name, role, org }, 'clinic', 'setup');
const nav = staff('navigator', 'Test navigator', 'NAVIGATOR', 'Navigation hub');
const doctor = staff('doctor', 'Test doctor', 'PCP', 'Test clinic');
const signIn = (a: { account: { email: string }; temporaryPassword: string }) => sessionFor(login(a.account.email, a.temporaryPassword).token)!;
const navSession = signIn(nav);

let sequence = 0;
function newCase(channel: Case['patient']['preferredChannel'] = 'SMS', urgency: Case['urgency'] = 'ROUTINE') {
  sequence++;
  return receiveResult({
    externalId: `delivery-${sequence}`, network: 'clinic',
    patient: { id: `patient-${sequence}`, name: `Patient ${sequence}`, age: 50, sex: 'M', phone: '+2348000000001', lang: 'ar', preferredChannel: channel },
    pathwayId: 'CRC_FIT', finding: 'Positive stool test', resultCode: 'FIT+', urgency, sourceLab: 'Test lab', issuedAt: Date.now(), pcpId: doctor.account.id,
  }).id;
}
const command = (s: Session, action: unknown) => execute(s, { requestId: randomUUID(), revision: getSnapshot(s).revision, action });
const caseOf = (id: string) => JSON.parse((database().prepare('SELECT data FROM cases WHERE id=?').get(id) as { data: string }).data) as Case;
const outboxFor = (id: string) => database().prepare('SELECT * FROM outbox WHERE case_id=? ORDER BY created_at').all(id) as unknown as { id: string; status: string; attempts: number; last_error: string | null; next_attempt_at: number; template: string; to_phone: string; lang: string; channel: string }[];
const callback = (payload: unknown, authorization: string | null = `Bearer ${KEY}`) =>
  report(new NextRequest('http://localhost/api/intake/delivery', { method: 'POST', headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
function patientSession(caseId: string) {
  const account = createAccount({ email: `patient-${caseId.toLowerCase()}@example.test`, name: 'Patient account', role: 'PATIENT', org: 'Patient portal', patientCase: caseId }, 'clinic', 'setup');
  return signIn(account);
}

let firstCase = '';
let firstMessage = '';
let firstPatient: Session;
test('a text message is queued in the outbox and does not complete the step or release the result', async () => {
  firstCase = newCase();
  command(navSession, { type: 'NOTIFY', id: firstCase, channel: 'SMS' });
  const rows = outboxFor(firstCase);
  assert.equal(rows.length, 1);
  firstMessage = rows[0].id;
  assert.equal(rows[0].status, 'QUEUED');
  assert.equal(rows[0].attempts, 0);
  assert.equal(rows[0].template, 'result-ready');
  assert.equal(rows[0].lang, 'ar');
  assert.equal(rows[0].to_phone, '+2348000000001');
  const c = caseOf(firstCase);
  assert.equal(c.steps.NOTIFY, undefined);
  assert.deepEqual(c.notifications.map(n => [n.id, n.status, n.channel]), [[firstMessage, 'QUEUED', 'SMS']]);
  firstPatient = patientSession(firstCase);
  assert.equal(getSnapshot(firstPatient).patient?.released, false);
  assert.throws(() => command(navSession, { type: 'NOTIFY', id: firstCase, channel: 'WHATSAPP' }), /already on its way/);
  assert.equal(outboxFor(firstCase).length, 1);
  // With no message service configured, nothing leaves and the row waits.
  assert.deepEqual(await deliverPending(), { attempted: 0 });
  assert.equal(outboxFor(firstCase)[0].status, 'QUEUED');
});

test('a phone call reported by a person still completes the step at once, without the outbox', () => {
  const id = newCase('PHONE');
  command(navSession, { type: 'NOTIFY', id, channel: 'PHONE', phoneOutcome: 'NO_ANSWER' });
  assert.equal(caseOf(id).steps.NOTIFY, undefined);
  assert.ok(caseOf(id).delayReasons.some(d => d.reason === 'UNREACHABLE'));
  command(navSession, { type: 'NOTIFY', id, channel: 'PHONE', phoneOutcome: 'REACHED', note: 'Spoke to the patient' });
  assert.equal(caseOf(id).steps.NOTIFY?.by, 'Test navigator');
  assert.equal(outboxFor(id).length, 0);
});

test('the delivery route needs its own key', async () => {
  delete process.env.HALQA_DELIVERY_KEY_SHA256;
  assert.equal((await callback({ outboxId: firstMessage, status: 'DELIVERED' })).status, 503);
  process.env.HALQA_DELIVERY_KEY_SHA256 = tokenHash(KEY);
  process.env.HALQA_INTAKE_KEY_SHA256 = tokenHash('a-different-key');
  assert.equal((await callback({ outboxId: firstMessage, status: 'DELIVERED' }, 'Bearer a-different-key')).status, 401);
  assert.equal((await callback({ outboxId: firstMessage, status: 'DELIVERED' }, null)).status, 401);
  assert.equal((await callback({ outboxId: firstMessage, status: 'READ' })).status, 422);
  assert.equal((await callback({ outboxId: firstMessage, status: 'DELIVERED', extra: 1 })).status, 422);
  assert.equal((await callback({ outboxId: 'msg_unknown', status: 'DELIVERED' })).status, 404);
  assert.equal(caseOf(firstCase).steps.NOTIFY, undefined);
});

test('DELIVERED completes the step as the message service, releases the patient view and settles the unreachable alert', async () => {
  // An open unreachable alert from earlier attempts must be settled, as a successful contact always did.
  const db = database();
  const c = caseOf(firstCase);
  c.escalations = [{ id: 'esc-test', at: Date.now(), level: 2, ruleId: 'R4_UNREACHABLE', reason: 'Could not reach the patient (3 tries)', to: 'Lead', stepId: 'NOTIFY' }];
  db.prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify(c), firstCase);
  const revision = getSnapshot(navSession).revision;

  const response = await callback({ outboxId: firstMessage, status: 'DELIVERED' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: 'DELIVERED' });
  const done = caseOf(firstCase);
  assert.equal(done.steps.NOTIFY?.by, MESSAGE_SERVICE);
  assert.equal(done.notifications[0].status, 'DELIVERED');
  assert.equal(done.escalations[0].resolvedAt !== undefined, true);
  assert.equal(done.escalations[0].resolvedBy, MESSAGE_SERVICE);
  assert.equal(outboxFor(firstCase)[0].status, 'DELIVERED');
  assert.ok(getSnapshot(navSession).revision > revision, 'screens see the change');
  assert.equal(getSnapshot(firstPatient).patient?.released, true);
});

test('a repeated report changes nothing and a contradicting one is refused', async () => {
  const events = Number((database().prepare('SELECT COUNT(*) AS n FROM events WHERE case_id=?').get(firstCase) as { n: number }).n);
  assert.equal((await callback({ outboxId: firstMessage, status: 'DELIVERED' })).status, 200);
  assert.equal(Number((database().prepare('SELECT COUNT(*) AS n FROM events WHERE case_id=?').get(firstCase) as { n: number }).n), events);
  assert.equal((await callback({ outboxId: firstMessage, status: 'FAILED' })).status, 409);
});

test('FAILED records the failed attempt and the unreachable reason; for an urgent case it raises the alert at once', async () => {
  const id = newCase('WHATSAPP', 'CRITICAL');
  command(navSession, { type: 'NOTIFY', id, channel: 'WHATSAPP' });
  const [row] = outboxFor(id);
  const response = await callback({ outboxId: row.id, status: 'FAILED', error: 'Number not on WhatsApp' });
  assert.equal(response.status, 200);
  const failed = caseOf(id);
  assert.equal(failed.steps.NOTIFY, undefined);
  assert.equal(failed.notifications[0].status, 'FAILED');
  assert.ok(failed.delayReasons.some(d => d.reason === 'UNREACHABLE'));
  assert.ok(failed.audit.some(e => e.actor === MESSAGE_SERVICE && /could not be delivered/.test(e.action)));
  assert.ok(failed.escalations.some(e => e.ruleId === 'R4_UNREACHABLE' && !e.resolvedAt));
  assert.equal(outboxFor(id)[0].last_error, 'Number not on WhatsApp');
  // Another try is allowed once nothing is in flight; its delivery settles the alert.
  command(navSession, { type: 'NOTIFY', id, channel: 'SMS' });
  const second = outboxFor(id)[1];
  assert.equal((await callback({ outboxId: second.id, status: 'DELIVERED' })).status, 200);
  const reached = caseOf(id);
  assert.equal(reached.steps.NOTIFY?.by, MESSAGE_SERVICE);
  assert.ok(reached.escalations.filter(e => e.ruleId === 'R4_UNREACHABLE').every(e => e.resolvedAt));
});

async function webhook(answer: (request: IncomingMessage) => number) {
  const received: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { received.push({ headers: req.headers, body: JSON.parse(raw) }); res.statusCode = answer(req); res.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.HALQA_MESSAGE_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/send`;
  process.env.HALQA_MESSAGE_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
  return { received, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test('the worker posts queued messages with the bearer token and no clinical details; accepted messages become SENT', async () => {
  const hook = await webhook(() => 202);
  try {
    const id = newCase();
    command(navSession, { type: 'NOTIFY', id, channel: 'SMS' });
    const [row] = outboxFor(id);
    assert.deepEqual(await deliverPending(), { attempted: 1 });
    assert.equal(hook.received.length, 1);
    const sent = hook.received[0];
    assert.equal(sent.headers.authorization, `Bearer ${WEBHOOK_TOKEN}`);
    assert.equal(sent.headers['idempotency-key'], row.id);
    assert.deepEqual(Object.keys(sent.body).sort(), ['channel', 'language', 'link', 'outboxId', 'phone', 'template']);
    assert.deepEqual({ ...sent.body, link: undefined }, { outboxId: row.id, channel: 'SMS', template: 'result-ready', language: 'ar', phone: '+2348000000001', link: undefined });
    const text = JSON.stringify(sent.body);
    for (const secret of ['Positive', 'FIT', 'Patient', 'CRC']) assert.ok(!text.includes(secret), secret);
    assert.equal(outboxFor(id)[0].status, 'SENT');
    assert.equal(caseOf(id).notifications[0].status, 'SENT');
    assert.equal(caseOf(id).steps.NOTIFY, undefined, 'accepted by the provider is not delivered to the patient');
    assert.deepEqual(await deliverPending(), { attempted: 0 }, 'sent once only');
    assert.equal((await callback({ outboxId: row.id, status: 'DELIVERED' })).status, 200);
    assert.equal(caseOf(id).steps.NOTIFY?.by, MESSAGE_SERVICE);
  } finally { await hook.close(); }
});

test('failed posts are retried with growing waits and the message is marked FAILED after five attempts', async () => {
  const hook = await webhook(() => 500);
  try {
    const id = newCase();
    command(navSession, { type: 'NOTIFY', id, channel: 'SMS' });
    let now = Date.now();
    assert.equal((await deliverPending(now)).attempted, 1);
    for (let attempt = 1; attempt < DELIVERY_POLICY.maxAttempts; attempt++) {
      const row = outboxFor(id)[0];
      assert.equal(row.status, 'QUEUED');
      assert.equal(row.attempts, attempt);
      assert.equal(row.next_attempt_at, now + retryDelay(attempt));
      assert.match(row.last_error ?? '', /answered 500/);
      assert.equal((await deliverPending(now + retryDelay(attempt) - 1)).attempted, 0, 'waits before retrying');
      now += retryDelay(attempt);
      assert.equal((await deliverPending(now)).attempted, 1);
    }
    assert.equal(hook.received.length, 5);
    assert.ok(retryDelay(2) > retryDelay(1) && retryDelay(4) > retryDelay(3));
    const row = outboxFor(id)[0];
    assert.equal(row.status, 'FAILED');
    assert.equal(row.attempts, 5);
    const c = caseOf(id);
    assert.equal(c.notifications[0].status, 'FAILED');
    assert.equal(c.steps.NOTIFY, undefined);
    assert.ok(c.delayReasons.some(d => d.reason === 'UNREACHABLE'));
    assert.equal((await deliverPending(now + 24 * 3600_000)).attempted, 0);
    assert.equal(hook.received.length, 5, 'no sixth attempt');
  } finally { await hook.close(); }
});

test('only browser tests with clock controls and no message service settle messages at once', () => {
  delete process.env.HALQA_MESSAGE_WEBHOOK_URL;
  process.env.HALQA_TEST_CONTROLS = '1';
  try {
    const id = newCase();
    command(navSession, { type: 'NOTIFY', id, channel: 'APP' });
    assert.equal(caseOf(id).steps.NOTIFY?.by, MESSAGE_SERVICE);
    assert.equal(outboxFor(id)[0].status, 'DELIVERED');
  } finally { delete process.env.HALQA_TEST_CONTROLS; }
});

test('keys and tokens never appear in logs or in the database', () => {
  const dump = JSON.stringify(['users', 'sessions', 'cases', 'events', 'meta', 'rate_limits', 'outbox'].map(t => database().prepare(`SELECT * FROM ${t}`).all()));
  for (const secret of [KEY, WEBHOOK_TOKEN]) {
    assert.ok(!dump.includes(secret));
    for (const line of logged) assert.ok(!line.includes(secret));
  }
});
