/**
 * npm run load-check -- [--duration <seconds>] [--url <running server>] [--cases <n>] [--clients <n>] [--writers <n>] [--port <n>] [--keep]
 *
 * Builds a temporary database (data/load-check-<id>/) with one network of staff
 * accounts and 2,000 open cases written straight into SQLite, starts the built
 * app and worker on --port (default 3057; run `npm run build` first), signs in
 * 50 staff clients and has each poll GET /api/workspace every 3 seconds with
 * If-None-Match, while 5 of them also save a small change every 10 seconds.
 * Prints requests, errors, latency percentiles and database lock errors, and
 * exits with code 1 when the 95th percentile is 300 ms or more or anything failed.
 *
 * With --url <address> --db <file> the script writes the records into that
 * server's database file (it must be empty) and uses the running server instead
 * of starting one.
 *
 * The records are working data for this check only: neutral labels, no real
 * people, and the directory is deleted afterwards unless --keep is given.
 */
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { openCase } from '../src/domain/intake';
import { runEngine } from '../src/lib/engine';
import { hashPassword } from '../src/server/auth';
import { PathwayId, Person, Role } from '../src/types/halqa';

export const NETWORK = 'load-network';
const PATHWAYS: PathwayId[] = ['CRC_FIT', 'BREAST_BIRADS', 'CERVICAL_HPV', 'DIABETES_HBA1C'];
const HUBS = 5; const CLINICS = 10;

export interface LoadAccount { email: string; password: string; role: Role; id: string }

/** The staff of the check: navigators in 5 hubs, doctors in 10 clinics, specialists and leads. */
export function loadStaff(count: number): Person[] {
  const people: Person[] = [];
  const plan: [Role, number][] = [['NAVIGATOR', Math.round(count * 0.4)], ['PCP', Math.round(count * 0.4)], ['SPECIALIST', 0], ['LEAD', 2]];
  plan[2][1] = Math.max(1, count - plan[0][1] - plan[1][1] - plan[3][1]);
  for (const [role, n] of plan) for (let i = 1; i <= n; i++) {
    const org = role === 'NAVIGATOR' ? `Hub ${1 + (i % HUBS)}` : role === 'PCP' ? `Clinic ${1 + (i % CLINICS)}` : role === 'SPECIALIST' ? `Service ${i}` : 'Programme office';
    people.push({ id: `load_${role.toLowerCase()}_${i}`, name: `${role.toLowerCase()} ${i}`, role, org, ...(role === 'PCP' || role === 'SPECIALIST' || role === 'LEAD' ? { licence: `LIC-${1000 + i}` } : {}) });
  }
  return people.slice(0, Math.max(count, 4));
}

/**
 * Writes the accounts, services and cases straight into a new database file in
 * one transaction (much faster than the HTTP routes). Returns the accounts and
 * their passwords. The schema is created by the app's own database code.
 */
