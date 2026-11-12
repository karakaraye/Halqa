import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database, closeDatabases } from '../src/server/db';
import { login } from '../src/server/auth';
import { getSnapshot } from '../src/server/workspace';
import { sessionFor } from '../src/server/auth';
import { setupFirstLead } from '../scripts/setup';
import { assertLocalSeedAllowed } from '../scripts/seed-local';

const directory = mkdtempSync(join(tmpdir(), 'halqa-setup-'));
process.env.HALQA_DB_PATH = join(directory, 'halqa.sqlite');
after(closeDatabases);

const args = ['--email', 'first.lead@example.test', '--name', 'First Lead', '--org', 'Test organisation'];

test('setup creates only the first lead, in the default network, and stores the password hashed', () => {
  const cwdBefore = readdirSync(process.cwd()).sort();
  const result = setupFirstLead(args);
  const db = database();
  const users = db.prepare('SELECT id,email,password_hash,network,must_change_password FROM users').all() as { email: string; password_hash: string; network: string; must_change_password: number }[];
  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'first.lead@example.test');
  assert.equal(users[0].network, 'halqa-network');
  assert.equal(users[0].must_change_password, 1);
  assert.equal(result.account.role, 'LEAD');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cases').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM services').get() as { n: number }).n, 0);
  // The password is printed once and stored only as a hash.
  assert.ok(result.lines.some(l => l.includes(result.temporaryPassword)));
  assert.ok(!users[0].password_hash.includes(result.temporaryPassword));
  closeDatabases();
  assert.ok(!existsSync(join('data', 'local-accounts.txt')));
  assert.deepEqual(readdirSync(process.cwd()).sort(), cwdBefore, 'nothing is written beside the database');
  assert.deepEqual(readdirSync(directory).filter(n => !n.startsWith('halqa.sqlite')), []);
  // The new lead can sign in with it and sees an empty workspace.
  const signedIn = login('first.lead@example.test', result.temporaryPassword);
  assert.equal(signedIn.user.mustChangePassword, true);
  const snapshot = getSnapshot(sessionFor(signedIn.token)!);
  assert.equal(snapshot.state.cases.length, 0);
});

test('the database file holds no copy of the password', () => {
  closeDatabases();
  const second = join(mkdtempSync(join(tmpdir(), 'halqa-setup-')), 'halqa.sqlite');
  process.env.HALQA_DB_PATH = second;
  const result = setupFirstLead(args);
  closeDatabases();
  assert.ok(!readFileSync(second).includes(Buffer.from(result.temporaryPassword)));
  process.env.HALQA_DB_PATH = join(directory, 'halqa.sqlite');
});

test('setup refuses a second run and changes nothing', () => {
  assert.throws(() => setupFirstLead(['--email', 'other@example.test', '--name', 'Other Person', '--org', 'Test organisation']), /already exist/);
  assert.equal((database().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1);
});

test('setup refuses incomplete or unknown arguments', () => {
  assert.throws(() => setupFirstLead(['--email', 'x@example.test']), /Check the name/);
  assert.throws(() => setupFirstLead([...args, '--role', 'PCP']), /Use --email/);
});

test('seed:local refuses production and https origins', () => {
  assert.throws(() => assertLocalSeedAllowed({ NODE_ENV: 'production' }), /local development only/);
  assert.throws(() => assertLocalSeedAllowed({ HALQA_ORIGIN: 'https://halqa.example.org' }), /https/);
  assert.doesNotThrow(() => assertLocalSeedAllowed({ NODE_ENV: 'development', HALQA_ORIGIN: 'http://localhost:3000' }));
  assert.doesNotThrow(() => assertLocalSeedAllowed({}));
});
