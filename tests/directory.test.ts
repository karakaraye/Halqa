import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { changePassword, createAccount, disableAccount } from '../src/server/accounts';
import { HttpError, login, Session, sessionFor } from '../src/server/auth';
import { execute, getSnapshot } from '../src/server/workspace';
import { receiveResult } from '../src/server/intake';
import { createService } from '../src/server/directory';
import { FALLBACK_DIRECTORY } from '../src/domain/directory';
import { initialState, reducer } from '../src/domain/state';
import { PATHWAYS } from '../src/lib/pathways';
import { Case, Directory } from '../src/types/halqa';
import { GET as listServicesRoute, POST as createServiceRoute } from '../src/app/api/admin/services/route';
import { POST as disableServiceRoute } from '../src/app/api/admin/services/[id]/disable/route';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-directory-')), 'workspace.sqlite');
after(closeDatabases);

// Every read of the fallback directory is counted. The server must never read it.
let fallbackReads = 0;
for (const key of ['people', 'services'] as const) {
  const value = FALLBACK_DIRECTORY[key];
  Object.defineProperty(FALLBACK_DIRECTORY, key, { configurable: true, enumerable: true, get() { fallbackReads++; return value; } });
}

type Account = ReturnType<typeof createAccount>;
const make = (slug: string, name: string, role: 'NAVIGATOR' | 'PCP' | 'SPECIALIST' | 'LEAD', org: string, network = 'north', licence?: string) =>
  createAccount({ email: `${slug}@example.test`, name, role, org, ...(licence ? { licence } : {}) }, network, 'setup');