export async function buildLoadDatabase(file: string, { cases = 2000, staff = 50, now = Date.now() } = {}): Promise<LoadAccount[]> {
  process.env.HALQA_DB_PATH = file;
  const { database, closeDatabases } = await import('../src/server/db');
  const db: DatabaseSync = database();
  const people = loadStaff(staff);
  const accounts: LoadAccount[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw new Error('The load-check database is not empty.');
    const insertUser = db.prepare('INSERT INTO users(id,email,password_hash,person,network,must_change_password) VALUES (?,?,?,?,?,0)');
    for (const person of people) {
      const password = `load-${randomUUID()}`;
      const email = `${person.id.replaceAll('_', '.')}@load.check`;
      insertUser.run(person.id, email, hashPassword(password), JSON.stringify(person), NETWORK);
      accounts.push({ email, password, role: person.role, id: person.id });
    }
    const specialists = people.filter((p) => p.role === 'SPECIALIST');
    const insertService = db.prepare('INSERT INTO services(id,network,facility,specialty,pathway,specialist_user_id) VALUES (?,?,?,?,?,?)');
    PATHWAYS.forEach((pathway, i) => insertService.run(`svc_load_${i}`, NETWORK, `Service for ${pathway}`, 'Specialist care', pathway, specialists[i % specialists.length].id));
    const navigators = people.filter((p) => p.role === 'NAVIGATOR');
    const doctors = people.filter((p) => p.role === 'PCP');
    const insertCase = db.prepare('INSERT INTO cases(id,network,data,external_id) VALUES (?,?,?,?)');
    const directory = { people, services: PATHWAYS.map((pathway, i) => ({ facility: `Service for ${pathway}`, specialty: 'Specialist care', pathway, specialist: specialists[i % specialists.length].id })) };
    for (let i = 0; i < cases; i++) {
      const id = `HQ-${String(10001 + i)}`;
      const c = openCase({
        id,
        navigator: navigators[i % navigators.length],
        pcp: doctors[i % doctors.length],
        result: {
          patient: { id: `load-patient-${i + 1}`, name: `Patient ${i + 1}`, age: 40 + (i % 35), sex: i % 2 ? 'F' : 'M', phone: '+10000000000', lang: 'en', preferredChannel: 'PHONE' },
          pathwayId: PATHWAYS[i % PATHWAYS.length], finding: 'Result needing follow-up', resultCode: 'POS', urgency: i % 10 === 0 ? 'CRITICAL' : 'ROUTINE',
          sourceLab: 'Laboratory', issuedAt: now - (i % 72) * 3600_000,
        },
      }, now - (i % 72) * 3600_000);
      // Alerts that would already have been raised on a running service are raised here, so the
      // check measures steady running rather than the worker's first pass over 2,000 new cases.
      const settled = runEngine(c, now, directory).next;
      insertCase.run(id, NETWORK, JSON.stringify(settled), `load-${i + 1}`);
    }
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('revision','1'),('offset','0'),('ingestSeq','0')").run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    closeDatabases();
  }
  return accounts;
}

