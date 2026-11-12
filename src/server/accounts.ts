import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Person, Role } from '@/types/halqa';
import { database, transaction } from './db';
import { HttpError, User, UserRow, hashPassword, issueSession, recordEvent, userFromRow, verifyPassword } from './auth';

export const newAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(2).max(120),
  role: z.enum(['NAVIGATOR', 'PCP', 'SPECIALIST', 'LEAD', 'PATIENT']),
  org: z.string().trim().min(2).max(160),
  licence: z.string().trim().min(4).max(60).optional(),
  patientCase: z.string().trim().min(1).max(100).optional(),
}).strict();
export type NewAccount = z.infer<typeof newAccountSchema>;

/** What a lead may see about an account. Never includes the password hash. */
export interface AccountSummary {
  id: string; email: string; name: string; role: Role; org: string; licence?: string;
  patientCase?: string; mustChangePassword: boolean; disabled: boolean;
}

export const temporaryPassword = () => randomBytes(18).toString('base64url');

function summary(user: User, disabledAt: number | null): AccountSummary {
  const { person } = user;
  return {
    id: user.id, email: user.email, name: person.name, role: person.role, org: person.org, licence: person.licence,
    patientCase: user.patientCase, mustChangePassword: Boolean(user.mustChangePassword), disabled: disabledAt != null,
  };
}

/**
 * Inserts one account inside the caller's transaction. The password is hashed
 * here; when it is temporary the account must choose a new one before it can
 * save anything.
 */
export function insertAccount(db: DatabaseSync, input: NewAccount, network: string, password: string, mustChange: boolean, id?: string): AccountSummary {
  if (input.role === 'PATIENT') {
    if (!input.patientCase) throw new HttpError(422, 'A patient account needs the case it belongs to.');
    const owner = db.prepare('SELECT network FROM cases WHERE id=?').get(input.patientCase) as { network: string } | undefined;
    if (owner?.network !== network) throw new HttpError(422, 'That case does not exist in this network.');
    if (db.prepare('SELECT id FROM users WHERE patient_case=?').get(input.patientCase)) throw new HttpError(409, 'That case already has a patient account.');
  } else if (input.patientCase) {
    throw new HttpError(422, 'Only a patient account can be linked to a case.');
  }
  if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new HttpError(409, 'An account with that email already exists.');

  const person: Person = { id: id ?? `usr_${randomUUID().replaceAll('-', '').slice(0, 16)}`, name: input.name, role: input.role, org: input.org };
  if (input.licence) person.licence = input.licence;
  db.prepare('INSERT INTO users(id,email,password_hash,person,network,patient_case,must_change_password) VALUES (?,?,?,?,?,?,?)')
    .run(person.id, input.email, hashPassword(password), JSON.stringify(person), network, input.patientCase ?? null, mustChange ? 1 : 0);
  return summary({ id: person.id, email: input.email, person, network, patientCase: input.patientCase, mustChangePassword: mustChange }, null);
}

/** Creates an account with a temporary password that is returned once and never stored in clear. */
export function createAccount(input: NewAccount, network: string, createdBy: string) {
  // Validate here as well as in the route, so every caller stores a normalised email.
  const parsed = newAccountSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, 'Check the name, email, role and organisation.');
  const password = temporaryPassword();
  const account = transaction((db) => {
    const created = insertAccount(db, parsed.data, network, password, true);
    recordEvent(db, createdBy, 'ACCOUNT_CREATED', { account: created.id, role: created.role, network });
    return created;
  });
  return { account, temporaryPassword: password };
}

export function listAccounts(network: string): AccountSummary[] {
  const rows = database().prepare('SELECT * FROM users WHERE network=? ORDER BY email').all(network) as UserRow[];
  return rows.map((row) => summary(userFromRow(row), row.disabled_at));
}

/** Blocks sign-in for an account and ends its sessions. The record itself is kept for the audit trail. */
export function disableAccount(id: string, network: string, disabledBy: string) {
  if (id === disabledBy) throw new HttpError(409, 'You cannot disable your own account.');
  transaction((db) => {
    const row = db.prepare('SELECT * FROM users WHERE id=? AND network=?').get(id, network) as UserRow | undefined;
    if (!row) throw new HttpError(404, 'Account not found.');
    if (!row.disabled_at) {
      db.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(Date.now(), id);
      recordEvent(db, disabledBy, 'ACCOUNT_DISABLED', { account: id, network });
    }
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  });
}

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
}).strict();

/**
 * Replaces the password after checking the current one, clears the first-sign-in
 * flag and ends every session of the account. Returns a fresh session for the
 * device that made the change.
 */
export function changePassword(userId: string, input: unknown) {
  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, 'The new password needs at least 12 characters.');
  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) throw new HttpError(422, 'Choose a new password that is different from the current one.');
  const row = database().prepare('SELECT * FROM users WHERE id=?').get(userId) as UserRow | undefined;
  if (!row || row.disabled_at != null) throw new HttpError(401, 'Please sign in.');
  if (!verifyPassword(currentPassword, row.password_hash)) throw new HttpError(403, 'The current password is not correct.');
  const hash = hashPassword(newPassword);
  return transaction((db) => {
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hash, userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    recordEvent(db, userId, 'PASSWORD_CHANGED', {});
    return { ...issueSession(db, userId), user: { ...userFromRow(row), mustChangePassword: false } };
  });
}
