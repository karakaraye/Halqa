import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { createAccount, disableAccount } from '../src/server/accounts';
import { login, sessionFor, tokenHash } from '../src/server/auth';
import { getSnapshot } from '../src/server/workspace';
import { POST } from '../src/app/api/intake/results/route';
import { openCase, nextCaseId, leastLoadedNavigator } from '../src/domain/intake';
import { Case, Person } from '../src/types/halqa';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-intake-')), 'workspace.sqlite');
after(closeDatabases);

// Anything written to the console during these tests is checked for the key at the end.
const KEY = 'intake-key-' + 'f3a9c1d27b';
const logged: string[] = [];
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => { logged.push(args.map(a => (a instanceof Error ? `${a.name} ${a.message} ${a.stack}` : String(a))).join(' ')); original(...args); };
}

type Account = ReturnType<typeof createAccount>;
const create = (slug: string, name: string, role: 'NAVIGATOR' | 'PCP' | 'LEAD', org: string, network = 'clinic') =>
  createAccount({ email: `${slug}@example.test`, name, role, org }, network, 'setup');
const input = {
  externalId: 'result-1', network: 'clinic',
  patient: { id: 'patient-1', name: 'Test patient', age: 40, sex: 'F', phone: '+2348000000000', lang: 'en', preferredChannel: 'SMS' },
  pathwayId: 'CRC_FIT', finding: 'Result requiring review', resultCode: 'FIT+', urgency: 'ROUTINE', sourceLab: 'Test lab', issuedAt: Date.now(),
};
const request = (payload: unknown = input, authorization: string | null = `Bearer ${KEY}`, contentType = 'application/json') =>
  new NextRequest('http://localhost/api/intake/results', { method: 'POST', headers: { ...(authorization ? { authorization } : {}), 'content-type': contentType }, body: JSON.stringify(payload) });
const caseRow = (id: string) => JSON.parse((database().prepare('SELECT data FROM cases WHERE id=?').get(id) as { data: string }).data) as Case;
const count = (sql: string, ...args: (string | number)[]) => Number((database().prepare(sql).get(...args) as { n: number }).n);
const revision = () => Number((database().prepare("SELECT value FROM meta WHERE key='revision'").get() as { value: string } | undefined)?.value ?? 0);
const sessions = new Map<string, ReturnType<typeof sessionFor>>();
const visibleTo = (account: Account) => {
  if (!sessions.has(account.account.id)) sessions.set(account.account.id, sessionFor(login(account.account.email, account.temporaryPassword).token));
  return getSnapshot(sessions.get(account.account.id)!).state.cases.map(c => c.id);
};

let nav: Account, otherNav: Account, doctor: Account, otherDoctor: Account, lead: Account, outsider: Account, retired: Account;

test('intake refuses requests while the key is not configured, and wrong or missing keys', async () => {
  delete process.env.HALQA_INTAKE_KEY_SHA256;
  assert.equal((await POST(request())).status, 503);
  process.env.HALQA_INTAKE_KEY_SHA256 = tokenHash(KEY);
  assert.equal((await POST(request(input, 'Bearer wrong-key'))).status, 401);
  assert.equal((await POST(request(input, null))).status, 401);
  assert.equal((await POST(request(input, `Basic ${KEY}`))).status, 401);
  assert.equal((await POST(request(input, `Bearer ${KEY.toUpperCase()}`))).status, 401);
  assert.equal(count('SELECT COUNT(*) AS n FROM cases'), 0);
});

test('intake rejects bad bodies, unknown doctors, unknown networks and future dates with 422', async () => {
  nav = create('first-navigator', 'First navigator', 'NAVIGATOR', 'Navigation hub A');
  otherNav = create('second-navigator', 'Second navigator', 'NAVIGATOR', 'Navigation hub B');
  doctor = create('doctor', 'Named doctor', 'PCP', 'Test clinic');
  otherDoctor = create('other-doctor', 'Other doctor', 'PCP', 'Other clinic');
  lead = create('lead', 'Network lead', 'LEAD', 'Programme office');
  outsider = create('outside-doctor', 'Outside doctor', 'PCP', 'Outside clinic', 'elsewhere');
  retired = create('retired-doctor', 'Retired doctor', 'PCP', 'Test clinic');
  disableAccount(retired.account.id, 'clinic', lead.account.id);

  for (const bad of [
    { ...input, extra: true },
    { ...input, patient: { ...input.patient, phone: '0800 000' } },
    { ...input, patient: { ...input.patient, sex: 'X' } },
    { ...input, patient: { ...input.patient, lang: 'fr' } },
    { ...input, patient: { ...input.patient, diagnosis: 'not allowed' } },
    { ...input, pathwayId: 'UNKNOWN' },
    { ...input, urgency: 'SOON' },
    { ...input, issuedAt: '2026-11-11' },
    { ...input, externalId: '' },
    Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'finding')),
  ]) assert.equal((await POST(request(bad))).status, 422, JSON.stringify(bad).slice(0, 80));
  assert.equal((await POST(request(input, `Bearer ${KEY}`, 'text/plain'))).status, 415);
  assert.equal((await POST(request({ ...input, issuedAt: Date.now() + 6 * 60_000 }))).status, 422);
  assert.equal((await POST(request({ ...input, pcpId: 'missing' }))).status, 422);
  assert.equal((await POST(request({ ...input, pcpId: nav.account.id }))).status, 422, 'a navigator is not a doctor');
  assert.equal((await POST(request({ ...input, pcpId: outsider.account.id }))).status, 422, 'a doctor from another network');
  assert.equal((await POST(request({ ...input, pcpId: retired.account.id }))).status, 422, 'a disabled doctor');
  assert.equal((await POST(request({ ...input, network: 'no-such-network' }))).status, 422);
  assert.equal(count('SELECT COUNT(*) AS n FROM cases'), 0);
  // A result stamped within the allowed five minutes of clock difference is accepted (checked below).
});