/** Percentile (nearest rank) of a list of milliseconds. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

interface Measurement { kind: 'poll' | 'write' | 'signin'; status: number; ms: number; at?: number }

class Client {
  cookie = ''; csrf = ''; etag = ''; revision = 0; caseIds: string[] = []; parseBodies = false;
  constructor(private base: string, readonly account: LoadAccount, private record: (s: Measurement) => void) {}
  private async timed(kind: Measurement['kind'], url: string, init: RequestInit) {
    const started = performance.now();
    try {
      const response = await fetch(url, init);
      const ms = performance.now() - started;
      this.record({ kind, status: response.status, ms });
      return response;
    } catch {
      this.record({ kind, status: 0, ms: performance.now() - started });
      return undefined;
    }
  }
  async signIn() {
    const response = await this.timed('signin', `${this.base}/api/session`, {
      method: 'POST', headers: { origin: this.base, 'content-type': 'application/json' }, body: JSON.stringify({ email: this.account.email, password: this.account.password }),
    });
    if (!response || response.status !== 200) throw new Error(`Sign-in failed for a load-check account (${response?.status ?? 'no answer'}).`);
    this.cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
    this.csrf = (await response.json()).csrf;
  }
  /** One poll, timed until the whole body has arrived. */
  async poll(conditional = true) {
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.base}/api/workspace`, { headers: { cookie: this.cookie, ...(conditional && this.etag ? { 'if-none-match': this.etag } : {}) } });
      const body = await response.arrayBuffer();
      this.record({ kind: 'poll', status: response.status, ms: performance.now() - started });
      if (response.status !== 200) return;
      this.etag = response.headers.get('etag') ?? '';
      // Only clients that save parse the body (for case ids); the others read the revision from
      // the tag, so this script's own work on the same machine does not skew the numbers.
      if (this.parseBodies) {
        const snapshot = JSON.parse(Buffer.from(body).toString('utf8')) as { revision: number; state: { cases: { id: string; closure?: unknown }[] } };
        this.revision = snapshot.revision;
        this.caseIds = snapshot.state.cases.filter((c) => !c.closure).map((c) => c.id);
      } else {
        this.revision = Number(/^"r(\d+)-/.exec(this.etag)?.[1] ?? this.revision);
      }
    } catch {
      this.record({ kind: 'poll', status: 0, ms: performance.now() - started });
    }
  }
  /** A small saved change on one visible case. A changed record (409) is refreshed and tried once more. */
  async write(): Promise<'ok' | 'conflict' | 'error'> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.poll(attempt === 0);
      const id = this.caseIds[Math.floor(Math.random() * this.caseIds.length)];
      if (!id) return 'error';
      const response = await this.timed('write', `${this.base}/api/workspace`, {
        method: 'POST', headers: { cookie: this.cookie, origin: this.base, 'x-halqa-csrf': this.csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: randomUUID(), revision: this.revision, action: { type: 'DELAY', id, reason: 'PATIENT_TRAVEL', note: 'Recorded by the load check.' } }),
      });
      if (!response) return 'error';
      await response.body?.cancel();
      if (response.status === 200) return 'ok';
      if (response.status !== 409) return 'error';
    }
    return 'conflict';
  }
}

async function waitForHealth(base: string, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The server did not answer /api/health in time.');
}

export async function runLoadCheck(options: { durationS: number; url?: string; db?: string; cases: number; clients: number; writers: number; port: number; keep: boolean }) {
  let server: ChildProcess | undefined;
  let dir: string | undefined;
  const serverLines: string[] = [];
  let accounts: LoadAccount[];
  let base = options.url?.replace(/\/$/, '');
  const startedBuild = performance.now();
  if (!base) {
    dir = resolve('data', `load-check-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'halqa.sqlite');
    accounts = await buildLoadDatabase(file, { cases: options.cases, staff: options.clients });
    console.log(`Database with ${options.cases} cases and ${accounts.length} staff accounts built in ${Math.round(performance.now() - startedBuild)} ms.`);
    base = `http://localhost:${options.port}`;
    server = spawn(process.execPath, [resolve('scripts', 'serve.mjs'), 'start'], {
      env: { ...process.env, PORT: String(options.port), HALQA_DB_PATH: file, NODE_ENV: 'production', HALQA_TEST_CONTROLS: '0', NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    for (const stream of [server.stdout!, server.stderr!]) stream.on('data', (chunk: Buffer) => serverLines.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean)));
    await waitForHealth(base);
  } else {
    // A server someone else started: its database file must be given and empty, and the records are written into it.
    if (!options.db) throw new Error('With --url, also give --db: the empty database file that server uses.');
    accounts = await buildLoadDatabase(resolve(options.db), { cases: options.cases, staff: options.clients });
    await waitForHealth(base);
  }

  const measurements: Measurement[] = [];
  const record = (s: Measurement) => measurements.push({ ...s, at: Date.now() });
  const clients = accounts.slice(0, options.clients).map((a) => new Client(base!, a, record));
  for (const c of clients) await c.signIn();
  const writerPool = clients.filter((c) => c.account.role === 'NAVIGATOR' || c.account.role === 'PCP').slice(0, options.writers);
  for (const c of writerPool) c.parseBodies = true;
  const writes = { ok: 0, conflict: 0, error: 0 };
  console.log(`${clients.length} clients signed in; ${writerPool.length} of them also save a change every 10 seconds. Running for ${options.durationS} s.`);

  const started = Date.now();
  const end = started + options.durationS * 1000;
  const loops: Promise<void>[] = [];
  for (const c of clients) loops.push((async () => {
    await new Promise((r) => setTimeout(r, Math.random() * 3000));
    while (Date.now() < end) {
      const t = Date.now();
      await c.poll();
      await new Promise((r) => setTimeout(r, Math.max(0, 3000 - (Date.now() - t))));
    }
  })());
  for (const c of writerPool) loops.push((async () => {
    await new Promise((r) => setTimeout(r, Math.random() * 10_000));
    while (Date.now() < end) {
      const t = Date.now();
      writes[await c.write()]++;
      await new Promise((r) => setTimeout(r, Math.max(0, 10_000 - (Date.now() - t))));
    }
  })());
  await Promise.all(loops);

  if (server) {
    const exited = new Promise((r) => server!.once('exit', r));
    // The launcher starts the web server and the worker as its own children; stop all three.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill('SIGTERM');
    await exited;
  }
  if (dir && !options.keep) rmSync(dir, { recursive: true, force: true });

  const of = (kind: Measurement['kind']) => measurements.filter((s) => s.kind === kind);
  const ok = (s: Measurement) => s.status === 200 || s.status === 304 || (s.kind === 'write' && s.status === 409);
  const stats = (list: Measurement[]) => ({ requests: list.length, p50: Math.round(percentile(list.map((s) => s.ms), 50)), p95: Math.round(percentile(list.map((s) => s.ms), 95)), p99: Math.round(percentile(list.map((s) => s.ms), 99)), max: Math.round(Math.max(0, ...list.map((s) => s.ms))) });
  const measured = [...of('poll'), ...of('write')];
  const errors = measured.filter((s) => !ok(s));
  const lockLines = serverLines.filter((l) => /database is locked|SQLITE_BUSY/i.test(l));
  const failedServer = serverLines.filter((l) => /"status":5\d\d/.test(l));
  const summary = {
    durationS: options.durationS, cases: options.cases, clients: clients.length, writers: writerPool.length,
    all: stats(measured),
    polls: { ...stats(of('poll')), notModified: of('poll').filter((s) => s.status === 304).length, full: of('poll').filter((s) => s.status === 200).length },
    writes: { ...stats(of('write')), ...writes },
    errors: errors.length,
    errorStatuses: Object.fromEntries([...new Set(errors.map((e) => e.status))].map((s) => [s, errors.filter((e) => e.status === s).length])),
    serverErrorLines: failedServer.length,
    databaseLockErrors: lockLines.length,
    overOneSecond: measured.filter((s) => s.ms >= 1000).length,
    // 95th percentile per 30-second window, to show whether slow answers are spread out or bunched.
    p95By30s: Array.from({ length: Math.ceil(options.durationS / 30) }, (_, i) => Math.round(percentile(measured.filter((s) => (s.at ?? 0) >= started + i * 30_000 && (s.at ?? 0) < started + (i + 1) * 30_000).map((s) => s.ms), 95))),
    goalMet: false,
  };
  summary.goalMet = summary.all.p95 < 300 && summary.errors === 0 && summary.databaseLockErrors === 0 && summary.writes.error === 0;
  return summary;
}

const runDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (runDirectly) {
  const { values } = parseArgs({
    args: process.argv.slice(2), strict: true, allowPositionals: false,
    options: { duration: { type: 'string' }, url: { type: 'string' }, db: { type: 'string' }, cases: { type: 'string' }, clients: { type: 'string' }, writers: { type: 'string' }, port: { type: 'string' }, keep: { type: 'boolean' } },
  });
  const number = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback);
  runLoadCheck({
    durationS: number(values.duration, 60), url: values.url, db: values.db, cases: number(values.cases, 2000), clients: number(values.clients, 50),
    writers: number(values.writers, 5), port: number(values.port, 3057), keep: Boolean(values.keep),
  }).then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    console.log(summary.goalMet ? 'Goal met: 95th percentile under 300 ms with no errors.' : 'Goal not met.');
    process.exit(summary.goalMet ? 0 : 1);
  }).catch((error) => {
    console.error(`Load check could not complete: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exit(1);
  });
}
