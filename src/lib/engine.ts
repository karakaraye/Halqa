import { isEvidenceClosure } from '@/domain/closure';
import { Case, Directory, Escalation, StepId, DelayReason, PathwayId, Role, Person } from '@/types/halqa';
import { PATHWAYS, URGENCY_FACTOR, HOUR, DAY, StepDef, PEOPLE, SPECIALIST_SERVICES, ACTING_AS } from './pathways';

let idCounter = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export const pathwayOf = (c: Case) => PATHWAYS[c.pathwayId];

export function currentStep(c: Case): StepDef | null {
  const p = pathwayOf(c);
  for (const s of p.steps) if (!c.steps[s.id]?.completedAt) return s;
  return null;
}

/** Person acting for a role when no signed-in user is supplied: the case team first, then the role default. */
export function actorFor(c: Case, role: Role): Person {
  if (role === 'SPECIALIST') {
    if (c.team.SPECIALIST) return c.team.SPECIALIST;
    const svc = SPECIALIST_SERVICES.find((x) => x.facility === c.referral?.facility) ?? SPECIALIST_SERVICES.find((x) => x.pathway === c.pathwayId);
    return (svc && PEOPLE[svc.specialist]) || ACTING_AS.SPECIALIST;
  }
  if (role === 'PCP') return c.team.PCP ?? ACTING_AS.PCP;
  if (role === 'NAVIGATOR') return c.team.NAVIGATOR ?? ACTING_AS.NAVIGATOR;
  return ACTING_AS[role];
}

export function isClosed(c: Case) {
  return c.closure?.status === 'CLOSED';
}

export function stepIndex(c: Case, id: StepId) {
  return pathwayOf(c).steps.findIndex((s) => s.id === id);
}

export function stepStart(c: Case, step: StepDef): number {
  const p = pathwayOf(c);
  const idx = p.steps.findIndex((s) => s.id === step.id);
  let start = c.issuedAt;
  for (let i = idx - 1; i >= 0; i--) {
    const t = c.steps[p.steps[i].id]?.completedAt;
    if (t) { start = t; break; }
  }
  const reset = c.clockResets[step.id];
  return reset && reset > start ? reset : start;
}

export function slaMs(c: Case, step: StepDef) {
  return step.slaHours * URGENCY_FACTOR[c.urgency] * HOUR;
}

export type SlaState = 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'CLOSED' | 'PENDING_APPROVAL';

export interface CaseStatus {
  step: StepDef | null;
  stepNo: number;
  totalSteps: number;
  start: number;
  dueAt: number;
  remainingMs: number;
  state: SlaState;
  ownerName: string;
  ownerDetail: string;
  unassigned: boolean;
  openEscalations: Escalation[];
  maxLevel: number;
}

export function stepOwner(c: Case, step: StepDef | null): { name: string; detail: string; unassigned: boolean } {
  if (!step) return { name: c.accountable?.name ?? '—', detail: 'Closed', unassigned: false };
  if (step.ownerRole === 'PATIENT') {
    const nav = c.team.NAVIGATOR;
    return {
      name: c.patient.name,
      detail: nav ? `Patient · chased by ${nav.name}` : 'Patient · no navigator assigned',
      unassigned: !nav,
    };
  }
  if (step.ownerRole === 'SPECIALIST') {
    if (c.team.SPECIALIST) return { name: c.team.SPECIALIST.name, detail: c.team.SPECIALIST.org, unassigned: false };
    if (c.referral && (c.referral.status === 'SENT')) return { name: `${c.referral.facility}`, detail: 'Waiting for the referral to be answered', unassigned: false };
    if (c.referral && (c.referral.status === 'REJECTED' || c.referral.status === 'INFO_REQUESTED') && c.team.PCP)
      return { name: c.team.PCP.name, detail: 'The referral came back and needs a new service', unassigned: false };
    return { name: 'Unassigned', detail: 'No receiving service chosen yet', unassigned: true };
  }
  const p = c.team[step.ownerRole as 'NAVIGATOR' | 'PCP'];
  if (p) return { name: p.name, detail: p.org, unassigned: false };
  return { name: 'Unassigned', detail: `Needs a ${step.ownerRole === 'PCP' ? 'physician' : 'navigator'}`, unassigned: true };
}

