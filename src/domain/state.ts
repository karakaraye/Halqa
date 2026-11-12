import { Case, Channel, Closure, DelayReason, Directory, Lang, Role, StepId, Toast, Escalation, Person } from '@/types/halqa';
import { seedCases, SEED_START, makeIncoming } from '@/lib/seed';
import { runEngine, uid, pathwayOf, actorFor, LEAD_FALLBACK, DELAY_LABEL } from '@/lib/engine';
import { HOUR } from '@/lib/pathways';
import { answersFor, findPerson, leadOf, servicesAt, servicesFor, staffMember } from './directory';
import { scoreTeachBack, TeachBackAnswers } from './teachback';
import { assertClosure, assertApproval } from './closure';
import { queueMessage } from './delivery';

export type View = 'command' | 'specialist' | 'patient' | 'impact' | 'governance' | 'accounts';

export interface State {
  actor?: Person;
  version: number;
  now: number;
  cases: Case[];
  role: Role;
  view: View;
  selectedId: string | null;
  patientCaseId: string;
  toasts: Toast[];
  playing: boolean;
  ingestSeq: number;
  /**
   * Staff and receiving services of the network. The server always sets it from
   * the database; only pure domain tests leave it out.
   */
  directory?: Directory;
}

const VERSION = 3;

export function initialState(): State {
  return {
    version: VERSION,
    now: SEED_START,
    cases: runAll(seedCases(), SEED_START).cases,
    role: 'NAVIGATOR',
    view: 'command',
    selectedId: null,
    patientCaseId: 'HQ-1003',
    toasts: [],
    playing: false,
    ingestSeq: 0,
  };
}

function runAll(cases: Case[], now: number) {
  const created: { c: Case; e: Escalation }[] = [];
  const next = cases.map((c) => {
    const r = runEngine(c, now);
    r.created.forEach((e) => created.push({ c: r.next, e }));
    return r.next;
  });
  return { cases: next, created };
}

export type Action =
  | { type: 'TICK'; hours: number }
  | { type: 'SET_PLAYING'; on: boolean }
  | { type: 'RESET' }
  | { type: 'LOAD'; state: State }
  | { type: 'INGEST' }
  | { type: 'SELECT'; id: string | null }
  | { type: 'VIEW'; view: View }
  | { type: 'ROLE'; role: Role }
  | { type: 'PATIENT_CASE'; id: string }
  | { type: 'DISMISS_TOAST'; id: string }
  | { type: 'NOTIFY'; id: string; channel: Channel; phoneOutcome?: 'REACHED' | 'NO_ANSWER'; note?: string }
  /** answers are the keys of the choices the patient picked; the server scores them (src/domain/teachback.ts). */
  | { type: 'PATIENT_ACK'; id: string; answers: TeachBackAnswers; confidence: number; lang: Lang }
  | { type: 'STAFF_ACK'; id: string; note: string }
  | { type: 'CALLBACK_REQUEST'; id: string }
  | { type: 'CALLBACK_DONE'; id: string; note: string }
  | { type: 'INTERPRETER'; id: string; on: boolean }
  | { type: 'MESSAGE'; id: string; thread: 'ECONSULT' | 'PATIENT'; text: string; asPatient?: boolean }
  | { type: 'COMPLETE_STEP'; id: string; step: StepId; note: string; outcomeCategory?: Case['outcomeCategory'] }
  | { type: 'SEND_REFERRAL'; id: string; facility: string; priority: 'URGENT' | 'SOON' | 'ROUTINE'; note: string }
  | { type: 'REFERRAL_RESPOND'; id: string; decision: 'ACCEPT' | 'REJECT' | 'INFO'; reason?: string }
  | { type: 'BOOK'; id: string; at: number; location: string; byPatient?: boolean }
  | { type: 'DNA'; id: string; note: string }
  | { type: 'ASSIGN'; id: string; role: 'NAVIGATOR' | 'PCP' | 'SPECIALIST'; personId: string }
  | { type: 'REQUEST_TRANSFER'; id: string; personId: string; reason: string }
  | { type: 'TRANSFER_DECISION'; id: string; accept: boolean }
  | { type: 'RESOLVE_ESC'; id: string; escId: string; note: string }
  | { type: 'CLOSE_CASE'; id: string; closure: Omit<Closure, 'signedAt' | 'status' | 'signedBy' | 'signedLicence'> }
  | { type: 'APPROVE_CLOSURE'; id: string; approve: boolean; note: string }
  | { type: 'DELAY'; id: string; reason: DelayReason; note?: string };

