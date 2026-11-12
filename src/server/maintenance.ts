import { transaction } from './db';
import { sessionIdleMs } from './auth';

/** Request receipts are kept this long so a repeated request is still recognised. */
export const RECEIPT_KEEP_MS = 30 * 24 * 3600_000;

export interface CleanupResult { sessions: number; receipts: number; rateLimits: number; loginLimits: number }

/**
 * Deletes what is no longer needed, in one transaction: sessions past their
 * expiry or idle for longer than the idle limit, receipts older than 30 days,
 * and request-limit rows past their reset time (request limits and sign-in
 * limits). The worker runs it every cycle.
 */
export function cleanup(now = Date.now()): CleanupResult {
  return transaction((db) => ({
    sessions: Number(db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<=?').run(now, now - sessionIdleMs()).changes),
    receipts: Number(db.prepare('DELETE FROM receipts WHERE created_at<?').run(now - RECEIPT_KEEP_MS).changes),
    rateLimits: Number(db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(now).changes),
    loginLimits: Number(db.prepare('DELETE FROM login_limits WHERE reset_at<=?').run(now).changes),
  }));
}
