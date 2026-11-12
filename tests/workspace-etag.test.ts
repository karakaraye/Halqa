import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { bootstrap } from '../src/server/bootstrap';
import { closeDatabases } from '../src/server/db';
import { login, sessionFor } from '../src/server/auth';
import { execute, getSnapshot } from '../src/server/workspace';
import { etagMatches } from '../src/server/etag';
import { GET as readWorkspace } from '../src/app/api/workspace/route';

process.env.HALQA_DB_PATH = resolve('data', `test-${randomUUID()}`, 'halqa.sqlite');
delete process.env.HALQA_TEST_CONTROLS;
const password = 'Synthetic-test-' + randomUUID();
bootstrap(password);
after(() => closeDatabases());

const read = (token?: string, ifNoneMatch?: string) => readWorkspace(new NextRequest('http://localhost:3000/api/workspace', {
  headers: { ...(token ? { cookie: `halqa_session=${token}` } : {}), ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}) },
}));

test('workspace reads carry an ETag and a matching If-None-Match gets 304 with no body', async () => {
  const nav = login('nav_reem@halqa.test', password);
  const first = await read(nav.token);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag && /^"r\d+-[\w-]+"$/.test(etag), `unexpected tag ${etag}`);
  assert.equal(first.headers.get('cache-control'), 'no-store');

  // The server clock moves between reads; the tag must not.
  await new Promise((r) => setTimeout(r, 5));
  const again = await read(nav.token, etag!);
  assert.equal(again.status, 304);
  assert.equal(await again.text(), '');
  assert.equal(again.headers.get('etag'), etag);
  assert.equal(again.headers.get('cache-control'), 'no-store');
  assert.equal(again.headers.get('vary'), 'Cookie');

  // Weak form and lists are understood; a different tag gets the full answer.
  assert.equal((await read(nav.token, `"other", W/${etag}`)).status, 304);
  assert.equal((await read(nav.token, '"r0-different"')).status, 200);
});

test('the tag changes with the revision and differs between users; sign-in is still required', async () => {
  const nav = login('nav_reem@halqa.test', password);
  const pcp = login('pcp_mariam@halqa.test', password);
  const navTag = (await read(nav.token)).headers.get('etag')!;
  const pcpTag = (await read(pcp.token)).headers.get('etag')!;
  assert.notEqual(navTag, pcpTag);
  assert.equal((await read(pcp.token, navTag)).status, 200, 'another user never gets 304 for someone else\'s tag');

  assert.equal((await read(undefined, navTag)).status, 401);

  const session = sessionFor(nav.token)!;
  const before = getSnapshot(session);
  const open = before.state.cases.find((c) => !c.closure)!;
  execute(session, { requestId: randomUUID(), revision: before.revision, action: { type: 'DELAY', id: open.id, reason: 'PATIENT_TRAVEL', note: 'Away this week.' } });
  const changed = await read(nav.token, navTag);
  assert.equal(changed.status, 200);
  const changedTag = changed.headers.get('etag')!;
  assert.notEqual(changedTag, navTag);
  assert.equal((await changed.json()).revision, before.revision + 1);
});

test('If-None-Match matching', () => {
  assert.equal(etagMatches(null, '"a"'), false);
  assert.equal(etagMatches('"a"', '"a"'), true);
  assert.equal(etagMatches('W/"a"', '"a"'), true);
  assert.equal(etagMatches('"b", "a"', '"a"'), true);
  assert.equal(etagMatches('*', '"a"'), true);
  assert.equal(etagMatches('"b"', '"a"'), false);
});

test('a matching tag is answered before the snapshot is built, and the tag moves with the clock bucket', async () => {
  const { readWorkspace } = await import('../src/server/workspace');
  const { ETAG_CLOCK_BUCKET_MS } = await import('../src/server/etag');
  const session = sessionFor(login('nav_reem@halqa.test', password).token)!;
  const now = Date.now();
  const first = readWorkspace(session, null, now);
  assert.ok(first.snapshot, 'no tag sent: full snapshot');
  const again = readWorkspace(session, first.etag, now);
  assert.equal(again.snapshot, undefined, 'matching tag: nothing built');
  assert.equal(again.etag, first.etag);
  const later = readWorkspace(session, first.etag, now + ETAG_CLOCK_BUCKET_MS);
  assert.ok(later.snapshot, 'a new minute gives a new tag and a fresh snapshot');
  assert.notEqual(later.etag, first.etag);
});

test('parsed cases are reused between reads but never after any change to a case row', async () => {
  const { database } = await import('../src/server/db');
  const session = sessionFor(login('nav_reem@halqa.test', password).token)!;
  const first = getSnapshot(session);
  const again = getSnapshot(session);
  assert.equal(first.state.cases[0], again.state.cases[0], 'unchanged: the same parsed objects');
  const target = first.state.cases[0];
  // A change made straight in the database, as a script or another process would.
  const row = database().prepare('SELECT data FROM cases WHERE id=?').get(target.id) as { data: string };
  database().prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.data), finding: 'Changed outside the app' }), target.id);
  const after = getSnapshot(session);
  assert.equal(after.state.cases.find((c) => c.id === target.id)?.finding, 'Changed outside the app');
  database().prepare('UPDATE cases SET data=? WHERE id=?').run(row.data, target.id);
});

test('the workspace body joins the stored case text and equals the snapshot exactly', async () => {
  const { readWorkspace } = await import('../src/server/workspace');
  for (const who of ['nav_reem@halqa.test', 'pcp_mariam@halqa.test']) {
    const session = sessionFor(login(who, password).token)!;
    const { snapshot, body } = readWorkspace(session, null);
    assert.ok(snapshot && body && snapshot.state.cases.length > 0);
    assert.deepEqual(JSON.parse(body), JSON.parse(JSON.stringify(snapshot)));
  }
});

test('after one case changes, only that case is parsed again', async () => {
  const { database } = await import('../src/server/db');
  const session = sessionFor(login('nav_reem@halqa.test', password).token)!;
  const before = getSnapshot(session).state.cases;
  assert.ok(before.length >= 2);
  const [target, untouched] = before;
  const row = database().prepare('SELECT data FROM cases WHERE id=?').get(target.id) as { data: string };
  database().prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.data), finding: 'Changed once' }), target.id);
  const after = getSnapshot(session).state.cases;
  assert.equal(after.find((c) => c.id === untouched.id), untouched, 'an unchanged case keeps its parsed object');
  assert.notEqual(after.find((c) => c.id === target.id), target);
  assert.equal(after.find((c) => c.id === target.id)?.finding, 'Changed once');
  database().prepare('UPDATE cases SET data=? WHERE id=?').run(row.data, target.id);
});
