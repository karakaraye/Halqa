import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { closeDatabases, database } from '../src/server/db';
import { createAccount } from '../src/server/accounts';
import { HttpError, login, sessionFor, verifyPassword } from '../src/server/auth';
import { getSnapshot } from '../src/server/workspace';
import { receiveResult } from '../src/server/intake';
import { PASSWORD_CHANGE_REQUIRED } from '../src/server/http';
import { createUserFromArgs, COMMAND_LINE_ACTOR } from '../scripts/create-user';
import { GET as readWorkspace, POST as writeWorkspace } from '../src/app/api/workspace/route';
import { GET as readSession, DELETE as signOut } from '../src/app/api/session/route';
import { POST as changePassword } from '../src/app/api/account/password/route';
import { GET as listUsers, POST as createUser } from '../src/app/api/admin/users/route';
import { POST as disableUser } from '../src/app/api/admin/users/[id]/disable/route';
import { GET as listServices, POST as createService } from '../src/app/api/admin/services/route';
import { POST as disableService } from '../src/app/api/admin/services/[id]/disable/route';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-password-required-')), 'workspace.sqlite');
after(closeDatabases);

const call = (path: string, token: string, csrf: string | undefined, method = 'GET', payload?: unknown) => new NextRequest(`http://localhost:3000${path}`, {
  method,
  headers: { cookie: `halqa_session=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json', ...(csrf ? { 'x-halqa-csrf': csrf } : {}) },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
const refusedForPassword = async (response: Response, label: string) => {
  assert.equal(response.status, 403, label);
  assert.equal((await response.json()).error, PASSWORD_CHANGE_REQUIRED, label);
};

test('while the temporary password is unchanged, writes and admin routes are refused with the exact message', async () => {
  assert.equal(PASSWORD_CHANGE_REQUIRED, 'Set a new password to continue.');
  const lead = createAccount({ email: 'lead@example.test', name: 'Network lead', role: 'LEAD', org: 'Programme office' }, 'clinic', 'setup');
  createAccount({ email: 'doctor@example.test', name: 'Network doctor', role: 'PCP', org: 'Clinic' }, 'clinic', 'setup');
  const caseId = receiveResult({
    externalId: 'flag-1', network: 'clinic',
    patient: { id: 'person-1', name: 'Person one', age: 50, sex: 'M', phone: '+2348000000003', lang: 'en', preferredChannel: 'PHONE' },
    pathwayId: 'CRC_FIT', finding: 'Positive stool test', resultCode: 'FIT+', urgency: 'ROUTINE', sourceLab: 'Test lab', issuedAt: Date.now(),
  }).id;
  const first = login(lead.account.email, lead.temporaryPassword);
  assert.equal(first.user.mustChangePassword, true);
  const { token, csrf } = first;
  const write = () => ({ requestId: randomUUID(), revision: getSnapshot(sessionFor(token)!).revision, action: { type: 'DELAY', id: caseId, reason: 'CAPACITY' } });

  // Still allowed: reading the workspace and the session.
  assert.equal((await readWorkspace(call('/api/workspace', token, undefined))).status, 200);
  const session = await readSession(call('/api/session', token, undefined));
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.mustChangePassword, true);

  // Refused: every workspace write and every admin route.
  await refusedForPassword(await writeWorkspace(call('/api/workspace', token, csrf, 'POST', write())), 'workspace write');
  await refusedForPassword(await listUsers(call('/api/admin/users', token, undefined)), 'list accounts');
  await refusedForPassword(await createUser(call('/api/admin/users', token, csrf, 'POST', { email: 'x@example.test', name: 'New person', role: 'PCP', org: 'Clinic' })), 'create account');
  await refusedForPassword(await disableUser(call('/api/admin/users/x/disable', token, csrf, 'POST', {}), { params: Promise.resolve({ id: 'x' }) }), 'disable account');
  await refusedForPassword(await listServices(call('/api/admin/services', token, undefined)), 'list services');
  await refusedForPassword(await createService(call('/api/admin/services', token, csrf, 'POST', { facility: 'Unit', specialty: 'Care', pathway: 'CRC_FIT', specialistUserId: 'x' })), 'create service');
  await refusedForPassword(await disableService(call('/api/admin/services/x/disable', token, csrf, 'POST', {}), { params: Promise.resolve({ id: 'x' }) }), 'disable service');
  assert.equal(database().prepare("SELECT id FROM users WHERE email='x@example.test'").get(), undefined, 'nothing was created');

  // Signing out still works while flagged.
  const spare = login(lead.account.email, lead.temporaryPassword);
  assert.equal((await signOut(call('/api/session', spare.token, spare.csrf, 'DELETE'))).status, 200);
  assert.equal(sessionFor(spare.token), undefined);

  // The password change itself is allowed, and afterwards the same write goes through.
  const changed = await changePassword(call('/api/account/password', token, csrf, 'POST', { currentPassword: lead.temporaryPassword, newPassword: 'lead-chosen-password' }));
  assert.equal(changed.status, 200);
  const { csrf: fresh } = await changed.json();
  const freshToken = changed.cookies.get('halqa_session')!.value;
  const saved = await writeWorkspace(call('/api/workspace', freshToken, fresh, 'POST', { requestId: randomUUID(), revision: getSnapshot(sessionFor(freshToken)!).revision, action: { type: 'DELAY', id: caseId, reason: 'CAPACITY' } }));
  assert.equal(saved.status, 200);
  assert.equal((await listUsers(call('/api/admin/users', freshToken, undefined))).status, 200);
});

test('user:create makes a flagged account, prints the password once and stores only its hash', () => {
  const printed = createUserFromArgs(['--email', 'Specialist@Example.test', '--name', 'New specialist', '--role', 'specialist', '--org', 'Hospital', '--licence', 'SP-1234', '--network', 'clinic']);
  const { account, temporaryPassword, lines } = printed;
  assert.equal(account.email, 'specialist@example.test');
  assert.equal(account.role, 'SPECIALIST');
  assert.equal(account.licence, 'SP-1234');
  assert.equal(account.mustChangePassword, true);
  assert.equal(lines.filter((line) => line.includes(temporaryPassword)).length, 1, 'printed once');
  assert.ok(temporaryPassword.length >= 20);

  const row = database().prepare('SELECT * FROM users WHERE id=?').get(account.id) as { password_hash: string; must_change_password: number; network: string };
  assert.equal(row.must_change_password, 1);
  assert.equal(row.network, 'clinic');
  assert.notEqual(row.password_hash, temporaryPassword);
  assert.ok(verifyPassword(temporaryPassword, row.password_hash));
  const event = database().prepare("SELECT user_id, detail FROM events WHERE action='ACCOUNT_CREATED' AND detail LIKE ?").get(`%${account.id}%`) as { user_id: string; detail: string };
  assert.equal(event.user_id, COMMAND_LINE_ACTOR);

  // The clear password appears in no table and in no file next to the database.
  const db = database();
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) {
    assert.ok(!JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()).includes(temporaryPassword), name);
  }
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const folder = dirname(process.env.HALQA_DB_PATH!);
  for (const file of readdirSync(folder)) assert.ok(!readFileSync(join(folder, file)).includes(temporaryPassword), file);

  // Signing in works and asks for a new password.
  assert.equal(login(account.email, temporaryPassword).user.mustChangePassword, true);
});

test('user:create validates like the admin route and refuses an existing email', () => {
  const status = (args: string[]) => { try { createUserFromArgs(args); return 201; } catch (e) { return e instanceof HttpError ? e.status : 500; } };
  assert.equal(status(['--email', 'specialist@example.test', '--name', 'Again', '--role', 'PCP', '--org', 'Clinic', '--network', 'clinic']), 409);
  assert.equal(status(['--email', 'not an email', '--name', 'Someone', '--role', 'PCP', '--org', 'Clinic']), 422);
  assert.equal(status(['--email', 'someone@example.test', '--name', 'Someone', '--role', 'OWNER', '--org', 'Clinic']), 422);
  assert.equal(status(['--email', 'someone@example.test', '--name', 'Someone', '--role', 'PCP']), 422);
  assert.equal(status(['--email', 'someone@example.test', '--name', 'Someone', '--role', 'PCP', '--org', 'Clinic', '--unknown', 'x']), 422);
  assert.equal(status(['--email', 'patient@example.test', '--name', 'Patient', '--role', 'PATIENT', '--org', 'Patient portal', '--network', 'clinic']), 422, 'a patient needs a case');
  assert.equal(database().prepare("SELECT id FROM users WHERE email='someone@example.test'").get(), undefined);
});