function toast(s: State, tone: Toast['tone'], text: string, caseId?: string): Toast[] {
  return [...s.toasts, { id: uid('t'), at: s.now, tone, text, caseId }].slice(-5);
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'LOAD': return { ...a.state, playing: false, toasts: [] };
    case 'RESET': return initialState();
    case 'SET_PLAYING': return { ...s, playing: a.on };
    case 'SELECT': return { ...s, selectedId: a.id };
    case 'VIEW': return { ...s, view: a.view };
    case 'ROLE': return { ...s, role: a.role };
    case 'PATIENT_CASE': return { ...s, patientCaseId: a.id };
    case 'DISMISS_TOAST': return { ...s, toasts: s.toasts.filter((x) => x.id !== a.id) };
    case 'TICK': {
      const now = s.now + a.hours * HOUR;
      const { cases, created } = runAll(s.cases, now);
      let toasts = s.toasts;
      for (const { c, e } of created.slice(0, 4))
        toasts = [...toasts, { id: uid('t'), at: now, tone: e.level >= 2 ? 'danger' : 'warn', text: `${c.id} ${c.patient.name}: ${e.reason}`, caseId: c.id } as Toast].slice(-5);
      return { ...s, now, cases, toasts };
    }
    case 'INGEST': {
      const c0 = makeIncoming(s.ingestSeq, s.now, s.ingestSeq + 1);
      let c = c0;
      const critical = c.urgency === 'CRITICAL';
      if (!critical) {
        // Low-friction default: auto-send a privacy-safe message in the patient's language
        const ch = c.patient.preferredChannel === 'PHONE' ? 'SMS' : c.patient.preferredChannel;
        c = {
          ...c,
          notifications: [{ at: s.now + 2 * 60_000, channel: ch, lang: c.patient.lang, status: 'DELIVERED', by: 'Halqa messaging' }],
          steps: { NOTIFY: { completedAt: s.now + 2 * 60_000, by: 'Halqa messaging', note: `${ch} delivered (${c.patient.lang.toUpperCase()})` } },
          audit: [...c.audit, { at: s.now + 2 * 60_000, actor: 'Halqa messaging', action: `Result notice sent by ${ch} in ${c.patient.lang.toUpperCase()}`, detail: 'The message does not name the test or the result. It has a sign-in link.', system: true }],
        };
      } else {
        c = { ...c, audit: [...c.audit, { at: s.now + 60_000, actor: 'Halqa routing', action: 'Urgent result: the written message is held until someone phones the patient', detail: `A task was created for ${c.team.NAVIGATOR?.name}`, system: true }] };
      }
      return {
        ...s, cases: [c, ...s.cases], ingestSeq: s.ingestSeq + 1, selectedId: c.id, patientCaseId: c.id,
        toasts: toast(s, critical ? 'danger' : 'info', `New ${critical ? 'CRITICAL ' : ''}result: ${c.id} ${c.patient.name} — ${c.resultCode}. Routed to ${c.team.NAVIGATOR?.name} & ${c.team.PCP?.name}.`, c.id),
      };
    }
  }
  // Case-level actions
  const id = (a as { id: string }).id;
  const idx = s.cases.findIndex((c) => c.id === id);
  if (idx < 0) return s;
  const before = s.cases[idx];
  const res = caseReducer(before, a, s);
  if (!res) return s;
  const engine = runEngine(res.c, s.now, s.directory);
  const cases = [...s.cases];
  cases[idx] = engine.next;
  let toasts = s.toasts;
  if (res.toast) toasts = toast(s, res.toast.tone, res.toast.text, id);
  return { ...s, cases, toasts };
}

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