const signIn = (a: Account): Session => sessionFor(login(a.account.email, a.temporaryPassword).token)!;
/** A session after the forced password change, as the HTTP routes require. */
const ready = (a: Account) => changePassword(a.account.id, { currentPassword: a.temporaryPassword, newPassword: `own-password-${a.account.id}` });
const command = (s: Session, action: unknown) => execute(s, { requestId: randomUUID(), revision: getSnapshot(s).revision, action });
const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : 500; } };
const caseOf = (id: string) => JSON.parse((database().prepare('SELECT data FROM cases WHERE id=?').get(id) as { data: string }).data) as Case;
const save = (c: Case) => database().prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify(c), c.id);
const call = (path: string, token: string, csrf: string | undefined, payload?: unknown) => new NextRequest(`http://localhost:3000${path}`, {
  method: payload === undefined ? 'GET' : 'POST',
  headers: { cookie: `halqa_session=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json', ...(csrf ? { 'x-halqa-csrf': csrf } : {}) },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});

// North network: the network under test. South: another network that must stay invisible.
const lead = make('lead', 'North lead', 'LEAD', 'Programme office');
const nav = make('nav', 'First navigator', 'NAVIGATOR', 'Hub');
const nav2 = make('nav2', 'Second navigator', 'NAVIGATOR', 'Hub');
const retiredNav = make('retired-nav', 'Retired navigator', 'NAVIGATOR', 'Hub');
const pcp = make('pcp', 'First doctor', 'PCP', 'North clinic', 'north', 'GP-0001');
const pcp2 = make('pcp2', 'Second doctor', 'PCP', 'North clinic', 'north', 'GP-0002');
const specialist = make('specialist', 'Bowel specialist', 'SPECIALIST', 'North hospital', 'north', 'SP-0001');
const specialist2 = make('specialist2', 'Breast specialist', 'SPECIALIST', 'North hospital', 'north', 'SP-0002');
const southNav = make('south-nav', 'South navigator', 'NAVIGATOR', 'South hub', 'south');
const southPcp = make('south-pcp', 'South doctor', 'PCP', 'South clinic', 'south');
const southSpecialist = make('south-specialist', 'South specialist', 'SPECIALIST', 'South hospital', 'south');
disableAccount(retiredNav.account.id, 'north', lead.account.id);
const leadReady = ready(lead);

let caseSeq = 0;
/** A north bowel-screening case with every step before the referral complete. */
function caseAtReferral(): string {
  caseSeq++;
  const id = receiveResult({
    externalId: `directory-${caseSeq}`, network: 'north',
    patient: { id: `person-${caseSeq}`, name: `Person ${caseSeq}`, age: 60, sex: 'F', phone: '+2348000000002', lang: 'en', preferredChannel: 'PHONE' },
    pathwayId: 'CRC_FIT', finding: 'Positive stool test', resultCode: 'FIT+', urgency: 'ROUTINE', sourceLab: 'Test lab', issuedAt: Date.now(), pcpId: pcp.account.id,
  }).id;
  const c = caseOf(id);
  for (const step of PATHWAYS.CRC_FIT.steps) {
    if (step.id === 'REFER') break;
    c.steps[step.id] = { completedAt: Date.now() - 1000, by: 'Test', note: 'Done' };
  }
  save(c);
  return id;
}

const pcpS = signIn(pcp);
const specialistS = signIn(specialist);
const specialist2S = signIn(specialist2);
let bowelServiceId = '';

test('admin service routes are lead only, validate the specialist and report conflicts', async () => {
  const navReady = ready(nav);
  const body = { facility: 'North hospital bowel unit', specialty: 'Gastroenterology', pathway: 'CRC_FIT', specialistUserId: specialist.account.id };
  assert.equal((await listServicesRoute(call('/api/admin/services', navReady.token, undefined))).status, 403);
  assert.equal((await createServiceRoute(call('/api/admin/services', navReady.token, navReady.csrf, body))).status, 403);
  assert.equal((await createServiceRoute(call('/api/admin/services', leadReady.token, undefined, body))).status, 403, 'CSRF token required');
  for (const bad of [
    { ...body, extra: true },
    { ...body, pathway: 'UNKNOWN' },
    { ...body, facility: '' },
    { facility: body.facility, specialty: body.specialty, pathway: body.pathway },
    { ...body, specialistUserId: pcp.account.id },
    { ...body, specialistUserId: southSpecialist.account.id },
    { ...body, specialistUserId: 'no-such-user' },
  ]) assert.equal((await createServiceRoute(call('/api/admin/services', leadReady.token, leadReady.csrf, bad))).status, 422, JSON.stringify(bad));

  const created = await createServiceRoute(call('/api/admin/services', leadReady.token, leadReady.csrf, body));
  assert.equal(created.status, 201);
  const { service } = await created.json();
  assert.equal(service.specialistUserId, specialist.account.id);
  assert.equal(service.disabled, false);
  bowelServiceId = service.id;
  assert.equal((await createServiceRoute(call('/api/admin/services', leadReady.token, leadReady.csrf, body))).status, 409);
  assert.equal((await createServiceRoute(call('/api/admin/services', leadReady.token, leadReady.csrf, { ...body, facility: 'North hospital breast unit', specialty: 'Breast care', pathway: 'BREAST_BIRADS', specialistUserId: specialist2.account.id }))).status, 201);
  createService({ facility: 'South hospital bowel unit', specialty: 'Gastroenterology', pathway: 'CRC_FIT', specialistUserId: southSpecialist.account.id }, 'south', 'setup');

  const listed = await listServicesRoute(call('/api/admin/services', leadReady.token, undefined));
  assert.equal(listed.status, 200);
  const { services } = await listed.json() as { services: { facility: string }[] };
  assert.deepEqual(services.map((s) => s.facility).sort(), ['North hospital bowel unit', 'North hospital breast unit']);
  assert.ok((database().prepare("SELECT COUNT(*) AS n FROM events WHERE action='SERVICE_CREATED' AND user_id=?").get(lead.account.id) as { n: number }).n >= 2);
});

test('the snapshot directory lists enabled staff and services of the network only, without emails', () => {
  const snapshot = getSnapshot(pcpS);
  const ids = snapshot.directory.people.map((p) => p.id).sort();
  assert.deepEqual(ids, [lead, nav, nav2, pcp, pcp2, specialist, specialist2].map((a) => a.account.id).sort());
  for (const outsider of [southNav, southPcp, southSpecialist, retiredNav]) assert.ok(!ids.includes(outsider.account.id));
  const json = JSON.stringify(snapshot.directory);
  assert.ok(!json.includes('@'), 'no emails');
  assert.ok(!json.includes('example.test'));
  assert.ok(!/password|hash|email/i.test(json));
  for (const person of snapshot.directory.people) assert.deepEqual(Object.keys(person).sort().filter((k) => !['id', 'name', 'role', 'org', 'licence'].includes(k)), []);
  assert.equal(snapshot.directory.people.find((p) => p.id === pcp.account.id)?.licence, 'GP-0001');
  assert.deepEqual(snapshot.directory.services.map((s) => s.facility).sort(), ['North hospital bowel unit', 'North hospital breast unit']);
  assert.ok(!snapshot.directory.services.some((s) => s.specialist === southSpecialist.account.id));
  // Patients get no staff directory.
  const caseId = caseAtReferral();
  const patient = createAccount({ email: 'patient-directory@example.test', name: 'Patient account', role: 'PATIENT', org: 'Patient portal', patientCase: caseId }, 'north', 'setup');
  assert.ok(!getSnapshot(pcpS).directory.people.some((p) => p.id === patient.account.id), 'patients are not staff');
  assert.deepEqual(getSnapshot(signIn(patient)).directory, { people: [], services: [] });
});

test('ASSIGN accepts a database person and refuses anyone outside the directory with 422', () => {
  const id = caseAtReferral();
  for (const personId of ['nav_reem', southNav.account.id, retiredNav.account.id, pcp.account.id, 'no-such-person']) {
    assert.equal(status(() => command(pcpS, { type: 'ASSIGN', id, role: 'NAVIGATOR', personId })), 422, personId);
  }
  command(pcpS, { type: 'ASSIGN', id, role: 'NAVIGATOR', personId: nav2.account.id });
  assert.equal(caseOf(id).team.NAVIGATOR?.id, nav2.account.id);
  assert.equal(caseOf(id).team.NAVIGATOR?.name, 'Second navigator');
});

test('REQUEST_TRANSFER accepts a database clinician and refuses anyone outside the directory with 422', () => {
  const id = caseAtReferral();
  for (const personId of ['pcp_sara', southPcp.account.id, nav.account.id, 'no-such-person']) {
    assert.equal(status(() => command(pcpS, { type: 'REQUEST_TRANSFER', id, personId, reason: 'Moving clinics' })), 422, personId);
  }
  command(pcpS, { type: 'REQUEST_TRANSFER', id, personId: pcp2.account.id, reason: 'Moving clinics' });
  assert.equal(caseOf(id).pendingTransfer?.to.id, pcp2.account.id);
  assert.equal(status(() => command(pcpS, { type: 'REQUEST_TRANSFER', id, personId: specialist.account.id, reason: 'Second request' })), 409);
});

test('SEND_REFERRAL accepts a database service and REFERRAL_RESPOND checks the directory', () => {
  const id = caseAtReferral();
  for (const facility of ['City Hospital — Gastroenterology', 'South hospital bowel unit', 'North hospital breast unit', 'Unknown unit']) {
    assert.equal(status(() => command(pcpS, { type: 'SEND_REFERRAL', id, facility, priority: 'SOON', note: 'Please assess' })), 422, facility);
  }
  command(pcpS, { type: 'SEND_REFERRAL', id, facility: 'North hospital bowel unit', priority: 'SOON', note: 'Please assess' });
  assert.equal(caseOf(id).referral?.specialty, 'Gastroenterology');
  assert.equal(status(() => command(specialist2S, { type: 'REFERRAL_RESPOND', id, decision: 'ACCEPT' })), 404, 'another service cannot see the referral');
  command(specialistS, { type: 'REFERRAL_RESPOND', id, decision: 'ACCEPT' });
  assert.equal(caseOf(id).team.SPECIALIST?.id, specialist.account.id);
  assert.equal(caseOf(id).referral?.status, 'ACCEPTED');

  // A referral that points at a service not in the directory is refused.
  const orphan = caseOf(caseAtReferral());
  orphan.referral = { facility: 'Unknown unit', specialty: 'Gastroenterology', priority: 'SOON', note: 'Old referral', status: 'SENT', sentAt: Date.now(), attempts: 1 };
  orphan.steps.REFER = { completedAt: Date.now(), by: 'Test', note: 'Sent' };
  orphan.team.SPECIALIST = { id: specialist.account.id, name: 'Bowel specialist', role: 'SPECIALIST', org: 'North hospital' };
  save(orphan);
  assert.equal(status(() => command(specialistS, { type: 'REFERRAL_RESPOND', id: orphan.id, decision: 'ACCEPT' })), 422);
});

test('disabling a service hides it from the directory and from new referrals', async () => {
  const id = caseAtReferral();
  const pending = caseAtReferral();
  command(pcpS, { type: 'SEND_REFERRAL', id: pending, facility: 'North hospital bowel unit', priority: 'SOON', note: 'Please assess' });
  const nav2Ready = ready(nav2);
  const ctx = (sid: string) => ({ params: Promise.resolve({ id: sid }) });
  assert.equal((await disableServiceRoute(call(`/api/admin/services/${bowelServiceId}/disable`, nav2Ready.token, nav2Ready.csrf, {}), ctx(bowelServiceId))).status, 403);
  assert.equal((await disableServiceRoute(call('/api/admin/services/none/disable', leadReady.token, leadReady.csrf, {}), ctx('none'))).status, 404);
  const southId = (database().prepare("SELECT id FROM services WHERE network='south'").get() as { id: string }).id;
  assert.equal((await disableServiceRoute(call(`/api/admin/services/${southId}/disable`, leadReady.token, leadReady.csrf, {}), ctx(southId))).status, 404, 'another network');
  assert.equal((await disableServiceRoute(call(`/api/admin/services/${bowelServiceId}/disable`, leadReady.token, leadReady.csrf, {}), ctx(bowelServiceId))).status, 200);
  assert.ok(!getSnapshot(pcpS).directory.services.some((s) => s.facility === 'North hospital bowel unit'));
  assert.equal(status(() => command(pcpS, { type: 'SEND_REFERRAL', id, facility: 'North hospital bowel unit', priority: 'SOON', note: 'Please assess' })), 422);
  assert.equal(status(() => command(specialistS, { type: 'REFERRAL_RESPOND', id: pending, decision: 'ACCEPT' })), 404, 'a referral waiting at a disabled service is no longer offered to it');
  assert.ok((database().prepare("SELECT COUNT(*) AS n FROM events WHERE action='SERVICE_DISABLED'").get() as { n: number }).n === 1);
  const listed = await (await listServicesRoute(call('/api/admin/services', leadReady.token, undefined))).json() as { services: { id: string; disabled: boolean }[] };
  assert.equal(listed.services.find((s) => s.id === bowelServiceId)?.disabled, true);
  // A service whose specialist is disabled is not offered either.
  disableAccount(specialist2.account.id, 'north', lead.account.id);
  assert.deepEqual(getSnapshot(pcpS).directory.services, []);
});

test('the fallback directory is never read on a server request path', () => {
  assert.equal(fallbackReads, 0, 'every server call above used the database directory');
  // The server source never refers to the fallback or the constants it is built from,
  // except the development seed, which copies them into the database.
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name)) files.push(path); } };
  walk(resolve('src/server')); walk(resolve('src/app/api'));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('FALLBACK_DIRECTORY'), file);
    if (!file.endsWith('bootstrap.ts')) assert.ok(!/\b(PEOPLE|SPECIALIST_SERVICES|STAFF_BY_ROLE|ACTING_AS)\b/.test(source), file);
  }
  // Control: the pure domain without a directory does read the fallback.
  const state = initialState();
  const c = state.cases.find((x) => !x.historical && x.closure?.status !== 'CLOSED')!;
  reducer({ ...state, role: 'PCP' }, { type: 'ASSIGN', id: c.id, role: 'NAVIGATOR', personId: 'nav_joseph' });
  assert.ok(fallbackReads > 0);
  // And a directory passed to the domain replaces the fallback entirely.
  const own: Directory = { people: [], services: [] };
  assert.throws(() => reducer({ ...state, role: 'PCP', directory: own }, { type: 'ASSIGN', id: c.id, role: 'NAVIGATOR', personId: 'nav_joseph' }), /staff list/);
});