export function caseStatus(c: Case, now: number): CaseStatus {
  const p = pathwayOf(c);
  const step = currentStep(c);
  const openEscalations = c.escalations.filter((e) => !e.resolvedAt);
  const maxLevel = openEscalations.reduce((m, e) => Math.max(m, e.level), 0);
  const owner = stepOwner(c, step);
  if (!step || isClosed(c)) {
    return {
      step: null, stepNo: p.steps.length, totalSteps: p.steps.length, start: c.issuedAt, dueAt: 0,
      remainingMs: 0, state: 'CLOSED', ownerName: owner.name, ownerDetail: owner.detail, unassigned: false,
      openEscalations, maxLevel,
    };
  }
  const start = stepStart(c, step);
  const sla = slaMs(c, step);
  const dueAt = start + sla;
  const remainingMs = dueAt - now;
  let state: SlaState = remainingMs < 0 ? 'OVERDUE' : remainingMs < sla * 0.25 ? 'DUE_SOON' : 'ON_TRACK';
  if (c.closure?.status === 'PENDING_APPROVAL') state = 'PENDING_APPROVAL';
  return {
    step, stepNo: p.steps.findIndex((s) => s.id === step.id) + 1, totalSteps: p.steps.length,
    start, dueAt, remainingMs, state, ownerName: owner.name, ownerDetail: owner.detail,
    unassigned: owner.unassigned, openEscalations, maxLevel,
  };
}

// Work items: everything a person needs to do on a case.
export type ActionKind =
  | 'OVERDUE' | 'UNASSIGNED' | 'REJECTED' | 'ESCALATED' | 'CALLBACK' | 'LOW_UNDERSTANDING'
  | 'UNREACHABLE' | 'DUE_SOON' | 'TRANSFER_PENDING' | 'APPROVAL' | 'PATIENT_MESSAGE' | 'ECONSULT';

export interface ActionItem { kind: ActionKind; text: string; severity: 0 | 1 | 2 | 3 }

