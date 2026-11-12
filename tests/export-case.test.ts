import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeDatabases } from '../src/server/db';
import { createAccount } from '../src/server/accounts';
import { login, sessionFor } from '../src/server/auth';
import { execute, getSnapshot } from '../src/server/workspace';
import { receiveResult } from '../src/server/intake';
import { exportCase, writeCaseExport } from '../scripts/export-case';

const root = mkdtempSync(join(tmpdir(), 'halqa-export-'));
process.env.HALQA_DB_PATH = join(root, 'workspace.sqlite');
delete process.env.HALQA_TEST_CONTROLS;
after(closeDatabases);

const nav = createAccount({ email: 'export-nav@example.test', name: 'Export navigator', role: 'NAVIGATOR', org: 'Hub' }, 'clinic', 'setup');
createAccount({ email: 'export-doctor@example.test', name: 'Export doctor', role: 'PCP', org: 'Clinic' }, 'clinic', 'setup');
const { id } = receiveResult({
  externalId: 'export-1', network: 'clinic',
  patient: { id: 'p-export', name: 'Patient export', age: 61, sex: 'F', phone: '+2348000000009', lang: 'en', preferredChannel: 'SMS' },
  pathwayId: 'CRC_FIT', finding: 'Positive stool test', resultCode: 'FIT+', urgency: 'ROUTINE', sourceLab: 'Test lab', issuedAt: Date.now(),
});
const other = receiveResult({
  externalId: 'export-2', network: 'clinic',
  patient: { id: 'p-other', name: 'Someone else', age: 50, sex: 'M', phone: '+2348000000010', lang: 'en', preferredChannel: 'PHONE' },
  pathwayId: 'CRC_FIT', finding: 'Positive stool test', resultCode: 'FIT+', urgency: 'ROUTINE', sourceLab: 'Test lab', issuedAt: Date.now(),
}).id;
createAccount({ email: 'export-patient@example.test', name: 'Patient export', role: 'PATIENT', org: 'Patient portal', patientCase: id }, 'clinic', 'setup');
const session = sessionFor(login(nav.account.email, nav.temporaryPassword).token)!;
execute(session, { requestId: randomUUID(), revision: getSnapshot(session).revision, action: { type: 'NOTIFY', id, channel: 'SMS' } });

test('the export holds the case, its audit events, its messages and the linked account, and no secrets', () => {
  const result = exportCase(id);
  assert.equal(result.caseId, id);
  assert.equal(result.network, 'clinic');
  assert.equal((result.record as { patient: { name: string } }).patient.name, 'Patient export');
  assert.ok(result.auditEvents.length >= 2, 'intake and the queued message are audited');
  assert.ok(result.auditEvents.every((e) => typeof e.at === 'string' && e.action));
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].phone, '+2348000000009');
  assert.deepEqual(result.patientAccounts.map((a) => a.email), ['export-patient@example.test']);
  const text = JSON.stringify(result);
  assert.ok(!text.includes('password_hash') && !/"password/i.test(text), 'no password or hash');
  assert.ok(!text.includes('Someone else') && !text.includes(other), 'no other patient');
  assert.ok(!text.includes('token') && !text.includes('csrf'));
});

test('an unknown case is refused and nothing is written; an existing file is never overwritten', () => {
  assert.throws(() => exportCase('HQ-9999'), /No case with that id/);
  assert.throws(() => exportCase(''), /Give the case id/);
  const out = join(root, 'export.json');
  assert.equal(writeCaseExport(id, out), out);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).caseId, id);
  assert.throws(() => writeCaseExport(id, out), /already exists/);
  assert.throws(() => writeCaseExport('HQ-9999', join(root, 'none.json')), /No case/);
});

test('npm run export-case exits 1 for an unknown case and writes the file for a known one', () => {
  closeDatabases();
  const tsx = resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
  const env = { ...process.env, HALQA_DB_PATH: process.env.HALQA_DB_PATH };
  const missing = spawnSync(process.execPath, [tsx, 'scripts/export-case.ts', 'HQ-9999'], { env, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No case with that id/);
  const out = join(root, 'cli-export.json');
  const made = spawnSync(process.execPath, [tsx, 'scripts/export-case.ts', id, '--out', out], { env, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).caseId, id);
});
