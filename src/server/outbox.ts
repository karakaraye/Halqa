import { DatabaseSync } from 'node:sqlite';
import { Case, Notification } from '@/types/halqa';
import { RESULT_READY_TEMPLATE, newlyQueued, recordDelivery } from '@/domain/delivery';
import { runEngine } from '@/lib/engine';
import { testControlsEnabled } from './test-controls';

export type OutboxStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
export interface OutboxRow {
  id: string; case_id: string; channel: string; lang: string; to_phone: string; template: string;
  status: OutboxStatus; attempts: number; last_error: string | null; created_at: number; updated_at: number; next_attempt_at: number;
}

/** Adds an outbox row for every message the action queued. Runs inside the action's transaction. */
export function enqueueMessages(db: DatabaseSync, before: Case | undefined, after: Case, now = Date.now()): Notification[] {
  const queued = newlyQueued(before, after);
  for (const n of queued) {
    db.prepare("INSERT INTO outbox(id,case_id,channel,lang,to_phone,template,status,attempts,created_at,updated_at,next_attempt_at) VALUES(?,?,?,?,?,?,'QUEUED',0,?,?,0)")
      .run(n.id!, after.id, n.channel, n.lang, after.patient.phone, RESULT_READY_TEMPLATE, now, now);
  }
  return queued;
}

/**
 * Browser tests move the workspace clock and have no message service to call
 * back. Only for them (test controls on and no webhook configured)
 * a queued message is settled at once, as before the outbox existed: delivered
 * unless the case records the number as not working.
 */
export function settlesMessagesInstantlyForBrowserTests() {
  return testControlsEnabled() && !process.env.HALQA_MESSAGE_WEBHOOK_URL;
}
export function settleInstantlyForBrowserTests(db: DatabaseSync, c: Case, queued: Notification[], now: number): Case {
  let next = c;
  for (const n of queued) {
    const outcome = c.patient.phoneReachable ? 'DELIVERED' : 'FAILED';
    next = recordDelivery(next, n.id!, outcome, now, outcome === 'FAILED' ? 'The number on record is not working.' : undefined);
    db.prepare('UPDATE outbox SET status=?,updated_at=? WHERE id=?').run(outcome, Date.now(), n.id!);
  }
  return runEngine(next, now).next;
}
