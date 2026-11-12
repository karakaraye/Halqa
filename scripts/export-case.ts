/**
 * npm run export-case -- <caseId> [--out <file>]
 *
 * Writes one patient's record as JSON, for a request from the patient to see the
 * information held about them: the case as stored, every audit event of that
 * case, the messages queued for the patient, and the patient account linked to
 * the case (id, email, name, created state), never a password hash, a session or
 * a key. Without --out the JSON goes to standard output. Refuses when the case
 * does not exist, and never overwrites an existing file.
 *
 * The file holds health information: store and send it as the operator's
 * data-protection procedure requires (docs/data-protection.md).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { closeDatabases, database } from '../src/server/db';

export interface CaseExport {
  exportedAt: string;
  caseId: string;
  network: string;
  record: unknown;
  auditEvents: { sequence: number; at: string; userId: string | null; action: string; detail: unknown }[];
  messages: { id: string; channel: string; language: string; phone: string; template: string; status: string; attempts: number; createdAt: string; updatedAt: string }[];
  patientAccounts: { id: string; email: string; name: string; disabled: boolean }[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const parse = (text: string) => { try { return JSON.parse(text); } catch { return text; } };

/** Builds the export for one case. Throws when the case does not exist. */
export function exportCase(caseId: string, now = new Date()): CaseExport {
  if (!caseId || caseId.length > 100) throw new Error('Give the case id: npm run export-case -- <caseId> [--out <file>]');
  const db = database();
  const row = db.prepare('SELECT id, network, data FROM cases WHERE id=?').get(caseId) as { id: string; network: string; data: string } | undefined;
  if (!row) throw new Error('No case with that id exists. Nothing was written.');
  const events = db.prepare('SELECT sequence, at, user_id, action, detail FROM events WHERE case_id=? ORDER BY sequence').all(caseId) as { sequence: number; at: number; user_id: string | null; action: string; detail: string }[];
  const outbox = db.prepare('SELECT id, channel, lang, to_phone, template, status, attempts, created_at, updated_at FROM outbox WHERE case_id=? ORDER BY created_at').all(caseId) as { id: string; channel: string; lang: string; to_phone: string; template: string; status: string; attempts: number; created_at: number; updated_at: number }[];
  // Only these columns are read, so a password hash can never reach the file.
  const accounts = db.prepare('SELECT id, email, person, disabled_at FROM users WHERE patient_case=?').all(caseId) as { id: string; email: string; person: string; disabled_at: number | null }[];
  return {
    exportedAt: now.toISOString(),
    caseId: row.id,
    network: row.network,
    record: JSON.parse(row.data),
    auditEvents: events.map((e) => ({ sequence: e.sequence, at: iso(e.at), userId: e.user_id, action: e.action, detail: parse(e.detail) })),
    messages: outbox.map((m) => ({ id: m.id, channel: m.channel, language: m.lang, phone: m.to_phone, template: m.template, status: m.status, attempts: m.attempts, createdAt: iso(m.created_at), updatedAt: iso(m.updated_at) })),
    patientAccounts: accounts.map((a) => ({ id: a.id, email: a.email, name: (parse(a.person) as { name?: string }).name ?? '', disabled: a.disabled_at != null })),
  };
}

/** Writes the export to a new file and returns its path. */
export function writeCaseExport(caseId: string, out: string): string {
  const target = resolve(out);
  if (existsSync(target)) throw new Error('That file already exists. Nothing was overwritten.');
  writeFileSync(target, JSON.stringify(exportCase(caseId), null, 2) + '\n', { flag: 'wx' });
  return target;
}

const runDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (runDirectly) {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { out: { type: 'string' } }, allowPositionals: true, strict: true });
    if (positionals.length !== 1) throw new Error('Give one case id: npm run export-case -- <caseId> [--out <file>]');
    if (values.out) console.log(`Written: ${writeCaseExport(positionals[0], values.out)}`);
    else console.log(JSON.stringify(exportCase(positionals[0]), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'The export could not be made.');
    process.exitCode = 1;
  } finally {
    closeDatabases();
  }
}