function caseReducer(c: Case, a: Action, s: State): { c: Case; toast?: { tone: Toast['tone']; text: string } } | null {
  const now = s.now;
  const actor = s.actor ?? actorFor(c, s.role);
  const log = (x: Case, action: string, detail?: string, by = actor.name): Case => ({ ...x, audit: [...x.audit, { at: now, actor: by, action, detail }] });
  const complete = (x: Case, step: StepId, note: string, by = actor.name): Case => ({ ...x, steps: { ...x.steps, [step]: { completedAt: now, by, note } } });
  const resolveRule = (x: Case, ruleIds: string[], note: string): Case => ({
    ...x, escalations: x.escalations.map((e) => (!e.resolvedAt && ruleIds.includes(e.ruleId) ? { ...e, resolvedAt: now, resolvedBy: actor.name, resolution: note } : e)),
  });

  switch (a.type) {
    case 'NOTIFY': {
      if (a.channel !== 'PHONE') {
        // Written messages go through the outbox. The step completes only when the
        // message service reports the message as delivered.
        const queued = queueMessage(c, a.channel, now, actor.name, a.note);
        return { c: queued, toast: { tone: 'info', text: `Message to ${c.patient.name} is waiting to be delivered` } };
      }
      // A phone call: the person who made it reports the outcome.
      const status = a.phoneOutcome ?? 'REACHED';
      let x: Case = { ...c, notifications: [...c.notifications, { at: now, channel: a.channel, lang: c.patient.lang, status, by: actor.name }] };
      const ok = status === 'REACHED';
      x = log(x, ok ? `Patient notified by ${a.channel} (${c.patient.lang.toUpperCase()})` : `${a.channel} attempt failed (${status.replace('_', ' ').toLowerCase()})`, a.note);
      if (ok) {
        x = complete(x, 'NOTIFY', a.note || `${a.channel} ${status.toLowerCase()}`);
        x = resolveRule(x, ['R4_UNREACHABLE', 'R1_OVERDUE', 'R2_OVERDUE_2X'], 'Patient reached');
        if (a.channel === 'PHONE' && c.patient.phoneReachable === false) x = { ...x, patient: { ...x.patient, phoneReachable: true } };
      } else x = { ...x, delayReasons: [...x.delayReasons, { at: now, reason: 'UNREACHABLE' }] };
      return { c: x, toast: ok ? { tone: 'success', text: `${c.patient.name} notified by ${a.channel}` } : { tone: 'warn', text: `Could not reach ${c.patient.name} — attempt logged` } };
    }
    case 'PATIENT_ACK': {
      const { understoodQ1, understoodQ2 } = scoreTeachBack(a.answers);
      const score = Number(understoodQ1) + Number(understoodQ2);
      const good = understoodQ1 && understoodQ2 && a.confidence >= 3;
      let x: Case = { ...c, feedback: { at: now, understoodQ1, understoodQ2, confidence: a.confidence, lang: a.lang } };
      x = log(x, `Patient answered the quick check (${score} of 2 right, confidence ${a.confidence} out of 5)`, good ? 'Understanding confirmed in the app' : 'Marked for a call from the navigator', c.patient.name);
      if (good) x = complete(x, 'ACK', `Quick check passed (confidence ${a.confidence} out of 5)`, c.patient.name);
      else x = {
        ...x,
        escalations: [...x.escalations, { id: uid('esc'), at: now, level: 1, ruleId: 'R6_LOW_UNDERSTANDING', reason: 'The patient may not have understood the result', to: c.team.NAVIGATOR?.name ?? 'The navigator', stepId: 'ACK' }],
        delayReasons: [...x.delayReasons, { at: now, reason: 'LOW_UNDERSTANDING' }],
      };
      return { c: x, toast: good ? { tone: 'success', text: `${c.patient.name} confirmed understanding (${a.confidence}/5 confidence)` } : { tone: 'warn', text: `${c.patient.name}: low understanding — navigator call task created` } };
    }
    case 'STAFF_ACK': {
      let x = complete(c, 'ACK', a.note);
      x = resolveRule(x, ['R6_LOW_UNDERSTANDING', 'R1_OVERDUE'], a.note);
      if (c.callbackRequestedAt && !c.callbackDoneAt) x = { ...x, callbackDoneAt: now };
      return { c: log(x, 'Understanding confirmed by phone', a.note), toast: { tone: 'success', text: `Understanding confirmed for ${c.patient.name}` } };
    }
    case 'CALLBACK_REQUEST':
      return { c: log({ ...c, callbackRequestedAt: now, callbackDoneAt: undefined }, 'Patient requested a call back', undefined, c.patient.name), toast: { tone: 'info', text: `${c.patient.name} requested a call back` } };
    case 'CALLBACK_DONE':
      return { c: log(resolveRule({ ...c, callbackDoneAt: now }, ['R6_LOW_UNDERSTANDING'], a.note), 'Call back completed', a.note) };
    case 'INTERPRETER':
      return { c: log({ ...c, patient: { ...c.patient, needsInterpreter: a.on } }, a.on ? 'Interpreter requested' : 'Interpreter request removed', undefined, a.on ? c.patient.name : actor.name) };
    case 'MESSAGE': {
      const from = a.asPatient ? c.patient.name : actor.name;
      const fromRole: Role = a.asPatient ? 'PATIENT' : s.role;
      const x: Case = { ...c, messages: [...c.messages, { id: uid('m'), at: now, thread: a.thread, from, fromRole, text: a.text }] };
      return {
        c: log(x, a.thread === 'ECONSULT' ? 'Message between doctors' : a.asPatient ? 'Patient message' : 'Reply to patient', a.text, from),
        toast: a.asPatient ? { tone: 'info', text: `New message from ${c.patient.name}` } : undefined,
      };
    }
    case 'COMPLETE_STEP': {
      if (a.step === 'CLOSE') throw new Error('Use the authorized closure workflow.');
      const label = pathwayOf(c).steps.find((st) => st.id === a.step)?.label ?? a.step;
      let x = complete(c, a.step, a.note);
      if (a.outcomeCategory) x = { ...x, outcomeCategory: a.outcomeCategory };
      x = resolveRule(x, ['R1_OVERDUE', 'R2_OVERDUE_2X', 'R3_UNASSIGNED'], `${label} completed`);
      return { c: log(x, label, a.note), toast: { tone: 'success', text: `${c.id}: ${label}` } };
    }
    case 'SEND_REFERRAL': {
      const svc = servicesFor(s.directory, c.pathwayId).find((x) => x.facility === a.facility);
      if (!svc) throw new Error('Choose a receiving service for this programme.');
      const prevAttempts = c.referral?.attempts ?? 0;
      let x: Case = {
        ...c,
        referral: { facility: a.facility, specialty: svc.specialty, priority: a.priority, note: a.note, status: 'SENT', sentAt: now, attempts: prevAttempts + 1 },
        team: { ...c.team, SPECIALIST: undefined },
      };
      // re-sending after rejection: REFER is already complete, restart ACCEPT clock
      if (c.steps.REFER?.completedAt) x = { ...x, clockResets: { ...x.clockResets, ACCEPT: now } };
      else x = complete(x, 'REFER', `Sent to ${a.facility} (${a.priority})`);
      x = resolveRule(x, ['R5_REJECTED', 'R1_OVERDUE', 'R2_OVERDUE_2X'], `Re-routed to ${a.facility}`);
      return { c: log(x, `Referral sent to ${a.facility}`, `Priority ${a.priority}. ${a.note}`), toast: { tone: 'success', text: `Referral for ${c.patient.name} sent to ${a.facility}` } };
    }
    case 'REFERRAL_RESPOND': {
      if (!c.referral) return null;
      // The person who answers: the acting specialist when the service is theirs,
      // otherwise the service's named specialist.
      const services = servicesAt(s.directory, c.referral.facility);
      if (!services.length) throw new Error('This receiving service is no longer available.');
      const answerer = answersFor(s.directory, c.referral.facility, actor.id) ? actor.id : services[0].specialist;
      const sp = findPerson(s.directory, answerer);
      if (!sp) throw new Error('This receiving service has no specialist in the staff list.');
      if (a.decision === 'ACCEPT') {
        let x: Case = { ...c, referral: { ...c.referral, status: 'ACCEPTED', respondedAt: now }, team: { ...c.team, SPECIALIST: sp } };
        x = complete(x, 'ACCEPT', `Accepted by ${sp.name}`, sp.name);
        x = resolveRule(x, ['R1_OVERDUE', 'R2_OVERDUE_2X', 'R5_REJECTED'], 'Referral accepted');
        return { c: log(x, 'The referral was accepted', `${sp.name}, ${c.referral.facility}`, sp.name), toast: { tone: 'success', text: `${c.referral.facility} accepted ${c.patient.name}` } };
      }
      const status = a.decision === 'REJECT' ? 'REJECTED' : 'INFO_REQUESTED';
      let x: Case = { ...c, referral: { ...c.referral, status, respondedAt: now, rejectReason: a.reason } };
      x = {
        ...x,
        escalations: [...x.escalations, { id: uid('esc'), at: now, level: 1, ruleId: 'R5_REJECTED', reason: `${status === 'REJECTED' ? 'The referral was sent back' : 'The specialist asked for more information'}: ${a.reason}`, to: c.team.PCP?.name ?? 'The referring doctor', stepId: 'ACCEPT' }],
        delayReasons: [...x.delayReasons, { at: now, reason: status === 'REJECTED' ? 'REFERRAL_REJECTED' : 'INFO_MISSING', note: a.reason }],
      };
      return { c: log(x, status === 'REJECTED' ? 'The referral was sent back' : 'The specialist asked for more information', a.reason, sp.name), toast: { tone: 'warn', text: `Referral for ${c.patient.name} ${status === 'REJECTED' ? 'was sent back' : 'needs more information'}. It went back to ${c.team.PCP?.name}.` } };
    }
    case 'BOOK': {
      const by = a.byPatient ? c.patient.name : actor.name;
      let x: Case = { ...c, appointment: { at: a.at, location: a.location, bookedBy: by, dnaCount: c.appointment?.dnaCount ?? 0 } };
      x = complete(x, 'BOOK', `${new Date(a.at).toISOString()} · ${a.location}`, by);
      x = resolveRule(x, ['R1_OVERDUE', 'R2_OVERDUE_2X', 'R7_DNA'], 'Appointment booked');
      return { c: log(x, a.byPatient ? 'Patient self-booked appointment' : 'Appointment booked', a.location, by), toast: { tone: 'success', text: `${c.patient.name} booked for ${pathwayOf(c).diagnosticTest}` } };
    }
    case 'DNA': {
      const dna = (c.appointment?.dnaCount ?? 0) + 1;
      const steps = { ...c.steps };
      delete steps.BOOK;
      let x: Case = {
        ...c, steps, appointment: c.appointment ? { ...c.appointment, dnaCount: dna } : undefined,
        clockResets: { ...c.clockResets, BOOK: now },
        delayReasons: [...c.delayReasons, { at: now, reason: 'DNA', note: a.note }],
        escalations: [...c.escalations, { id: uid('esc'), at: now, level: dna >= 2 ? 2 : 1, ruleId: 'R7_DNA', reason: `The patient missed the appointment (${ordinal(dna)} time)`, to: dna >= 2 ? leadOf(s.directory)?.name ?? LEAD_FALLBACK : c.team.NAVIGATOR?.name ?? 'Navigator', stepId: 'BOOK' }],
      };
      x = log(x, `The patient missed the appointment (${ordinal(dna)} time). The case went back to booking.`, a.note);
      return { c: x, toast: { tone: 'warn', text: `${c.patient.name} did not attend — case back to booking, navigator alerted` } };
    }
    case 'ASSIGN': {
      const p = staffMember(s.directory, a.personId, [a.role]);
      if (!p) throw new Error('That person is not in the staff list for this role.');
      let x: Case = { ...c, team: { ...c.team, [a.role]: p } };
      if (a.role === 'PCP' && !c.accountable) x = { ...x, accountable: p };
      x = resolveRule(x, ['R3_UNASSIGNED'], `Assigned ${p.name}`);
      return { c: log(x, `${p.name} assigned as ${a.role}`, p.org), toast: { tone: 'success', text: `${p.name} now owns ${c.id}` } };
    }
    case 'REQUEST_TRANSFER': {
      const p = staffMember(s.directory, a.personId, ['PCP', 'SPECIALIST']);
      if (!p) throw new Error('Choose a doctor or specialist from the staff list.');
      return { c: log({ ...c, pendingTransfer: { to: p, requestedAt: now, requestedBy: actor.name, reason: a.reason } }, `Hand-over to ${p.name} requested`, `${a.reason}. The current doctor stays responsible until it is accepted.`) };
    }
    case 'TRANSFER_DECISION': {
      if (!c.pendingTransfer) return null;
      const p = c.pendingTransfer.to;
      if (!a.accept) return { c: log({ ...c, pendingTransfer: undefined }, `${p.name} declined the hand-over. Nothing changed.`, undefined, p.name) };
      const role = p.role === 'SPECIALIST' ? 'SPECIALIST' : p.role === 'NAVIGATOR' ? 'NAVIGATOR' : 'PCP';
      return {
        c: log({ ...c, accountable: p, team: { ...c.team, [role]: p }, pendingTransfer: undefined }, `${p.name} accepted the hand-over`, undefined, p.name),
        toast: { tone: 'success', text: `${p.name} accepted accountability for ${c.id}` },
      };
    }
    case 'RESOLVE_ESC': {
      const x: Case = { ...c, escalations: c.escalations.map((e) => (e.id === a.escId ? { ...e, resolvedAt: now, resolvedBy: actor.name, resolution: a.note } : e)) };
      return { c: log(x, 'Alert reviewed and closed', a.note) };
    }
    case 'CLOSE_CASE': {
      assertClosure(c, actor, a.closure);
      const exception = a.closure.kind !== 'EVIDENCE';
      const closure: Closure = { ...a.closure, signedBy: actor.name, signedById: actor.id, signedLicence: actor.licence ?? '—', signedAt: now, status: exception ? 'PENDING_APPROVAL' : 'CLOSED' };
      let x: Case = { ...c, closure };
      if (!exception) x = complete(x, 'CLOSE', `${a.closure.outcome} · ${a.closure.evidenceRef}`);
      if (!exception) x = resolveRule(x, ['R1_OVERDUE', 'R2_OVERDUE_2X', 'R3_UNASSIGNED', 'R6_LOW_UNDERSTANDING', 'R7_DNA', 'R5_REJECTED', 'R4_UNREACHABLE'], 'Case closed');
      if (exception && a.closure.kind === 'DECLINED_INFORMED') x = { ...x, delayReasons: [...x.delayReasons, { at: now, reason: 'PATIENT_DECLINED' }] };
      return {
        c: log(x, exception ? 'Closing without a test result: waiting for a second person to check it' : 'Case closed with a signed test result', `${a.closure.outcome} · Evidence ${a.closure.evidenceRef} · Plan: ${a.closure.plan}`),
        toast: { tone: exception ? 'info' : 'success', text: exception ? `${c.id} is waiting for the clinic lead to check it` : `${c.id} ${c.patient.name}: case closed` },
      };
    }
    case 'APPROVE_CLOSURE': {
      assertApproval(c, actor, a.note);
      if (!c.closure) return null;
      if (!a.approve) return { c: log({ ...c, closure: undefined }, 'The second person did not agree to close this case. It is open again.', a.note) };
      let x: Case = { ...c, closure: { ...c.closure, status: 'CLOSED', approvedBy: actor.name, approvedById: actor.id, approvedAt: now } };
      x = complete(x, 'CLOSE', `Exception (${c.closure.kind}) approved by ${actor.name}`);
      x = { ...x, escalations: x.escalations.map((e) => (e.resolvedAt ? e : { ...e, resolvedAt: now, resolvedBy: actor.name, resolution: 'Closed after the second check' })) };
      return { c: log(x, 'A second person agreed to close this case without a test result', a.note), toast: { tone: 'success', text: `${c.id} closure approved by ${actor.name}` } };
    }
    case 'DELAY':
      return { c: log({ ...c, delayReasons: [...c.delayReasons, { at: now, reason: a.reason, note: a.note }] }, `Reason for the delay recorded: ${DELAY_LABEL[a.reason].toLowerCase()}`, a.note) };
  }
  return null;
}

