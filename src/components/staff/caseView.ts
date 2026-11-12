/**
 * Plain-language view helpers shared by My work and the case page.
 * They read the engine; they never decide clinical rules (the server does).
 */
import type { Case, Role, StepId } from '@/types/halqa';
import { actionItems, caseStatus, currentStep, isClosed, pathwayOf } from '@/lib/engine';
import { HOUR, DAY } from '@/lib/pathways';
import { fmtDay } from '@/lib/time';
import type { Tone } from '@/components/design/primitives';

export type WorkStatus = 'NOW' | 'LATE' | 'DUE_SOON' | 'ON_TRACK' | 'WAITING' | 'DONE';

export const STATUS_LABEL: Record<WorkStatus, string> = {
  NOW: 'Needs you now',
  LATE: 'Late',
  DUE_SOON: 'Due soon',
  ON_TRACK: 'On track',
  WAITING: 'Waiting for others',
  DONE: 'Done',
};

export const STATUS_TONE: Record<WorkStatus, Tone> = {
  NOW: 'rose',
  LATE: 'rose',
  DUE_SOON: 'amber',
  ON_TRACK: 'teal',
  WAITING: 'sky',
  DONE: 'emerald',
};

export const LANG_NAME: Record<string, string> = { en: 'English', ar: 'Arabic', hi: 'Hindi', ur: 'Urdu' };

export const CHANNEL_NAME: Record<string, string> = {
  SMS: 'Text message',
  WHATSAPP: 'WhatsApp',
  APP: 'Halqa app',
  PHONE: 'Phone call',
  PORTAL: 'Patient portal',
};

export const TEAM_ROLE_LABEL: Record<string, string> = {
  NAVIGATOR: 'Care navigator',
  PCP: 'Doctor',
  SPECIALIST: 'Specialist',
  LEAD: 'Clinic lead',
  PATIENT: 'Patient',
};

export const firstName = (name: string) => {
  const words = name.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '').trim().split(/\s+/);
  return words[0] || name;
};

export const pronoun = (c: Case) => (c.patient.sex === 'F'
  ? { subj: 'she', obj: 'her', poss: 'her' }
  : { subj: 'he', obj: 'him', poss: 'his' });