export function actionItems(c: Case, now: number): ActionItem[] {
  if (isClosed(c)) return [];
  const s = caseStatus(c, now);
  const out: ActionItem[] = [];
  if (c.closure?.status === 'PENDING_APPROVAL') out.push({ kind: 'APPROVAL', text: 'Closing without a test result is waiting for a second person to check it', severity: 2 });
  if (s.openEscalations.length) out.push({ kind: 'ESCALATED', text: s.maxLevel >= 2 ? 'Raised with the clinical lead' : 'An alert is open', severity: s.maxLevel >= 2 ? 3 : 2 });
  if (s.state === 'OVERDUE') out.push({ kind: 'OVERDUE', text: `${STEP_PHRASE[s.step!.id]} is ${plainDuration(-s.remainingMs)} late`, severity: 3 });
  if (s.unassigned) out.push({ kind: 'UNASSIGNED', text: 'No one is looking after this step', severity: 3 });
  if (c.referral && (c.referral.status === 'REJECTED' || c.referral.status === 'INFO_REQUESTED'))
    out.push({ kind: 'REJECTED', text: c.referral.status === 'REJECTED' ? `The referral was sent back: ${c.referral.rejectReason}` : 'The specialist asked for more information', severity: 2 });
  if (c.callbackRequestedAt && !c.callbackDoneAt) out.push({ kind: 'CALLBACK', text: 'Patient asked for a call back', severity: 2 });
  if (c.feedback && (!c.feedback.understoodQ1 || !c.feedback.understoodQ2 || c.feedback.confidence <= 2) &&
    !c.escalations.some((e) => e.ruleId === 'R6_LOW_UNDERSTANDING' && e.resolvedAt))
    out.push({ kind: 'LOW_UNDERSTANDING', text: 'Patient may not have understood the result', severity: 2 });
  const failed = c.notifications.filter((n) => n.status === 'FAILED' || n.status === 'NO_ANSWER').length;
  if (s.step?.id === 'NOTIFY' && failed > 0) out.push({ kind: 'UNREACHABLE', text: `Could not reach the patient (${tries(failed)})`, severity: failed >= 3 ? 3 : 2 });
  if (c.pendingTransfer) out.push({ kind: 'TRANSFER_PENDING', text: `Waiting for ${c.pendingTransfer.to.name} to take over this case`, severity: 1 });
  const lastPatientMsg = [...c.messages].reverse().find((m) => m.thread === 'PATIENT');
  if (lastPatientMsg && lastPatientMsg.fromRole === 'PATIENT') out.push({ kind: 'PATIENT_MESSAGE', text: 'The patient is waiting for a reply', severity: 1 });
  const lastEc = [...c.messages].reverse().find((m) => m.thread === 'ECONSULT');
  if (lastEc && lastEc.fromRole === 'PCP') out.push({ kind: 'ECONSULT', text: 'A question for the specialist is waiting for a reply', severity: 1 });
  if (s.state === 'DUE_SOON') out.push({ kind: 'DUE_SOON', text: `${STEP_PHRASE[s.step!.id]} is due in ${plainDuration(s.remainingMs)}`, severity: 1 });
  return out.sort((a, b) => b.severity - a.severity);
}

export function priorityScore(c: Case, now: number) {
  const items = actionItems(c, now);
  const sev = items.reduce((m, i) => Math.max(m, i.severity), 0);
  const urg = c.urgency === 'CRITICAL' ? 2 : c.urgency === 'ELEVATED' ? 1 : 0;
  const s = caseStatus(c, now);
  return sev * 1000 + urg * 100 + Math.max(0, Math.min(99, -s.remainingMs / HOUR));
}

/** Each step as an everyday activity, for sentences shown to staff. */
export const STEP_PHRASE: Record<StepId, string> = {
  NOTIFY: 'Talking to the patient',
  ACK: 'Checking the patient understood',
  CONSULT: 'The talk between doctor and patient',
  CONFIRM_TEST: 'The repeat test',
  REFER: 'Sending the referral',
  ACCEPT: 'The answer to the referral',
  BOOK: 'Booking the appointment',
  ATTEND: 'The test appointment',
  OUTCOME: 'Recording the test result',
  CARE_PLAN: 'Starting treatment or follow-up',
  CLOSE: 'Signing off the case',
};

export const LEAD_FALLBACK = 'Clinical lead';
const COORDINATION_LEAD = 'Care coordination lead';
const APPROVAL_TARGET_HOURS = 72;

/** Name of the network's clinical lead, who receives the serious alerts. */
export function leadName(directory?: Directory) {
  return directory?.people.find((p) => p.role === 'LEAD')?.name ?? LEAD_FALLBACK;
}

const tries = (n: number) => `${n} ${n === 1 ? 'try' : 'tries'}`;
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Checks one open case against the alert rules and returns any new alerts.
 * It only tells people that something needs attention. It never completes a
 * step or closes a case.
 */
