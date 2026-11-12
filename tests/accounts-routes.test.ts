import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { closeDatabases } from '../src/server/db';
import { changePassword as setNewPassword, createAccount } from '../src/server/accounts';
import { login, sessionFor } from '../src/server/auth';
import { POST as changePassword } from '../src/app/api/account/password/route';
import { GET as listUsers, POST as createUser } from '../src/app/api/admin/users/route';
import { POST as disableUser } from '../src/app/api/admin/users/[id]/disable/route';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-account-routes-')), 'workspace.sqlite');
after(closeDatabases);

const call = (path: string, token: string, csrf: string | undefined, payload?: unknown) => new NextRequest(`http://localhost:3000${path}`, {
  method: payload === undefined ? 'GET' : 'POST',
  headers: { cookie: `halqa_session=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json', ...(csrf ? { 'x-halqa-csrf': csrf } : {}) },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});

test('password change checks the current password, clears the first-sign-in flag and ends other sessions', async () => {
  const created = createAccount({ email: 'Doctor.One@Example.test ', name: 'Doctor one', role: 'PCP', org: 'Test clinic' }, 'clinic', 'setup');
  assert.equal(created.account.email, 'doctor.one@example.test', 'emails are stored normalised');
  const first = login('doctor.one@example.test', created.temporaryPassword);
  const second = login('doctor.one@example.test', created.temporaryPassword);
  assert.equal(first.user.mustChangePassword, true);
  assert.equal((await changePassword(call('/api/account/password', first.token, undefined, { currentPassword: created.temporaryPassword, newPassword: 'a-new-long-password' }))).status, 403, 'CSRF token required');
  assert.equal((await changePassword(call('/api/account/password', first.token, first.csrf, { currentPassword: created.temporaryPassword, newPassword: 'short' }))).status, 422);
  assert.equal((await changePassword(call('/api/account/password', first.token, first.csrf, { currentPassword: created.temporaryPassword, newPassword: created.temporaryPassword }))).status, 422);
  assert.equal((await changePassword(call('/api/account/password', first.token, first.csrf, { currentPassword: 'not-the-password', newPassword: 'a-new-long-password' }))).status, 403);
  const changed = await changePassword(call('/api/account/password', first.token, first.csrf, { currentPassword: created.temporaryPassword, newPassword: 'a-new-long-password' }));
  assert.equal(changed.status, 200);
  const json = await changed.json();
  assert.equal(json.user.mustChangePassword, false);
  assert.equal(sessionFor(first.token), undefined);
  assert.equal(sessionFor(second.token), undefined);
  assert.ok(sessionFor(changed.cookies.get('halqa_session')!.value));
  assert.equal(login('doctor.one@example.test', 'a-new-long-password').user.mustChangePassword, false);
});

test('only a lead can list, create and disable accounts; a disabled account cannot sign in', async () => {
  const lead = createAccount({ email: 'lead@example.test', name: 'Network lead', role: 'LEAD', org: 'Programme office' }, 'clinic', 'setup');
  const nav = createAccount({ email: 'nav@example.test', name: 'Navigator', role: 'NAVIGATOR', org: 'Hub' }, 'clinic', 'setup');
  // Both have chosen their own password, so the forced change does not decide these answers.
  const leadSession = setNewPassword(lead.account.id, { currentPassword: lead.temporaryPassword, newPassword: 'lead-own-password-1' });
  const navSession = setNewPassword(nav.account.id, { currentPassword: nav.temporaryPassword, newPassword: 'navigator-own-password-1' });
  assert.equal((await listUsers(call('/api/admin/users', navSession.token, undefined))).status, 403);
  const listed = await listUsers(call('/api/admin/users', leadSession.token, undefined));
  assert.equal(listed.status, 200);
  assert.ok(!JSON.stringify(await listed.json()).includes('password_hash'));
  assert.equal((await createUser(call('/api/admin/users', navSession.token, navSession.csrf, { email: 'x@example.test', name: 'New person', role: 'PCP', org: 'Clinic' }))).status, 403);
  assert.equal((await createUser(call('/api/admin/users', leadSession.token, leadSession.csrf, { email: 'not an email', name: 'New person', role: 'PCP', org: 'Clinic' }))).status, 422);
  const made = await createUser(call('/api/admin/users', leadSession.token, leadSession.csrf, { email: 'new@example.test', name: 'New person', role: 'PCP', org: 'Clinic' }));
  assert.equal(made.status, 201);
  const { account, temporaryPassword } = await made.json();
  assert.equal(account.mustChangePassword, true);
  const context = { params: Promise.resolve({ id: account.id }) };
  assert.equal((await disableUser(call(`/api/admin/users/${account.id}/disable`, navSession.token, navSession.csrf, {}), context)).status, 403);
  assert.equal((await disableUser(call(`/api/admin/users/${account.id}/disable`, leadSession.token, leadSession.csrf, {}), { params: Promise.resolve({ id: account.id }) })).status, 200);
  assert.throws(() => login('new@example.test', temporaryPassword), /incorrect/);
});
