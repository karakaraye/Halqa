import { NextRequest } from 'next/server';
import { tokenHash, HttpError } from './auth';
import { transaction } from './db';

/**
 * Per-client request limits, counted in the database so they hold across
 * restarts and between processes. Sign-in keeps its own per-email limit in
 * auth.ts.
 */
export const RATE_LIMITS = {
  intake: { maximum: 120, windowMs: 60_000 },
  delivery: { maximum: 300, windowMs: 60_000 },
  password: { maximum: 10, windowMs: 15 * 60_000 },
  admin: { maximum: 60, windowMs: 60_000 },
  health: { maximum: 600, windowMs: 60_000 },
  /** Every sign-in attempt from one client, whatever the email, so one address cannot try many accounts. */
  signin: { maximum: 100, windowMs: 15 * 60_000 },
} as const;
export type RateLimitRule = keyof typeof RATE_LIMITS;

/**
 * How many reverse proxies in front of the app add to X-Forwarded-For and may be
 * trusted. HALQA_TRUST_PROXY unset or 0: none. 1 to 5: that many. Anything else
 * counts as none, so a typing mistake never widens trust.
 */
export function trustedProxyHops(value = process.env.HALQA_TRUST_PROXY): number {
  const hops = Number(value?.trim() || '0');
  return Number.isInteger(hops) && hops >= 1 && hops <= 5 ? hops : 0;
}

/**
 * The address of the client, used to key request limits and the sign-in limit.
 *
 * Without a trusted proxy, the Halqa web server (scripts/web.mjs) replaces
 * X-Forwarded-For with the address of the connection before the app sees it, so
 * whatever a caller sends is ignored. With HALQA_TRUST_PROXY=n, each trusted
 * proxy appends the address it saw, so the entry n places from the right is the
 * one the outermost trusted proxy recorded. Entries further left come from the
 * caller and are never used.
 */
export function clientAddress(request: NextRequest, hops = trustedProxyHops()) {
  const entries = (request.headers.get('x-forwarded-for') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const chosen = entries[entries.length - Math.max(1, hops)] ?? entries[0];
  return chosen?.slice(0, 200) || 'local';
}

/** Counts one request for this client and rule; throws 429 once the window is full. */
export function rateLimit(request: NextRequest, rule: RateLimitRule, now = Date.now()) {
  const { maximum, windowMs } = RATE_LIMITS[rule];
  // Only a hash of the address is stored.
  const key = tokenHash(`${rule}:${clientAddress(request)}`);
  const allowed = transaction(db => {
    const row = db.prepare('SELECT attempts,reset_at FROM rate_limits WHERE key=?').get(key) as { attempts: number; reset_at: number } | undefined;
    const current = row && row.reset_at > now ? row : undefined;
    if (current && current.attempts >= maximum) return false;
    db.prepare('INSERT OR REPLACE INTO rate_limits(key,attempts,reset_at) VALUES(?,?,?)').run(key, (current?.attempts ?? 0) + 1, current?.reset_at ?? now + windowMs);
    return true;
  });
  if (!allowed) throw new HttpError(429, 'Too many requests. Please try again shortly.');
}