export function runEngine(c: Case, now: number, directory?: Directory): { next: Case; created: Escalation[] } {
  if (isClosed(c) || c.historical) return { next: c, created: [] };
  const step = currentStep(c);
  if (!step) return { next: c, created: [] };
  const start = stepStart(c, step);
  const sla = slaMs(c, step);
  const owner = stepOwner(c, step);
  const lead = leadName(directory);
  const phrase = STEP_PHRASE[step.id];
  const created: Escalation[] = [];
  const has = (ruleId: string) => c.escalations.some((e) => e.ruleId === ruleId && e.stepId === step.id && e.at >= start);
  const add = (ruleId: string, level: 1 | 2 | 3, reason: string, to: string, at: number) => {
    if (has(ruleId) || created.some((e) => e.ruleId === ruleId)) return;
    created.push({ id: uid('esc'), at, level, ruleId, reason, to, stepId: step.id });
  };

  // A request to close early has its own deadline, separate from the step deadlines.
  const approvalDue = (c.closure?.signedAt ?? 0) + APPROVAL_TARGET_HOURS * HOUR;
  if (c.closure?.status === 'PENDING_APPROVAL' && now > approvalDue)
    add('R8_APPROVAL_OVERDUE', 2, 'Closing without a test result is waiting for a second person to check it', lead, approvalDue);

  if (now > start + sla)
    add('R1_OVERDUE', 1, `${phrase} is late. It should take no more than ${plainDuration(sla)}.`,
      owner.unassigned ? COORDINATION_LEAD : `${owner.name} and the ${lowerFirst(COORDINATION_LEAD)}`, start + sla);

  const critical = c.urgency === 'CRITICAL';
  if (now > start + 2 * sla || (critical && now > start + sla))
    add('R2_OVERDUE_2X', 2,
      critical && now <= start + 2 * sla
        ? `Urgent case: ${lowerFirst(phrase)} is late`
        : `${phrase} has taken more than twice the time allowed`,
      lead, critical ? start + sla : start + 2 * sla);

  if (owner.unassigned && now > start + 4 * HOUR)
    add('R3_UNASSIGNED', 1, 'No one is looking after this step', COORDINATION_LEAD, start + 4 * HOUR);

  if (step.id === 'NOTIFY') {
    const failed = c.notifications.filter((n) => n.status === 'FAILED' || n.status === 'NO_ANSWER');
    if (failed.length >= 3 || (critical && failed.length >= 1))
      add('R4_UNREACHABLE', 2, `Could not reach the patient (${tries(failed.length)})`, lead, failed[failed.length - 1].at);
  }

  if (!created.length) return { next: c, created };
  return {
    next: {
      ...c,
      escalations: [...c.escalations, ...created],
      audit: [...c.audit, ...created.map((e) => ({ at: e.at, actor: 'Halqa', action: `Alert sent to ${e.to}`, detail: e.reason, system: true }))],
    },
    created,
  };
}

