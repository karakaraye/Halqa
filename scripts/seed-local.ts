/**
 * npm run seed:local
 *
 * Local development only. Fills an empty database with records for trying the
 * screens: cases, staff and patient accounts. Refuses to run when
 * NODE_ENV=production or when HALQA_ORIGIN is an https address. The temporary
 * password is printed once to this terminal; no file is written.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrap } from '../src/server/bootstrap';
import { closeDatabases } from '../src/server/db';

/** Throws when the environment looks like a live service. */
export function assertLocalSeedAllowed(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV === 'production') throw new Error('seed:local is for local development only and will not run when NODE_ENV is production.');
  if (/^https:/i.test(env.HALQA_ORIGIN ?? '')) throw new Error('seed:local is for local development only and will not run when HALQA_ORIGIN is an https address.');
}

const runDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (runDirectly) {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  try {
    assertLocalSeedAllowed();
    const accounts = bootstrap();
    console.log(`Created local development records and ${accounts.length} accounts. Passwords are shown once and are not saved.`);
    for (const a of accounts) console.log(`${a.role.padEnd(10)} ${a.email}  ${a.password}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'seed:local could not complete.');
    process.exitCode = 1;
  } finally {
    closeDatabases();
  }
}