let caseId = '';
test('a valid result opens one case for the least-busy navigator and the named doctor, without telling the patient', async () => {
  const before = revision();
  const response = await POST(request({ ...input, issuedAt: Date.now() + 4 * 60_000, pcpId: doctor.account.id }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const json = await response.json();
  caseId = json.caseId;
  assert.equal(json.created, true);
  assert.equal(caseId, 'HQ-1001');
  assert.equal(revision(), before + 1);

  const c = caseRow(caseId);
  assert.deepEqual(c.steps, {});
  assert.deepEqual(c.notifications, []);
  assert.equal(c.steps.NOTIFY, undefined);
  assert.equal(c.accountable?.id, doctor.account.id);
  assert.equal(c.team.PCP?.id, doctor.account.id);
  assert.equal(c.team.NAVIGATOR?.id, nav.account.id);
  assert.equal(c.patient.name, 'Test patient');
  assert.equal(c.audit.length, 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM events WHERE case_id=?', caseId), 1);
  assert.equal(database().prepare('SELECT external_id FROM cases WHERE id=?').get(caseId)?.external_id, 'result-1');

  assert.deepEqual(visibleTo(nav), [caseId]);
  assert.deepEqual(visibleTo(doctor), [caseId]);
  assert.deepEqual(visibleTo(lead), [caseId]);
  assert.deepEqual(visibleTo(otherNav), []);
  assert.deepEqual(visibleTo(otherDoctor), []);
  assert.deepEqual(visibleTo(outsider), []);
});

test('a repeated result returns the same case with 200 and changes nothing', async () => {
  const events = count('SELECT COUNT(*) AS n FROM events');
  const before = revision();
  const repeat = await POST(request({ ...input, pcpId: doctor.account.id, finding: 'Changed text is ignored' }));
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), { caseId, created: false });
  assert.equal(count('SELECT COUNT(*) AS n FROM cases'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM events'), events);
  assert.equal(revision(), before);
  assert.equal(caseRow(caseId).finding, 'Result requiring review');
});

test('the next result goes to the other navigator; the same external id in another network is a separate case', async () => {
  const second = await POST(request({ ...input, externalId: 'result-2' }));
  assert.equal(second.status, 201);
  const { caseId: secondId } = await second.json();
  assert.equal(secondId, 'HQ-1002');
  const c = caseRow(secondId);
  assert.equal(c.team.NAVIGATOR?.id, otherNav.account.id);
  assert.equal(c.accountable, undefined);
  assert.deepEqual(visibleTo(otherNav), [secondId]);
  assert.deepEqual(visibleTo(nav), [caseId]);

  const elsewhere = await POST(request({ ...input, network: 'elsewhere' }));
  assert.equal(elsewhere.status, 201);
  const { caseId: elsewhereId } = await elsewhere.json();
  assert.equal(elsewhereId, 'HQ-1003');
  assert.equal(caseRow(elsewhereId).team.NAVIGATOR, undefined, 'no navigator from another network is borrowed');
  assert.ok(!visibleTo(lead).includes(elsewhereId));
  assert.ok(!visibleTo(nav).includes(elsewhereId));
  assert.equal(count('SELECT COUNT(*) AS n FROM cases'), 3);
});

test('case numbers continue after the highest one in use', () => {
  assert.equal(nextCaseId(['HQ-1001', 'HQ-1041', 'OTHER-9']), 'HQ-1042');
  assert.equal(nextCaseId([]), 'HQ-1001');
  const a: Person = { id: 'a', name: 'Alpha', role: 'NAVIGATOR', org: 'Hub' };
  const b: Person = { id: 'b', name: 'Beta', role: 'NAVIGATOR', org: 'Hub' };
  const opened = openCase({ id: 'HQ-1', result: { ...input, patient: input.patient as Case['patient'] } as never, navigator: a }, 1);
  assert.equal(leastLoadedNavigator([b, a], []), a);
  assert.equal(leastLoadedNavigator([b, a], [opened]), b);
  assert.equal(leastLoadedNavigator([b, a], [{ ...opened, closure: { status: 'CLOSED' } as Case['closure'] }]), a, 'closed cases do not count');
});

test('the intake key never appears in logs or in the database', () => {
  const dump = JSON.stringify(['users', 'sessions', 'cases', 'events', 'meta', 'rate_limits'].map(t => database().prepare(`SELECT * FROM ${t}`).all()));
  assert.ok(!dump.includes(KEY));
  for (const line of logged) { assert.ok(!line.includes(KEY)); assert.ok(!line.includes(tokenHash(KEY))); }
});
