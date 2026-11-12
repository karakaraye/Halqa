import { Case, Channel, Lang, Notification } from '@/types/halqa';

/** Name recorded against steps and audit entries written on a delivery report. */
export const MESSAGE_SERVICE = 'Message service';

export const CHANNEL_WORDS: Record<Channel, string> = {
  SMS: 'text message',
  WHATSAPP: 'WhatsApp',
  APP: 'app message',
  PHONE: 'phone',
  PORTAL: 'portal message',
};
export const LANGUAGE_NAME: Record<Lang, string> = { en: 'English', ar: 'Arabic', hi: 'Hindi', ur: 'Urdu' };

const REACHED_RULES = ['R4_UNREACHABLE', 'R1_OVERDUE', 'R2_OVERDUE_2X'];

/** The patient has been told: complete the first step and settle the alerts that chased it. */
export function patientReached(c: Case, now: number, by: string, note: string): Case {
  return {
    ...c,
    steps: c.steps.NOTIFY?.completedAt ? c.steps : { ...c.steps, NOTIFY: { completedAt: now, by, note } },
    escalations: c.escalations.map((e) =>
      !e.resolvedAt && REACHED_RULES.includes(e.ruleId) ? { ...e, resolvedAt: now, resolvedBy: by, resolution: 'Patient reached' } : e),
  };
}

/** A contact attempt did not get through. */
export function contactFailed(c: Case, now: number): Case {
  return { ...c, delayReasons: [...c.delayReasons, { at: now, reason: 'UNREACHABLE' }] };
}

/**
 * Template key of the first message. The text lives with the message service and
 * says only that there is news from the care team, with a link to sign in.
 * It never names the test or the result.
 */
export const RESULT_READY_TEMPLATE = 'result-ready';

export const inFlight = (n: Notification) => n.status === 'QUEUED' || n.status === 'SENT';

const messageId = () => `msg_${globalThis.crypto.randomUUID()}`;

/** Records a written message as waiting in the outbox. The patient is not yet told. */
export function queueMessage(c: Case, channel: Exclude<Channel, 'PHONE'>, now: number, by: string, note?: string, id = messageId()): Case {
  return {
    ...c,
    notifications: [...c.notifications, { id, at: now, channel, lang: c.patient.lang, status: 'QUEUED', by }],
    audit: [...c.audit, { at: now, actor: by, action: `Result message waiting to be sent by ${CHANNEL_WORDS[channel]} (${LANGUAGE_NAME[c.patient.lang]})`, detail: note }],
  };
}

/** Messages added between two versions of a case that still wait in the outbox. */
export function newlyQueued(before: Case | undefined, after: Case): Notification[] {
  const known = new Set((before?.notifications ?? []).map((n) => n.id));
  return after.notifications.filter((n) => n.id && n.status === 'QUEUED' && !known.has(n.id));
}

function setStatus(c: Case, id: string, status: Notification['status']): Case {
  return { ...c, notifications: c.notifications.map((n) => (n.id === id ? { ...n, status } : n)) };
}

/** The provider accepted the message. The patient has not necessarily received it yet. */
export function markSent(c: Case, notificationId: string): Case {
  const n = c.notifications.find((x) => x.id === notificationId);
  return n?.status === 'QUEUED' ? setStatus(c, notificationId, 'SENT') : c;
}

/**
 * Applies the final delivery report for a queued message. Delivered completes
 * the first step; failed records the attempt so the unreachable rule can count
 * it. A report for a message that already has a final status changes nothing.
 */
export function recordDelivery(c: Case, notificationId: string, outcome: 'DELIVERED' | 'FAILED', now: number, error?: string): Case {
  const n = c.notifications.find((x) => x.id === notificationId);
  if (!n) throw new Error('This case has no message with that identifier.');
  if (!inFlight(n)) return c;
  const channel = CHANNEL_WORDS[n.channel];
  let next = setStatus(c, notificationId, outcome);
  if (outcome === 'DELIVERED') {
    next = patientReached(next, now, MESSAGE_SERVICE, `Delivered by ${channel}`);
    return { ...next, audit: [...next.audit, { at: now, actor: MESSAGE_SERVICE, action: `Patient told by ${channel} (${LANGUAGE_NAME[n.lang]})`, system: true }] };
  }
  next = contactFailed(next, now);
  return { ...next, audit: [...next.audit, { at: now, actor: MESSAGE_SERVICE, action: `Message by ${channel} could not be delivered`, detail: error, system: true }] };
}