/** Plain words for a duration, e.g. "45 minutes", "2 hours", "3 days". */
export function plainDuration(ms: number) {
  const abs = Math.abs(ms);
  if (abs < HOUR) { const n = Math.max(1, Math.round(abs / 60000)); return `${n} minute${n === 1 ? '' : 's'}`; }
  if (abs < DAY) { const n = Math.round(abs / HOUR); return `${n} hour${n === 1 ? '' : 's'}`; }
  const n = Math.round(abs / DAY);
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** The current step needs a referral re-sent because the service sent it back. */
export function referralReturned(c: Case) {
  return !!c.referral && (c.referral.status === 'REJECTED' || c.referral.status === 'INFO_REQUESTED');
}

/**
 * The written message still on its way to the patient, if any. While one is in
 * flight the server refuses another written message (409) until the delivery
 * report arrives; a phone call is still allowed.
 */
export function messageInFlight(c: Case): Case['notifications'][number] | undefined {
  return c.notifications.find((n) => n.channel !== 'PHONE' && (n.status === 'QUEUED' || n.status === 'SENT'));
}

/** Plain wording for a written message that has not been confirmed as delivered. */
export function messageStatusText(n: Case['notifications'][number]): string {
  return n.status === 'SENT' ? 'Message sent, waiting for delivery confirmation.' : 'Message is waiting to be delivered.';
}

/** Can this role do the current step's work from the case page? Mirrors src/server/permissions.ts. */
export function canActOnStep(c: Case, role: Role | string, now: number): boolean {
  if (isClosed(c) || c.closure?.status === 'PENDING_APPROVAL') return false;
  const step = currentStep(c);
  if (!step) return false;
  switch (step.id) {
    case 'NOTIFY':
    case 'ACK':
      return role === 'NAVIGATOR' || role === 'PCP';
    case 'CONSULT':
    case 'CONFIRM_TEST':
    case 'REFER':
      return role === 'PCP';
    case 'ACCEPT':
      return role === 'PCP' && referralReturned(c);
    case 'BOOK':
      return c.referral?.status === 'ACCEPTED' && ['NAVIGATOR', 'PCP', 'SPECIALIST'].includes(role);
    case 'ATTEND':
      return !!c.appointment && c.appointment.at <= now && ['NAVIGATOR', 'PCP', 'SPECIALIST'].includes(role);
    case 'OUTCOME':
    case 'CARE_PLAN':
      return role === step.ownerRole && (role === 'PCP' || role === 'SPECIALIST');
    case 'CLOSE':
      return role === 'PCP' || role === 'SPECIALIST';
    default:
      return false;
  }
}

/** A call back the patient asked for, which navigators and doctors can do. */
export function callbackOpen(c: Case) {
  return !!c.callbackRequestedAt && !c.callbackDoneAt;
}

const PERSONAL_KINDS = ['CALLBACK', 'LOW_UNDERSTANDING', 'REJECTED', 'UNREACHABLE', 'ESCALATED', 'UNASSIGNED'];

export function workStatus(c: Case, role: Role | string, now: number): WorkStatus {
  if (isClosed(c)) return 'DONE';
  if (c.closure?.status === 'PENDING_APPROVAL') return 'WAITING';
  const mine = canActOnStep(c, role, now) || ((role === 'NAVIGATOR' || role === 'PCP') && callbackOpen(c));
  if (!mine) return 'WAITING';
  const st = caseStatus(c, now);
  if (st.state === 'OVERDUE') return 'LATE';
  const items = actionItems(c, now);
  if (items.some((i) => i.severity >= 3 || (i.severity >= 2 && PERSONAL_KINDS.includes(i.kind)))) return 'NOW';
  if (st.state === 'DUE_SOON') return 'DUE_SOON';
  return 'ON_TRACK';
}

/** Plain label for a pathway step in the timeline. */
export function stepLabel(c: Case, id: StepId, fallback: string) {
  const test = pathwayOf(c).diagnosticTest.toLowerCase();
  const map: Partial<Record<StepId, string>> = {
    NOTIFY: 'Result shared',
    ACK: 'Quick check',
    CONSULT: 'Talk with the doctor',
    CONFIRM_TEST: 'Repeat test done',
    REFER: 'Referral to a specialist',
    ACCEPT: 'Specialist accepted the referral',
    BOOK: 'Specialist appointment',
    ATTEND: `Test done (${test})`,
    OUTCOME: 'Test result written down',
    CARE_PLAN: 'Plan agreed',
    CLOSE: 'Case closed',
  };
  return map[id] ?? fallback;
}

/** The next thing to do on this case, written as a plain instruction. */
export function nextActionText(c: Case, role: Role | string, now: number): string {
  if (isClosed(c)) return 'Case closed';
  if (c.closure?.status === 'PENDING_APPROVAL') return 'Waiting for the clinic lead to check the closure';
  const first = firstName(c.patient.name);
  const p = pronoun(c);
  if ((role === 'NAVIGATOR' || role === 'PCP') && callbackOpen(c)) return `Call ${first} back`;
  const step = currentStep(c);
  if (!step) return 'Close the case';
  switch (step.id) {
    case 'NOTIFY': return `Talk to ${first} about ${p.poss} result`;
    case 'ACK': return `Call ${first} to check ${p.subj} understood`;
    case 'CONSULT': return role === 'PCP' ? `See ${first} and agree the plan` : `Waiting for the doctor to see ${first}`;
    case 'CONFIRM_TEST': return role === 'PCP' ? 'Record the repeat test' : 'Waiting for the repeat test';
    case 'REFER': return role === 'PCP' ? 'Send a referral' : 'Waiting for the doctor to send a referral';
    case 'ACCEPT':
      if (referralReturned(c)) return role === 'PCP' ? 'Send the referral again' : 'Waiting for the doctor to send the referral again';
      return 'Waiting for the specialist to accept';
    case 'BOOK': return c.referral?.status === 'ACCEPTED' ? 'Book the specialist appointment' : 'Waiting for the specialist to accept';
    case 'ATTEND':
      if (c.appointment && c.appointment.at > now) return `Waiting for ${first}'s appointment`;
      return `Check ${first} went to the test`;
    case 'OUTCOME': return role === step.ownerRole ? 'Record the test result' : 'Waiting for the test result';
    case 'CARE_PLAN': return role === step.ownerRole ? 'Write the care plan' : 'Waiting for the care plan';
    case 'CLOSE': return role === 'PCP' || role === 'SPECIALIST' ? 'Close the case' : 'Waiting for the doctor to close the case';
    default: return step.label;
  }
}

/** One short line about timing for the list row. */
export function dueLine(c: Case, status: WorkStatus, now: number): string {
  if (status === 'DONE') return c.closure?.signedAt ? `Closed ${fmtDay(c.closure.signedAt)}` : 'Closed';
  if (status === 'WAITING') {
    if (c.closure?.status === 'PENDING_APPROVAL') return `Sent ${plainDuration(now - c.closure.signedAt)} ago`;
    if (c.referral?.status === 'SENT') return `Sent ${plainDuration(now - c.referral.sentAt)} ago`;
    if (c.appointment && c.appointment.at > now) return `Appointment in ${plainDuration(c.appointment.at - now)}`;
  }
  const st = caseStatus(c, now);
  if (st.state === 'CLOSED') return '';
  if (st.remainingMs < 0) return `${plainDuration(-st.remainingMs)} late`;
  return `Due in ${plainDuration(st.remainingMs)}`;
}
