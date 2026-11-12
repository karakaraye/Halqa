import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { database, closeDatabases, SCHEMA_VERSION } from '../src/server/db';
import { createAccount, disableAccount, listAccounts } from '../src/server/accounts';
import { login, sessionFor } from '../src/server/auth';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-accounts-')), 'workspace.sqlite');
after(closeDatabases);

test('version-zero databases migrate without losing accounts; temporary accounts and disabling work', () => {
  const old = new DatabaseSync(process.env.HALQA_DB_PATH!);
  old.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, person TEXT NOT NULL, network TEXT NOT NULL, patient_case TEXT)');
  old.exec(`INSERT INTO users VALUES ('existing','existing@example.test','x:y','{"id":"existing","name":"Existing account","role":"PCP","org":"Test organisation"}','test-network',NULL)`);
  old.close();
  const db = database();
  assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 5);
  assert.equal(db.prepare("SELECT email FROM users WHERE id='existing'").get()?.email, 'existing@example.test');
  for (const table of ['outbox', 'rate_limits', 'services']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
  closeDatabases();
  assert.equal(database().prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
  const created = createAccount({ email: 'operator@example.test', name: 'Test operator', role: 'LEAD', org: 'Test organisation' }, 'test-network', 'setup');
  const signedIn = login(created.account.email, created.temporaryPassword);
  assert.equal(signedIn.user.mustChangePassword, true);
  assert.equal(listAccounts('test-network').find(a => a.id === created.account.id)?.mustChangePassword, true);
  assert.deepEqual(listAccounts('other-network'), []);
  assert.ok(!JSON.stringify(listAccounts('test-network')).includes(created.temporaryPassword));
  assert.throws(() => disableAccount(created.account.id, 'test-network', created.account.id), /own account/);
  disableAccount(created.account.id, 'test-network', 'other-lead');
  assert.equal(sessionFor(signedIn.token), undefined);
  assert.throws(() => login(created.account.email, created.temporaryPassword), /incorrect/);
  closeDatabases();
  assert.equal(listAccounts('test-network').find(a => a.id === created.account.id)?.disabled, true);
});
