/**
 * npm run setup -- --email <email> --name <name> --org <organisation> [--licence <licence>]
 *
 * Creates the database schema and the first clinic-lead account, nothing else:
 * no cases and no other accounts. The temporary password is printed once to
 * this terminal and is never written to a file; only its hash is stored. The
 * account must choose a new password at first sign-in. Every other account is
 * created from the Accounts screen or with `npm run user:create`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createAccount, newAccountSchema } from '../src/server/accounts';
import { HttpError } from '../src/server/auth';
import { closeDatabases, database } from '../src/server/db';
import { COMMAND_LINE_ACTOR, DEFAULT_NETWORK } from './create-user';

/** Creates the first lead and returns the lines to print. Throws HttpError on bad input or when accounts already exist. */
export function setupFirstLead(args: string[]) {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args,
      options: { email: { type: 'string' }, name: { type: 'string' }, org: { type: 'string' }, licence: { type: 'string' } },
      strict: true, allowPositionals: false,
    }) as { values: Record<string, string | undefined> });
  } catch {
    throw new HttpError(422, 'Use --email, --name and --org, with optional --licence.');
  }
  const input = newAccountSchema.safeParse({
    email: values.email, name: values.name, role: 'LEAD', org: values.org,
    ...(values.licence ? { licence: values.licence } : {}),
  });
  if (!input.success) throw new HttpError(422, 'Check the name, email and organisation.');
  // The schema is created here (through the migration helper) before anything is read.
  const db = database();
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw new HttpError(409, 'Accounts already exist, so setup did nothing. Add accounts from the Accounts screen or with npm run user:create.');
  const { account, temporaryPassword } = createAccount(input.data, DEFAULT_NETWORK, COMMAND_LINE_ACTOR);
  return {
    account,
    temporaryPassword,
    lines: [
      `Created the first clinic lead: ${account.name} <${account.email}> in network ${DEFAULT_NETWORK}.`,
      `Temporary password (shown once, not saved anywhere): ${temporaryPassword}`,
      'The account must choose a new password at first sign-in.',
    ],
  };
}

const runDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (runDirectly) {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  try {
    for (const line of setupFirstLead(process.argv.slice(2)).lines) console.log(line);
  } catch (error) {
    console.error(error instanceof HttpError ? error.message : 'Setup could not complete.');
    process.exitCode = 1;
  } finally {
    closeDatabases();
  }
}