// Formatting
export function fmtDuration(ms: number) {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / 60000))}m`;
  if (abs < 2 * DAY) return `${Math.round(abs / HOUR)}h`;
  return `${(abs / DAY).toFixed(abs < 10 * DAY ? 1 : 0)}d`;
}

/** A length of time in whole words: "40 minutes", "6 hours", "3 days". */
export function plainDuration(ms: number) {
  const abs = Math.abs(ms);
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (abs < HOUR) return count(Math.max(1, Math.round(abs / 60000)), 'minute');
  if (abs < 2 * DAY) return count(Math.round(abs / HOUR), 'hour');
  return count(Math.round(abs / DAY), 'day');
}

// Measures, worked out from the case records each time they are asked for.
export function median(xs: number[]) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const timeTo = (c: Case, id: StepId) => {
  const t = c.steps[id]?.completedAt;
  return t ? t - c.issuedAt : undefined;
};

export interface Metrics {
  total: number;
  active: number;
  closed: number;
  closedWithEvidencePct: number;
  medianHoursToNotify: number;
  medianHoursToAck: number;
  medianDaysToConsult: number;
  medianDaysToDiagnostic: number;
  medianDaysToCarePlan: number;
  referralAcceptPct: number;
  referralCompletionPct: number;
  attendancePct: number;
  slaCompliancePct: number;
  unresolved: number;
  unresolvedOverdue: number;
  unresolvedAgeBuckets: { label: string; n: number }[];
  delayReasons: { reason: DelayReason; n: number }[];
  understandingPct: number;
  avgConfidence: number;
  feedbackN: number;
  funnel: { id: StepId; label: string; n: number }[];
  byPathway: { id: PathwayId; name: string; n: number; closedPct: number; medianDaysDx: number; targetDays: number; withinTargetPct: number }[];
  stepSla: { id: StepId; label: string; pct: number; n: number }[];
  escalationsOpen: number;
  escalationsResolved: number;
  medianHoursEscalationResolve: number;
}

export function computeMetrics(cases: Case[], now: number, filter?: PathwayId | 'ALL'): Metrics {
  const cs = filter && filter !== 'ALL' ? cases.filter((c) => c.pathwayId === filter) : cases;
  const closed = cs.filter(isClosed);
  const active = cs.filter((c) => !isClosed(c));
  const hrs = (xs: (number | undefined)[]) => median(xs.filter((x): x is number => x !== undefined)) / HOUR;
  const days = (xs: (number | undefined)[]) => median(xs.filter((x): x is number => x !== undefined)) / DAY;

  const diagnosticStep = (c: Case): StepId => (c.pathwayId === 'DIABETES_HBA1C' ? 'CONFIRM_TEST' : 'ATTEND');

  const referred = cs.filter((c) => c.steps.REFER?.completedAt);
  const accepted = referred.filter((c) => c.steps.ACCEPT?.completedAt);
  const referralEligible = referred.filter((c) => c.steps.ATTEND?.completedAt || now - (c.steps.REFER?.completedAt ?? now) > 21 * DAY);
  const attendedOrDna =cs.filter((c) => c.steps.ATTEND?.completedAt || (c.appointment?.dnaCount ?? 0) > 0);
  const attendFirstTime = attendedOrDna.filter((c) => c.steps.ATTEND?.completedAt && (c.appointment?.dnaCount ?? 0) === 0);

  // Share of completed steps that met their time target.
  let met = 0, totalSteps = 0;
  const perStep: Record<string, { met: number; n: number; label: string }> = {};
  for (const c of cs) {
    for (const s of pathwayOf(c).steps) {
      const done = c.steps[s.id]?.completedAt;
      if (!done) continue;
      const start = stepStart(c, s);
      const ok = done - start <= slaMs(c, s);
      totalSteps++; if (ok) met++;
      const key = s.id;
      perStep[key] ??= { met: 0, n: 0, label: s.label.replace(/^(Colonoscopy|Core biopsy|Colposcopy) performed$/, 'Diagnostic test performed') };
      perStep[key].n++; if (ok) perStep[key].met++;
    }
  }

  const delayCounts: Partial<Record<DelayReason, number>> = {};
  for (const c of cs) for (const d of c.delayReasons) delayCounts[d.reason] = (delayCounts[d.reason] ?? 0) + 1;

  const fb = cs.filter((c) => c.feedback);
  const buckets = [
    { label: '< 7 days', max: 7 }, { label: '7–30 days', max: 30 }, { label: '30–60 days', max: 60 }, { label: '> 60 days', max: Infinity },
  ];
  const ageDays = active.map((c) => (now - c.issuedAt) / DAY);

  const funnelSteps: StepId[] = ['NOTIFY', 'ACK', 'CONSULT', 'REFER', 'ACCEPT', 'BOOK', 'ATTEND', 'OUTCOME', 'CARE_PLAN', 'CLOSE'];
  const funnelLabels: Record<string, string> = {
    NOTIFY: 'Notified', ACK: 'Understood', CONSULT: 'Consulted', REFER: 'Referred', ACCEPT: 'Accepted', BOOK: 'Booked',
    ATTEND: 'Diagnostic done', OUTCOME: 'Result known', CARE_PLAN: 'Care started', CLOSE: 'Closed',
  };
  const referralCases = cs.filter((c) => c.pathwayId !== 'DIABETES_HBA1C');

  const escAll = cs.flatMap((c) => c.escalations);
  const escResolved = escAll.filter((e) => e.resolvedAt);

  return {
    total: cs.length,
    active: active.length,
    closed: closed.length,
    closedWithEvidencePct: closed.length ? (100 * closed.filter(isEvidenceClosure).length) / closed.length : 0,
    medianHoursToNotify: hrs(cs.map((c) => timeTo(c, 'NOTIFY'))),
    medianHoursToAck: hrs(cs.map((c) => timeTo(c, 'ACK'))),
    medianDaysToConsult: days(cs.map((c) => timeTo(c, 'CONSULT'))),
    medianDaysToDiagnostic: days(cs.map((c) => timeTo(c, diagnosticStep(c)))),
    medianDaysToCarePlan: days(cs.map((c) => timeTo(c, 'CARE_PLAN'))),
    referralAcceptPct: referred.length ? (100 * accepted.length) / referred.length : 0,
    referralCompletionPct: referralEligible.length ? (100 * referralEligible.filter((c) => c.steps.ATTEND?.completedAt).length) / referralEligible.length : 0,
    attendancePct: attendedOrDna.length ? (100 * attendFirstTime.length) / attendedOrDna.length : 0,
    slaCompliancePct: totalSteps ? (100 * met) / totalSteps : 0,
    unresolved: active.length,
    unresolvedOverdue: active.filter((c) => caseStatus(c, now).state === 'OVERDUE').length,
    unresolvedAgeBuckets: buckets.map((b, i) => ({ label: b.label, n: ageDays.filter((d) => d < b.max && d >= (i ? buckets[i - 1].max : 0)).length })),
    delayReasons: (Object.entries(delayCounts) as [DelayReason, number][]).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    understandingPct: fb.length ? (100 * fb.filter((c) => c.feedback!.understoodQ1 && c.feedback!.understoodQ2).length) / fb.length : 0,
    avgConfidence: fb.length ? fb.reduce((s, c) => s + c.feedback!.confidence, 0) / fb.length : 0,
    feedbackN: fb.length,
    funnel: funnelSteps.map((id) => ({ id, label: funnelLabels[id], n: referralCases.filter((c) => c.steps[id]?.completedAt).length })),
    byPathway: (Object.keys(PATHWAYS) as PathwayId[]).map((id) => {
      const pc = cases.filter((c) => c.pathwayId === id);
      const dx = pc.map((c) => timeTo(c, diagnosticStep(c))).filter((x): x is number => x !== undefined);
      const target = PATHWAYS[id].targetDaysToDiagnosis;
      return {
        id, name: PATHWAYS[id].short, n: pc.length,
        closedPct: pc.length ? (100 * pc.filter(isClosed).length) / pc.length : 0,
        medianDaysDx: median(dx) / DAY,
        targetDays: target,
        withinTargetPct: dx.length ? (100 * dx.filter((x) => x <= target * DAY).length) / dx.length : 0,
      };
    }),
    stepSla: Object.entries(perStep).map(([id, v]) => ({ id: id as StepId, label: v.label, pct: (100 * v.met) / v.n, n: v.n })),
    escalationsOpen: escAll.filter((e) => !e.resolvedAt).length,
    escalationsResolved: escResolved.length,
    medianHoursEscalationResolve: median(escResolved.map((e) => e.resolvedAt! - e.at)) / HOUR,
  };
}

export const DELAY_LABEL: Record<DelayReason, string> = {
  UNREACHABLE: 'Could not reach the patient',
  DNA: 'Patient missed the appointment',
  REFERRAL_REJECTED: 'Referral was sent back',
  CAPACITY: 'No appointment available in time',
  PATIENT_DECLINED: 'Patient said no',
  PATIENT_TRAVEL: 'Patient is away',
  INFO_MISSING: 'Information was missing',
  LOW_UNDERSTANDING: 'Patient did not understand the result',
};
