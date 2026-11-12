import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLoadDatabase, loadStaff, percentile, NETWORK } from '../scripts/load-check';

test('load-check staff plan and percentile', () => {
  const staff = loadStaff(50);
  assert.equal(staff.length, 50);
  assert.deepEqual([...new Set(staff.map((p) => p.role))].sort(), ['LEAD', 'NAVIGATOR', 'PCP', 'SPECIALIST']);
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
});

test('the load-check database holds the asked-for cases and accounts in one network', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'halqa-load-')), 'halqa.sqlite');
  const accounts = await buildLoadDatabase(file, { cases: 40, staff: 10 });
  assert.equal(accounts.length, 10);
  const { database, closeDatabases } = await import('../src/server/db');
  process.env.HALQA_DB_PATH = file;
  const db = database();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cases WHERE network=?').get(NETWORK) as { n: number }).n, 40);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users WHERE must_change_password=0').get() as { n: number }).n, 10);
  closeDatabases();
  await assert.rejects(() => buildLoadDatabase(file, { cases: 1, staff: 4 }), /not empty/);
});
