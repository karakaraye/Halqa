/**
 * npm run backup -- <directory>
 *
 * Writes a consistent copy of the database to <directory>/halqa-<UTC timestamp>.sqlite
 * with SQLite's VACUUM INTO, creating the directory if needed. Prints the path.
 * Never overwrites a file; exits with a non-zero code on any failure. Safe to run
 * while the app and the worker are running.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeDatabases, database } from '../src/server/db';

export const backupName = (now = new Date()) => `halqa-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.sqlite`;

/** Copies the database into the directory and returns the path of the copy. Throws if the file exists or the copy fails. */
export function backupDatabase(directory: string, now = new Date()): string {
  if (!directory) throw new Error('Give the directory to write the backup into: npm run backup -- <directory>');
  const target = join(resolve(directory), backupName(now));
  mkdirSync(resolve(directory), { recursive: true });
  if (existsSync(target)) throw new Error('A backup with that name already exists. Nothing was overwritten.');
  database().prepare('VACUUM INTO ?').run(target);
  return target;
}

const runDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (runDirectly) {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  try {
    console.log(backupDatabase(process.argv[2] ?? ''));
  } catch (error) {
    console.error(error instanceof Error ? `Backup failed: ${error.message}` : 'Backup failed.');
    process.exitCode = 1;
  } finally {
    closeDatabases();
  }
}
