/**
 * npm run user:create -- --email <email> --name <name> --role <role> --org <organisation>
 *                        [--licence <licence>] [--network <network>] [--patient-case <case id>]
 *
 * Creates one account with a random temporary password. The password is printed
 * once to this terminal and never written to a file; only its hash is stored.
 * The account must choose a new password at first sign-in.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createAccount, newAccountSchema } from '../src/server/accounts';
import { HttpError } from '../src/server/auth';

/** The network `npm run setup` creates. */
export const DEFAULT_NETWORK = 'halqa-network';
export const COMMAND_LINE_ACTOR = 'command-line';

const networkSchema = z.string().trim().min(1).max(200);

/** Parses the arguments, creates the account and returns the lines to print. Throws HttpError on bad input. */
export function createUserFromArgs(args: string[]) {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, org: { type: 'string' },
        licence: { type: 'string' }, network: { type: 'string' }, 'patient-case': { type: 'string' },
      },
      strict: true, allowPositionals: false,
    }) as { values: Record<string, string | undefined> });
  } catch {
    throw new HttpError(422, 'Use --email, --name, --role and --org, with optional --licence, --network and --patient-case.');
  }
  const input = newAccountSchema.safeParse({
    email: values.email, name: values.name, role: values.role?.toUpperCase(), org: values.org,
    ...(values.licence ? { licence: values.licence } : {}),
    ...(values['patient-case'] ? { patientCase: values['patient-case'] } : {}),
  });
  if (!input.success) throw new HttpError(422, 'Check the name, email, role and organisation.');
  const network = networkSchema.safeParse(values.network ?? DEFAULT_NETWORK);
  if (!network.success) throw new HttpError(422, 'Check the network name.');
  const { account, temporaryPassword } = createAccount(input.data, network.data, COMMAND_LINE_ACTOR);
  return {
    account,
    temporaryPassword,
    lines: [
      `Created ${account.role} account for ${account.name} <${account.email}> in network ${network.data}.`,
      `Temporary password (shown once, not saved anywhere): ${temporaryPassword}`,
      'The account must choose a new password at first sign-in.',
    ],
  };
}

const runDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (runDirectly) {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  try {
    for (const line of createUserFromArgs(process.argv.slice(2)).lines) console.log(line);
  } catch (error) {
    console.error(error instanceof HttpError ? error.message : 'The account could not be created.');
    process.exitCode = 1;
  }
}
