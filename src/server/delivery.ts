import { z } from 'zod';
import { markSent, recordDelivery } from '@/domain/delivery';
import { database, transaction } from './db';
import { HttpError } from './auth';
import { OutboxRow } from './outbox';
import { updateCaseFromService } from './workspace';

export const DELIVERY_POLICY = { maxAttempts: 5, timeoutMs: 5_000, firstRetryMs: 30_000, longestWaitMs: 3_600_000, batch: 20 } as const;
/** Audit user id for changes made on behalf of the message service. */
export const MESSAGE_SERVICE_USER = 'message-service';

export const deliverySchema = z.object({
  outboxId: z.string().min(1).max(100),
  status: z.enum(['DELIVERED', 'FAILED']),
  error: z.string().trim().max(500).optional(),
}).strict();

/** Wait before the next attempt after `attempts` failed ones: 30 s, 1, 2, 4 minutes, at most an hour. */
export const retryDelay = (attempts: number) => Math.min(DELIVERY_POLICY.longestWaitMs, DELIVERY_POLICY.firstRetryMs * 2 ** (attempts - 1));

function settle(outboxId: string, status: 'DELIVERED' | 'FAILED', error: string | undefined, now: number) {
  return transaction(db => {
    const row = db.prepare('SELECT * FROM outbox WHERE id=?').get(outboxId) as OutboxRow | undefined;
    if (!row) throw new HttpError(404, 'No message with that identifier.');
    if (row.status === 'DELIVERED' || row.status === 'FAILED') {
      // A repeated report is accepted and changes nothing; a contradicting one is refused.
      if (row.status !== status) throw new HttpError(409, 'This message already has a final delivery report.');
      return row.status;
    }
    db.prepare('UPDATE outbox SET status=?,last_error=?,updated_at=? WHERE id=?').run(status, status === 'FAILED' ? (error || row.last_error || 'Not delivered') : null, now, outboxId);
    updateCaseFromService(db, row.case_id, MESSAGE_SERVICE_USER, (c, at) => recordDelivery(c, outboxId, status, at, status === 'FAILED' ? (error || undefined) : undefined));
    return status;
  });
}

/** Delivery report from the message service: DELIVERED tells the patient, FAILED counts as a failed attempt. */
export function receiveDelivery(payload: unknown, now = Date.now()) {
  const parsed = deliverySchema.safeParse(payload);
  if (!parsed.success) throw new HttpError(422, 'The delivery report is missing information.');
  return settle(parsed.data.outboxId, parsed.data.status, parsed.data.error, now);
}

/**
 * The message address must use https, because the post carries the patient's
 * phone number and the bearer token. Plain http is accepted only for this
 * machine (localhost, 127.0.0.1, ::1), where nothing crosses a network. An
 * address with a user name or password in it is refused so no secret sits in a URL.
 */
export function webhookAddressProblem(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return 'The message address is not a valid web address.'; }
  if (url.username || url.password) return 'The message address must not contain a user name or password.';
  if (url.protocol === 'https:') return undefined;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && loopback) return undefined;
  return 'The message address must use https.';
}
export class WebhookAddressRefused extends Error { constructor(message: string) { super(message); this.name = 'WebhookAddressRefused'; } }

let running = false;
/**
 * Hands queued messages to the message service. Each attempt is recorded before
 * the request, so a restart never sends one twice without counting it; the
 * outbox id is sent as the idempotency key. After the last failed attempt the
 * message is marked FAILED. With no webhook configured nothing is sent.
 */
export async function deliverPending(now = Date.now()) {
  const url = process.env.HALQA_MESSAGE_WEBHOOK_URL;
  const token = process.env.HALQA_MESSAGE_WEBHOOK_TOKEN;
  if (!url || !token || running) return { attempted: 0 };
  // Nothing is sent to an address that would expose the phone number or the token; messages stay queued.
  const addressProblem = webhookAddressProblem(url);
  if (addressProblem) throw new WebhookAddressRefused(addressProblem);
  running = true;
  let attempted = 0;
  try {
    const db = database();
    const rows = db.prepare("SELECT * FROM outbox WHERE status='QUEUED' AND attempts<? AND next_attempt_at<=? ORDER BY created_at LIMIT ?")
      .all(DELIVERY_POLICY.maxAttempts, now, DELIVERY_POLICY.batch) as unknown as OutboxRow[];
    for (const row of rows) {
      const attempts = row.attempts + 1;
      const claimed = db.prepare("UPDATE outbox SET attempts=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='QUEUED' AND attempts=?")
        .run(attempts, now + retryDelay(attempts), now, row.id, row.attempts);
      if (!claimed.changes) continue;
      attempted++;
      let problem: string | undefined;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': row.id },
          // No diagnosis, name or result: the template text is generic and the patient signs in to read more.
          body: JSON.stringify({ outboxId: row.id, channel: row.channel, template: row.template, language: row.lang, phone: row.to_phone, link: process.env.HALQA_ORIGIN || null }),
          signal: AbortSignal.timeout(DELIVERY_POLICY.timeoutMs),
          redirect: 'error',
        });
        await response.body?.cancel();
        if (!response.ok) problem = `The message service answered ${response.status}.`;
      } catch (error) {
        problem = error instanceof Error && error.name === 'TimeoutError' ? 'The message service did not answer in time.' : 'Could not reach the message service.';
      }
      if (!problem) {
        transaction(tx => {
          const updated = tx.prepare("UPDATE outbox SET status='SENT',last_error=NULL,updated_at=? WHERE id=? AND status='QUEUED'").run(now, row.id);
          if (updated.changes) updateCaseFromService(tx, row.case_id, MESSAGE_SERVICE_USER, c => markSent(c, row.id));
        });
      } else if (attempts >= DELIVERY_POLICY.maxAttempts) {
        settle(row.id, 'FAILED', `${problem} Gave up after ${attempts} tries.`, now);
      } else {
        db.prepare("UPDATE outbox SET last_error=?,updated_at=? WHERE id=? AND status='QUEUED'").run(problem, now, row.id);
      }
    }
    // Rows whose last attempt was interrupted (for example by a restart) are closed off here.
    const exhausted = db.prepare("SELECT id FROM outbox WHERE status='QUEUED' AND attempts>=? AND next_attempt_at<=?").all(DELIVERY_POLICY.maxAttempts, now) as { id: string }[];
    for (const row of exhausted) settle(row.id, 'FAILED', 'Gave up after the last try.', now);
  } finally { running = false; }
  return { attempted };
}
