import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { database, transaction } from './db';
import { DatabaseSync } from 'node:sqlite';
import { Person } from '@/types/halqa';

export interface User { id: string; email: string; person: Person; network: string; patientCase?: string; mustChangePassword?: boolean }
export interface Session { user: User; csrf: string; expiresAt: number }
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); this.name = 'HttpError'; } }
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
/** Compares two secrets in constant time (both are hashed first, so their lengths never matter). */
export function sameSecret(supplied: string | null | undefined, expected: string): boolean {
  const a = createHash('sha256').update(supplied ?? '').digest(); const b = createHash('sha256').update(expected).digest();
  return supplied != null && timingSafeEqual(a, b);
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64); const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export type UserRow = { id: string; email: string; password_hash: string; person: string; network: string; patient_case?: string; must_change_password?: number; disabled_at: number | null };
export function userFromRow(row: UserRow): User { return { id: row.id, email: row.email, person: JSON.parse(row.person), network: row.network, patientCase: row.patient_case || undefined, mustChangePassword: Boolean(row.must_change_password) }; }
const fromRow = userFromRow;
export function recordEvent(db: DatabaseSync, userId: string, action: string, detail: Record<string, unknown>) {
  db.prepare('INSERT INTO events(case_id,user_id,at,action,detail) VALUES(NULL,?,?,?,?)').run(userId, Date.now(), action, JSON.stringify(detail));
}
/** Wrong passwords allowed per email and client before a 15-minute lock. */
export const MAX_SIGN_IN_FAILURES = 8;
// The limit is keyed on email plus client address so a stranger cannot lock a real user out
// of every device by sending wrong passwords for that email.
export function login(email: string, password: string, clientKey = 'local') {
  email = email.trim().toLowerCase();
  const limitKey = `${email}|${clientKey.trim().slice(0, 200) || 'local'}`;
  const now = Date.now(); const db = database();
  const limit = db.prepare('SELECT * FROM login_limits WHERE email=?').get(limitKey) as { attempts: number; reset_at: number } | undefined;
  if (limit && limit.reset_at > now && limit.attempts >= MAX_SIGN_IN_FAILURES) throw new HttpError(429, 'Too many attempts. Please try again in 15 minutes.');
  const row = db.prepare('SELECT * FROM users WHERE email=?').get(email) as UserRow | undefined;
  // Perform the same expensive operation for unknown accounts.
  const fallback = '00000000000000000000000000000000:' + '00'.repeat(64);
  const valid = verifyPassword(password, row?.password_hash ?? fallback);
  if (!row || !valid || row.disabled_at != null) {
    const attempts = limit && limit.reset_at > now ? limit.attempts + 1 : 1;
    transaction(tx => {
      tx.prepare('INSERT OR REPLACE INTO login_limits VALUES (?,?,?)').run(limitKey, attempts, limit && limit.reset_at > now ? limit.reset_at : now + 15 * 60_000);
      // One audit entry when an existing account reaches the limit; never the address or the password.
      if (row && attempts === MAX_SIGN_IN_FAILURES) recordEvent(tx, row.id, 'SIGN_IN_LOCKED', { minutes: 15 });
    });
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  const issued = transaction(db => {
    db.prepare('DELETE FROM login_limits WHERE email=?').run(limitKey);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    const created = issueSession(db, row.id, now);
    db.prepare('INSERT INTO events(case_id,user_id,at,action,detail) VALUES(NULL,?,?,?,?)').run(row.id, now, 'SIGN_IN', '{}');
    return created;
  });
  return { ...issued, user: fromRow(row) };
}
export const SESSION_HOURS = 8;
/** Creates a session inside the caller's transaction. Only the hash of the token is stored. */
export function issueSession(db: DatabaseSync, userId: string, now = Date.now()) {
  const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url'); const expiresAt = now + SESSION_HOURS * 3600_000;
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_seen_at) VALUES (?,?,?,?,?)').run(tokenHash(token), userId, csrf, expiresAt, now);
  return { token, csrf, expiresAt };
}
/**
 * Minutes without any request before a session ends. HALQA_SESSION_IDLE_MINUTES,
 * a whole number from 1 to 480; default 30. The absolute lifetime stays
 * SESSION_HOURS whatever the activity. An open screen that is visible keeps
 * polling and so counts as activity; the screens stop polling while hidden.
 */
export function sessionIdleMs(value = process.env.HALQA_SESSION_IDLE_MINUTES): number {
  const minutes = Number(value?.trim() || '30');
  return (Number.isInteger(minutes) && minutes >= 1 && minutes <= 480 ? minutes : 30) * 60_000;
}
/** last_seen_at is written at most this often per session, so reads stay almost write-free. */
export const LAST_SEEN_STEP_MS = 60_000;

export function sessionFor(token?: string, now = Date.now()): Session | undefined {
  if (!token || token.length > 200) return;
  const db = database();
  const hash = tokenHash(token);
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash, now) as { user_id: string; csrf: string; expires_at: number; last_seen_at: number } | undefined;
  if (!session) return;
  if (session.last_seen_at <= now - sessionIdleMs()) {
    // Refused either way; if the file is busy the worker's cleanup deletes the row later.
    withoutWaiting(db, () => db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash));
    return;
  }
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id) as UserRow | undefined;
  if (!user || user.disabled_at != null) return;
  if (now - session.last_seen_at >= LAST_SEEN_STEP_MS) withoutWaiting(db, () => db.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(now, hash));
  return { user: fromRow(user), csrf: session.csrf, expiresAt: session.expires_at };
}
/**
 * Runs a small housekeeping write on the read path without waiting for the write
 * lock: a read must never stall behind the worker's or another request's write.
 * When the file is busy the write is skipped; activity is then recorded on a
 * later request (it is kept to the minute, and the idle limit is 30 by default).
 */
export function withoutWaiting(db: DatabaseSync, write: () => unknown) {
  db.exec('PRAGMA busy_timeout=0');
  try { write(); }
  catch (error) { const code = (error as { errcode?: number }).errcode; if (code !== 5 && code !== 6) throw error; }
  finally { db.exec('PRAGMA busy_timeout=5000'); }
}
/** Ends every session of one account (sign out everywhere). Returns how many ended. */
export function revokeAllSessions(userId: string): number {
  return transaction(db => {
    const ended = Number(db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId).changes);
    recordEvent(db, userId, 'SESSIONS_REVOKED', { sessions: ended });
    return ended;
  });
}
/** Ends one session. Audited as a sign-out when a session was actually ended. */
export function logout(token?: string, audit = true) {
  if (!token || token.length > 200) return;
  transaction(db => {
    const row = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(tokenHash(token)) as { user_id: string } | undefined;
    if (!row) return;
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    if (audit) recordEvent(db, row.user_id, 'SIGN_OUT', {});
  });
}
