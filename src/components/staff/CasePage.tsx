'use client';
/**
 * Case page (Figma: "Case page", node 13:2) with the close pop-up (13:233) and the hand-over pop-up (13:284).
 * Adds the Messages and History cards and exception closures the app needs.
 * Navigators are never offered in hand-over. Every rule is enforced again on the server.
 */
import React, { useId, useMemo, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import type { Action } from '@/context/HalqaStore';
import type { Case, ClosureKind, DelayReason, Person, Role, StepId } from '@/types/halqa';
import {
  caseStatus, currentStep, isClosed, pathwayOf, slaMs, stepStart,
} from '@/lib/engine';
import { fmtDate, fmtDateTime, fromInputValue, toInputValue } from '@/lib/time';
import { closureChecks, type ClosureInput } from '@/domain/closure';
import {
  Avatar, Button, Card, Chip, Dialog, Field, Input, Notice, SaveButton, Select, Textarea, cx, initialsOf, useSaveBlock,
} from '@/components/design/primitives';
import {
  CHANNEL_NAME, LANG_NAME, STATUS_LABEL, STATUS_TONE, TEAM_ROLE_LABEL, callbackOpen, canActOnStep,
  firstName, messageInFlight, messageStatusText, nextActionText, plainDuration, pronoun, referralReturned, stepLabel, workStatus,
} from './caseView';
import { NotOnList } from './NotOnList';

type Dispatch = (a: Action) => void;

/* ------------------------------------------------------------------ helpers */

const MIN_NOTE = 5;

function NoteField({ id, label, value, onChange, min = MIN_NOTE, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; min?: number; placeholder?: string;
}) {
  const short = value.trim().length < min;
  return (
    <Field label={label} htmlFor={id} hint={min > 1 ? `At least ${min} characters.` : undefined}>
      <Textarea
        id={id}
        rows={2}
        value={value}
        placeholder={placeholder}
        aria-invalid={value.length > 0 && short ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

const CheckIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M3.5 8.5l3 3 6-7" /></svg>
);
const CrossIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
const ArrowIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);

/* ------------------------------------------------------------------ page */

export function CasePage() {
  const { s, d, user } = useHalqa();
  const c = s.cases.find((x) => x.id === s.selectedId);
  const [dialog, setDialog] = useState<'close' | 'handover' | null>(null);

  if (!c) return <NotOnList />;

  const role = user.person.role;
  const now = s.now;
  const first = firstName(c.patient.name);
  const status = workStatus(c, role, now);
  const lang = LANG_NAME[c.patient.lang] ?? c.patient.lang;
  const openEsc = c.escalations.filter((e) => !e.resolvedAt);
  const transferToMe = c.pendingTransfer && c.pendingTransfer.to.id === user.person.id;

  return (
    <div className="space-y-6">
      <Breadcrumb name={c.patient.name} d={d} />

      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-page-title text-slate-900">{c.patient.name}</h1>
          <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
        </div>
        <p className="mt-2 text-[16px] text-slate-500">
          {c.patient.age} · Speaks {lang} · Phone {c.patient.phone}
        </p>
      </header>

      {transferToMe && c.pendingTransfer && (
        <Notice
          tone="info"
          title={`${c.pendingTransfer.requestedBy} wants to hand this patient to you`}
          text={`Reason: ${c.pendingTransfer.reason}`}
          action={(
            <div className="flex flex-wrap gap-3">
              <SaveButton kind="success" onClick={() => d({ type: 'TRANSFER_DECISION', id: c.id, accept: true })}>Accept</SaveButton>
              <SaveButton kind="secondary" onClick={() => d({ type: 'TRANSFER_DECISION', id: c.id, accept: false })}>Decline</SaveButton>
            </div>
          )}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,820fr)_minmax(320px,380fr)]">
        <div className="min-w-0 space-y-6">
          <NextStep c={c} role={role} now={now} d={d} onClose={() => setDialog('close')} />
          <Timeline c={c} role={role} now={now} />
          <Messages c={c} role={role} d={d} />
          <History c={c} />
        </div>

        <aside className="min-w-0 space-y-6" aria-label={`About ${first}`}>
          <AboutCard c={c} d={d} />
          <DelayCard c={c} d={d} />
          <TeamCard c={c} role={role} onHandOver={() => setDialog('handover')} />
          {openEsc.length > 0 && <DecisionsCard c={c} d={d} />}
          <CloseCard c={c} role={role} actor={user.person} onOpen={() => setDialog('close')} />
        </aside>
      </div>

      {dialog === 'close' && <CloseDialog c={c} actor={user.person} d={d} onClose={() => setDialog(null)} />}
      {dialog === 'handover' && <HandOverDialog c={c} me={user.person} d={d} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Breadcrumb({ name, d }: { name: string; d: Dispatch }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-[16px]">
        <li>
          <button
            type="button"
            onClick={() => d({ type: 'SELECT', id: null })}
            className="inline-flex min-h-[48px] items-center font-medium text-teal-800 underline-offset-4 hover:underline"
          >
            My work
          </button>
        </li>
        <li aria-hidden="true" className="text-slate-500">›</li>
        <li aria-current="page" className="text-slate-700">{name}</li>
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ next step (hero) */

function heroBody(c: Case, role: Role | string, now: number, mine: boolean): string {
  const first = firstName(c.patient.name);
  const p = pronoun(c);
  const lang = LANG_NAME[c.patient.lang] ?? c.patient.lang;
  const step = currentStep(c);
  const test = pathwayOf(c).diagnosticTest.toLowerCase();
  const facility = c.referral?.facility ?? 'the specialist service';
  if (isClosed(c)) return `This case was closed on ${c.closure ? fmtDate(c.closure.signedAt) : 'an earlier date'}.`;
  if (c.closure?.status === 'PENDING_APPROVAL') return 'The closure has been sent to the clinic lead for a second check. Nothing for you to do now.';
  if (!step) return '';
  const owner = caseStatus(c, now).ownerName;
  const lowUnderstanding = !!c.feedback && (!c.feedback.understoodQ1 || !c.feedback.understoodQ2 || c.feedback.confidence <= 2);
  switch (step.id) {
    case 'NOTIFY': {
      const failed = c.notifications.filter((n) => n.status === 'FAILED' || n.status === 'NO_ANSWER').length;
      const tries = failed ? ` ${failed} earlier ${failed === 1 ? 'try' : 'tries'} did not reach ${p.obj}.` : '';
      const pending = messageInFlight(c);
      if (pending) return `${messageStatusText(pending)} ${first} has not been told yet. You can still call ${p.obj}.${tries}`;
      return `Explain the result in ${lang}. ${first} prefers ${CHANNEL_NAME[c.patient.preferredChannel] ?? 'a message'}. Use a call if ${p.subj} prefers.${tries}`;
    }
    case 'ACK':
      return lowUnderstanding
        ? `Explain the result in ${lang}. ${first} was not sure what it means. Call ${p.obj} and check ${p.subj} understood.`
        : `${first} has not done the quick check yet. Call ${p.obj} in ${lang} and check ${p.subj} understood.`;
    case 'CONSULT': return mine ? `Talk through the result with ${first} and agree what happens next. Write a short note.` : `${owner} will talk through the result with ${first}.`;
    case 'CONFIRM_TEST': return mine ? 'Do the repeat test and write down the result.' : `${owner} will do the repeat test.`;
    case 'REFER': return mine ? `Choose the specialist service and say why ${first} needs to be seen.` : `${owner} will send the referral.`;
    case 'ACCEPT':
      if (referralReturned(c)) return mine ? `${facility} sent the referral back. Read why and send it again.` : `${facility} sent the referral back. The doctor will send it again.`;
      return role === 'SPECIALIST'
        ? `Waiting for ${facility} to accept. Accept or send it back on the Referrals screen.`
        : `${facility} has the referral. Nothing for you to do until they accept.`;
    case 'BOOK': return `Agree a time with ${facility} that suits ${first}, then enter the date and time below.`;
    case 'ATTEND':
      if (c.appointment && c.appointment.at > now) return `${first} has an appointment at ${c.appointment.location} on ${fmtDateTime(c.appointment.at)}.`;
      return `The appointment was ${c.appointment ? `on ${fmtDateTime(c.appointment.at)}` : 'due'}. Did ${first} go?`;
    case 'OUTCOME': return mine ? `Write down what the ${test} showed.` : `Waiting for ${owner} to write down what the ${test} showed.`;
    case 'CARE_PLAN': return mine ? 'Write down the plan: treatment, check-ups, or back to routine screening.' : `Waiting for ${owner} to write down the plan.`;
    case 'CLOSE': return mine ? 'Check the list, write down the result and the plan, then close the case.' : 'A doctor will check the list and close the case.';
    default: return step.hint;
  }
}

function NextStep({ c, role, now, d, onClose }: { c: Case; role: Role; now: number; d: Dispatch; onClose: () => void }) {
  const step = currentStep(c);
  const mine = canActOnStep(c, role, now);
  const st = caseStatus(c, now);
  const showCallback = callbackOpen(c) && (role === 'NAVIGATOR' || role === 'PCP') && !isClosed(c);
  const title = step?.id === 'CLOSE' && mine ? 'Ready to close?' : nextActionText(c, role, now);
  const askInterpreter = !c.patient.needsInterpreter && (role === 'NAVIGATOR' || role === 'PCP') ? (
    <SaveButton kind="quiet" onClick={() => d({ type: 'INTERPRETER', id: c.id, on: true })}>Ask for an interpreter</SaveButton>
  ) : null;

  return (
    <Card tone="teal" className="sm:p-9" aria-labelledby="next-step-title">
      <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-teal-800">Your next step</p>
      <h2 id="next-step-title" className="mt-3 text-[28px] font-bold leading-9 text-slate-900">{title}</h2>
      <p className="mt-3 text-[18px] leading-7 text-slate-700">{heroBody(c, role, now, mine)}</p>
      {st.state !== 'CLOSED' && st.state !== 'PENDING_APPROVAL' && st.dueAt > 0 && (
        <p className={cx('mt-2 text-[14px] font-semibold', st.state === 'OVERDUE' ? 'text-rose-600' : st.state === 'DUE_SOON' ? 'text-amber-600' : 'text-slate-500')}>
          {st.remainingMs < 0 ? `${plainDuration(-st.remainingMs)} late` : `Due ${fmtDateTime(st.dueAt)} (in ${plainDuration(st.remainingMs)})`}
        </p>
      )}

      {showCallback && <CallbackBlock c={c} d={d} />}

      {mine && step && (
        <div className="mt-6 [&_button]:min-h-[56px] [&_button]:text-[18px]">
          <StepActions c={c} stepId={step.id} now={now} d={d} onClose={onClose} extra={askInterpreter} />
        </div>
      )}
    </Card>
  );
}

function CallbackBlock({ c, d }: { c: Case; d: Dispatch }) {
  const id = useId();
  const [note, setNote] = useState('');
  return (
    <div className="mt-6 space-y-4 rounded-card border border-amber-600/30 bg-amber-50 p-5">
      <p className="text-[16px] font-semibold text-amber-600">{firstName(c.patient.name)} asked for a call back</p>
      <NoteField id={`${id}-cb`} label="What did you talk about?" value={note} onChange={setNote} min={1} />
      <SaveButton
        kind="primary"
        disabled={!note.trim()}
        onClick={() => { d({ type: 'CALLBACK_DONE', id: c.id, note: note.trim() }); setNote(''); }}
      >
        Mark call done
      </SaveButton>
    </div>
  );
}

function StepActions({ c, stepId, now, d, onClose, extra }: { c: Case; stepId: StepId; now: number; d: Dispatch; onClose: () => void; extra?: React.ReactNode }) {
  const id = useId();
  const first = firstName(c.patient.name);
  const [note, setNote] = useState('');
  const [calling, setCalling] = useState(false);
  const [category, setCategory] = useState<'' | NonNullable<Case['outcomeCategory']>>('');
  const { directory } = useHalqa();
  const services = directory.services.filter((x) => x.pathway === c.pathwayId);
  const [facility, setFacility] = useState(services[0]?.facility ?? '');
  const [priority, setPriority] = useState<'URGENT' | 'SOON' | 'ROUTINE'>(c.urgency === 'CRITICAL' ? 'URGENT' : 'SOON');
  const [when, setWhen] = useState('');
  const noteOk = note.trim().length >= MIN_NOTE;
  const done = () => setNote('');

  switch (stepId) {
    case 'NOTIFY': {
      const channel = c.patient.preferredChannel === 'WHATSAPP' ? 'WHATSAPP' : 'SMS';
      const pending = messageInFlight(c);
      return (
        <div className="space-y-4">
          {pending && (
            <p id={`${id}-pending`} role="status" className="text-[16px] text-slate-700">
              {messageStatusText(pending)} Another message can be sent after the delivery report arrives.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <SaveButton
              disabled={!!pending}
              aria-describedby={pending ? `${id}-pending` : undefined}
              onClick={() => d({ type: 'NOTIFY', id: c.id, channel })}
            >
              Message {first}
            </SaveButton>
            <SaveButton kind="secondary" aria-expanded={calling} onClick={() => setCalling((v) => !v)}>
              Call {first}
            </SaveButton>
            {extra}
          </div>
          {calling && (
            <div role="group" aria-label="How did the call go?" className="flex flex-wrap items-center gap-3 rounded-card bg-white p-4">
              <p className="w-full text-[16px] font-semibold text-slate-900">How did the call go?</p>
              <SaveButton kind="success" onClick={() => { d({ type: 'NOTIFY', id: c.id, channel: 'PHONE', phoneOutcome: 'REACHED' }); setCalling(false); }}>Reached</SaveButton>
              <SaveButton kind="quiet" onClick={() => { d({ type: 'NOTIFY', id: c.id, channel: 'PHONE', phoneOutcome: 'NO_ANSWER' }); setCalling(false); }}>No answer</SaveButton>
            </div>
          )}
        </div>
      );
    }
    case 'ACK':
      return (
        <div className="space-y-4">
          <NoteField id={`${id}-a`} label={`What did ${first} say back to you?`} value={note} onChange={setNote} min={1} />
          <div className="flex flex-wrap gap-3">
            <SaveButton disabled={!note.trim()} onClick={() => { d({ type: 'STAFF_ACK', id: c.id, note: note.trim() }); done(); }}>
              Mark as done
            </SaveButton>
            {extra}
          </div>
        </div>
      );
    case 'CONSULT':
    case 'CONFIRM_TEST':
    case 'CARE_PLAN': {
      const field = stepId === 'CONSULT' ? 'What did you agree?' : stepId === 'CONFIRM_TEST' ? 'What did the repeat test show?' : 'What is the plan?';
      return (
        <div className="space-y-4">
          <NoteField id={`${id}-s`} label={field} value={note} onChange={setNote} />
          <SaveButton disabled={!noteOk} onClick={() => { d({ type: 'COMPLETE_STEP', id: c.id, step: stepId, note: note.trim() }); done(); }}>
            Mark as done
          </SaveButton>
        </div>
      );
    }
    case 'REFER':
    case 'ACCEPT': // only reached when the referral was sent back
      return (
        <div className="space-y-4">
          {referralReturned(c) && c.referral && (
            <Notice
              tone="warn"
              title="The referral came back"
              text={c.referral.status === 'REJECTED' ? `Reason: ${c.referral.rejectReason ?? 'No reason given'}` : `The specialist asked for more information.${c.referral.rejectReason ? ` ${c.referral.rejectReason}` : ''}`}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Send to" htmlFor={`${id}-f`}>
              <Select id={`${id}-f`} value={facility} onChange={(e) => setFacility(e.target.value)}>
                {services.map((x) => <option key={x.facility} value={x.facility}>{x.facility}</option>)}
              </Select>
            </Field>
            <Field label="How soon?" htmlFor={`${id}-p`}>
              <Select id={`${id}-p`} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
                <option value="URGENT">Urgent</option>
                <option value="SOON">Soon</option>
                <option value="ROUTINE">Routine</option>
              </Select>
            </Field>
          </div>
          <NoteField id={`${id}-r`} label={`Why does ${first} need to be seen?`} value={note} onChange={setNote} />
          <SaveButton disabled={!noteOk || !facility} onClick={() => { d({ type: 'SEND_REFERRAL', id: c.id, facility, priority, note: note.trim() }); done(); }}>
            {referralReturned(c) ? 'Send referral again' : 'Send referral'}
          </SaveButton>
        </div>
      );
    case 'BOOK': {
      const location = c.referral?.facility ?? '';
      const at = when ? fromInputValue(when) : NaN;
      const okTime = Number.isFinite(at) && at > now;
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date and time" htmlFor={`${id}-w`}>
              <Input id={`${id}-w`} type="datetime-local" min={toInputValue(now)} value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Field label="Place" htmlFor={`${id}-l`}>
              <Input id={`${id}-l`} value={location} readOnly />
            </Field>
          </div>
          <SaveButton disabled={!okTime || !location} onClick={() => { d({ type: 'BOOK', id: c.id, at: Math.round(at), location }); setWhen(''); }}>
            Book appointment
          </SaveButton>
        </div>
      );
    }
    case 'ATTEND':
      return (
        <div className="space-y-4">
          <NoteField id={`${id}-t`} label="Note about the visit" value={note} onChange={setNote} />
          <div className="flex flex-wrap gap-3">
            <SaveButton disabled={!noteOk} onClick={() => { d({ type: 'COMPLETE_STEP', id: c.id, step: 'ATTEND', note: note.trim() }); done(); }}>
              Mark as attended
            </SaveButton>
            <SaveButton kind="danger" disabled={!note.trim()} onClick={() => { d({ type: 'DNA', id: c.id, note: note.trim() }); done(); }}>
              Did not attend
            </SaveButton>
          </div>
        </div>
      );
    case 'OUTCOME':
      return (
        <div className="space-y-4">
          <Field label="What kind of result? (optional)" htmlFor={`${id}-c`}>
            <Select id={`${id}-c`} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              <option value="">Not chosen</option>
              <option value="NORMAL">Normal</option>
              <option value="BENIGN">Not cancer (benign)</option>
              <option value="PRECANCER">Early changes (pre-cancer)</option>
              <option value="DISEASE">Disease found</option>
            </Select>
          </Field>
          <NoteField id={`${id}-o`} label="What did the test show?" value={note} onChange={setNote} />
          <SaveButton
            disabled={!noteOk}
            onClick={() => { d({ type: 'COMPLETE_STEP', id: c.id, step: 'OUTCOME', note: note.trim(), ...(category ? { outcomeCategory: category } : {}) }); done(); setCategory(''); }}
          >
            Mark as done
          </SaveButton>
        </div>
      );
    case 'CLOSE':
      return <Button onClick={onClose}>Close case</Button>;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ timeline */

function Timeline({ c, role, now }: { c: Case; role: Role; now: number }) {
  const steps = pathwayOf(c).steps;
  const cur = currentStep(c);
  const first = firstName(c.patient.name);
  const p = pronoun(c);
  const mine = canActOnStep(c, role, now);
  const owner = caseStatus(c, now).ownerName;
  const lowUnderstanding = !!c.feedback && (!c.feedback.understoodQ1 || !c.feedback.understoodQ2 || c.feedback.confidence <= 2);

  return (
    <Card aria-labelledby="happened-title">
      <h2 id="happened-title" className="text-section text-slate-900">What has happened</h2>
      <ol className="mt-5 space-y-2">
        {steps.map((step) => {
          const rec = c.steps[step.id];
          const doneAt = rec?.completedAt;
          const isNow = !doneAt && cur?.id === step.id && !isClosed(c);
          const label = stepLabel(c, step.id, step.label);
          if (doneAt) {
            const late = doneAt > stepStart(c, step) + slaMs(c, step);
            return (
              <li key={step.id} className="flex items-center gap-4 rounded-card px-3 py-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckIcon /></span>
                <span className="min-w-0 flex-1 text-[16px] text-slate-900">{label}<span className="sr-only"> — done</span></span>
                {late && <Chip tone="amber">Late</Chip>}
                <span className="shrink-0 text-[14px] text-slate-500">{fmtDate(doneAt)}</span>
              </li>
            );
          }
          if (isNow) {
            const flagged = step.id === 'ACK' && lowUnderstanding;
            return (
              <li key={step.id} aria-current="step" className="flex items-center gap-4 rounded-card bg-teal-50 px-3 py-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white"><ArrowIcon /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold text-slate-900">{mine ? nextActionText(c, role, now) : label}</span>
                  <span className={cx('block text-[14px]', flagged ? 'text-amber-600' : 'text-teal-800')}>
                    {flagged ? `${first} was not sure, so a call is needed` : mine ? 'This is your next step' : `Waiting for ${owner}`}
                  </span>
                </span>
                {flagged && <Chip tone="amber">Call needed</Chip>}
                <span className="shrink-0 text-[14px] font-semibold text-teal-800">Now</span>
              </li>
            );
          }
          return (
            <li key={step.id} className="flex items-center gap-4 rounded-card px-3 py-3">
              <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-full border-2 border-slate-200 bg-white" />
              <span className="min-w-0 flex-1 text-[16px] text-slate-500">{label}</span>
              <span className="shrink-0 text-[14px] text-slate-500">Not yet</span>
            </li>
          );
        })}
      </ol>
      {c.closure?.status === 'PENDING_APPROVAL' && (
        <p className="mt-4 text-[14px] text-slate-500">The closure is with the clinic lead for a second check. {p.subj === 'she' ? 'Her' : 'His'} case stays open until then.</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ messages */

function Messages({ c, role, d }: { c: Case; role: Role; d: Dispatch }) {
  const first = firstName(c.patient.name);
  const staff = role !== 'PATIENT';
  return (
    <Card aria-labelledby="messages-title">
      <h2 id="messages-title" className="text-section text-slate-900">Messages</h2>
      <div className="mt-5 grid gap-8">
        <Thread c={c} thread="PATIENT" title={`With ${first}`} canWrite={staff} d={d} />
        <Thread
          c={c}
          thread="ECONSULT"
          title="Between clinicians"
          canWrite={role === 'PCP' || role === 'SPECIALIST' || role === 'LEAD'}
          note={role === 'NAVIGATOR' ? 'Only doctors can write here.' : undefined}
          d={d}
        />
      </div>
    </Card>
  );
}

function Thread({ c, thread, title, canWrite, note, d }: {
  c: Case; thread: 'PATIENT' | 'ECONSULT'; title: string; canWrite: boolean; note?: string; d: Dispatch;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const list = c.messages.filter((m) => m.thread === thread);
  const closed = isClosed(c);
  return (
    <section aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="text-card-title text-slate-900">{title}</h3>
      {list.length === 0 ? (
        <p className="mt-2 text-[14px] text-slate-500">No messages yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {list.map((m) => (
            <li key={m.id} className={cx('rounded-card p-4', m.fromRole === 'PATIENT' ? 'bg-slate-50' : 'bg-teal-50')}>
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
                <span className="font-semibold text-slate-900">{m.from}</span>
                <span className="text-slate-500">{fmtDateTime(m.at)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[16px] text-slate-700">{m.text}</p>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-3 text-[14px] text-slate-500">{note}</p>}
      {canWrite && !closed && (
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; d({ type: 'MESSAGE', id: c.id, thread, text: text.trim() }); setText(''); }}
        >
          <Field label="Write a reply" htmlFor={`${id}-t`} className="flex-1">
            <Input id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
          </Field>
          <SaveButton type="submit" kind="secondary" disabled={!text.trim()}>Send</SaveButton>
        </form>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ history */

function History({ c }: { c: Case }) {
  const entries = [...c.audit].sort((a, b) => b.at - a.at);
  return (
    <Card as="details" className="group">
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-4 text-section text-slate-900 [&::-webkit-details-marker]:hidden">
        <span>History</span>
        <span className="text-[14px] font-semibold text-teal-800">
          <span className="group-open:hidden">Show {entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <ol className="mt-4 divide-y divide-slate-200">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`} className="py-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
              <span className="font-semibold text-slate-900">{e.actor}</span>
              <span className="text-slate-500">{fmtDateTime(e.at)}</span>
            </p>
            <p className="text-[16px] text-slate-700">{e.action}</p>
            {e.detail && <p className="break-words text-[14px] text-slate-500">{e.detail}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------------------ right column */

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-[14px] text-slate-500">{label}</dt>
      <dd className="text-right text-[16px] font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

const DELAY_REASON_LABELS: Record<DelayReason, string> = {
  UNREACHABLE: 'Could not reach the patient',
  DNA: 'Missed appointment',
  REFERRAL_REJECTED: 'Specialist sent referral back',
  CAPACITY: 'Clinic or hospital is busy',
  LOW_UNDERSTANDING: 'Patient had questions or needed more time',
  PATIENT_DECLINED: 'Patient wants to pause or decline',
  PATIENT_TRAVEL: 'Patient is travelling',
  INFO_MISSING: 'Waiting for records or test results',
};

function AboutCard({ c, d }: { c: Case; d: Dispatch }) {
  const saveBlock = useSaveBlock();
  const first = firstName(c.patient.name);
  const closed = isClosed(c);
  return (
    <Card aria-labelledby="about-title">
      <h2 id="about-title" className="text-card-title text-slate-900">About {first}</h2>
      <dl className="mt-3 divide-y divide-slate-100">
        <Row label="Age" value={c.patient.age} />
        <Row label="Language" value={LANG_NAME[c.patient.lang] ?? c.patient.lang} />
        <Row label="Best way to reach" value={CHANNEL_NAME[c.patient.preferredChannel] ?? c.patient.preferredChannel} />
        <Row label="Phone" value={c.patient.phone} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
          <dt className="text-[14px] text-slate-500">Interpreter</dt>
          <dd className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-[16px] font-semibold text-slate-900">
              {c.patient.needsInterpreter ? 'Requested' : 'Not requested'}
            </span>
            {!closed && (
              <button
                type="button"
                disabled={!!saveBlock}
                title={saveBlock || undefined}
                onClick={() => d({ type: 'INTERPRETER', id: c.id, on: !c.patient.needsInterpreter })}
                className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-button border border-slate-200 px-4 text-[14px] font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:text-slate-500"
              >
                {c.patient.needsInterpreter ? 'Turn off' : 'Request'}
              </button>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function DelayCard({ c, d }: { c: Case; d: Dispatch }) {
  const { busy } = useHalqa();
  const [reason, setReason] = useState<DelayReason>('UNREACHABLE');
  const [note, setNote] = useState('');
  const [showForm, setShowForm] = useState(false);
  const reasons = c.delayReasons || [];
  const closed = isClosed(c);

  const save = () => {
    d({ type: 'DELAY', id: c.id, reason, note: note.trim() || undefined });
    setNote('');
    setShowForm(false);
  };

  return (
    <Card aria-labelledby="delay-card-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="delay-card-title" className="text-card-title text-slate-900">Something is slowing this down</h2>
          <p className="mt-1 text-[14px] text-slate-500">Record why a step cannot happen on time.</p>
        </div>
      </div>

      {reasons.length > 0 && (
        <ul className="mt-4 space-y-2">
          {reasons.map((r, i) => (
            <li key={i} className="rounded-card bg-amber-50 border border-amber-200 p-3 text-[14px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-amber-900">{DELAY_REASON_LABELS[r.reason] ?? r.reason}</span>
                <span className="text-slate-500 text-[14px]">{fmtDateTime(r.at)}</span>
              </div>
              {r.note && <p className="mt-1 text-slate-700">{r.note}</p>}
            </li>
          ))}
        </ul>
      )}

      {!closed && (
        <div className="mt-4">
          {!showForm ? (
            <Button kind="secondary" size="md" full onClick={() => setShowForm(true)}>
              Record a delay reason
            </Button>
          ) : (
            <div className="space-y-4 rounded-card bg-slate-50 p-4 border border-slate-200">
              <Field label="What is causing the delay?" htmlFor="delay-reason-select">
                <Select
                  id="delay-reason-select"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as DelayReason)}
                >
                  <option value="UNREACHABLE">Could not reach the patient</option>
                  <option value="DNA">Missed appointment</option>
                  <option value="REFERRAL_REJECTED">Specialist sent referral back</option>
                  <option value="CAPACITY">Clinic or hospital is busy</option>
                  <option value="LOW_UNDERSTANDING">Patient had questions or needed more time</option>
                  <option value="PATIENT_DECLINED">Patient wants to pause or decline</option>
                  <option value="PATIENT_TRAVEL">Patient is travelling</option>
                  <option value="INFO_MISSING">Waiting for records or test results</option>
                </Select>
              </Field>
              <Field label="Note (optional)" htmlFor="delay-note-input">
                <Input
                  id="delay-note-input"
                  value={note}
                  placeholder="Additional context about this delay"
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <Button kind="quiet" size="md" onClick={() => setShowForm(false)} disabled={busy}>
                  Cancel
                </Button>
                <SaveButton kind="primary" size="md" onClick={save}>
                  Save reason
                </SaveButton>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function TeamCard({ c, role, onHandOver }: { c: Case; role: Role; onHandOver: () => void }) {
  const first = firstName(c.patient.name);
  const slots: Array<'NAVIGATOR' | 'PCP' | 'SPECIALIST'> = ['NAVIGATOR', 'PCP', 'SPECIALIST'];
  const members = slots.map((r) => ({ r, person: c.team[r] }));
  const accountableExtra = c.accountable && !members.some((m) => m.person?.id === c.accountable?.id) ? c.accountable : undefined;
  const canHandOver = role === 'PCP' || role === 'SPECIALIST' || role === 'LEAD';

  return (
    <Card aria-labelledby="team-title">
      <h2 id="team-title" className="text-card-title text-slate-900">Who is looking after {first}</h2>
      <ul className="mt-4 space-y-5">
        {members.map(({ r, person }) => (
          <li key={r} className="flex items-start gap-4">
            {person ? <Avatar initials={initialsOf(person.name)} /> : <Avatar initials="?" tone="amber" />}
            <div className="min-w-0">
              {person ? (
                <>
                  <p className="text-[16px] font-semibold text-slate-900">{person.name}</p>
                  <p className="text-[14px] text-teal-800">
                    {TEAM_ROLE_LABEL[r]}{c.accountable?.id === person.id ? ' · Responsible for this case' : ''}
                  </p>
                  <p className="text-[14px] text-slate-500">{person.org}</p>
                </>
              ) : (
                <>
                  <p className="text-[16px] font-semibold text-slate-900">{TEAM_ROLE_LABEL[r]}</p>
                  <Chip tone="amber" className="mt-1">Not chosen yet</Chip>
                </>
              )}
            </div>
          </li>
        ))}
        {accountableExtra && (
          <li className="flex items-start gap-4">
            <Avatar initials={initialsOf(accountableExtra.name)} />
            <div className="min-w-0">
              <p className="text-[16px] font-semibold text-slate-900">{accountableExtra.name}</p>
              <p className="text-[14px] text-teal-800">{TEAM_ROLE_LABEL[accountableExtra.role] ?? 'Clinician'} · Responsible for this case</p>
              <p className="text-[14px] text-slate-500">{accountableExtra.org}</p>
            </div>
          </li>
        )}
      </ul>
      {c.pendingTransfer && (
        <p className="mt-5 text-[14px] text-slate-700">
          Waiting for {c.pendingTransfer.to.name} to accept the hand-over.
        </p>
      )}
      {canHandOver && !isClosed(c) && !c.pendingTransfer && (
        <div className="mt-5">
          <Button kind="secondary" full onClick={onHandOver}>Hand over this patient</Button>
        </div>
      )}
    </Card>
  );
}

const ESC_TITLE: Record<string, string> = {
  R1_OVERDUE: 'This step is late',
  R2_OVERDUE_2X: 'This step is very late',
  R3_UNASSIGNED: 'Nobody is looking after this step',
  R4_UNREACHABLE: 'We cannot reach the patient',
  R5_REJECTED: 'The referral came back',
  R6_LOW_UNDERSTANDING: 'The patient may not understand the result',
  R7_DNA: 'The patient missed the appointment',
  R8_APPROVAL_OVERDUE: 'The closure is waiting too long for a check',
};

function DecisionsCard({ c, d }: { c: Case; d: Dispatch }) {
  const open = c.escalations.filter((e) => !e.resolvedAt);
  return (
    <Card tone="amber" aria-labelledby="decide-title">
      <h2 id="decide-title" className="text-card-title text-slate-900">Needs a decision</h2>
      <ul className="mt-4 space-y-5">
        {open.map((e) => <DecisionItem key={e.id} c={c} escId={e.id} title={ESC_TITLE[e.ruleId] ?? 'Something needs a decision'} reason={e.reason} at={e.at} d={d} />)}
      </ul>
    </Card>
  );
}

function DecisionItem({ c, escId, title, reason, at, d }: { c: Case; escId: string; title: string; reason: string; at: number; d: Dispatch }) {
  const id = useId();
  const [note, setNote] = useState('');
  return (
    <li className="space-y-3 rounded-card bg-white p-4">
      <div>
        <p className="text-[16px] font-semibold text-slate-900">{title}</p>
        <p className="text-[14px] text-slate-500">{reason} · {fmtDateTime(at)}</p>
      </div>
      <Field label="What did you decide?" htmlFor={`${id}-d`}>
        <Input id={`${id}-d`} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <SaveButton kind="primary" disabled={!note.trim()} onClick={() => { d({ type: 'RESOLVE_ESC', id: c.id, escId, note: note.trim() }); setNote(''); }}>
        Resolve
      </SaveButton>
    </li>
  );
}

function CloseCard({ c, role, actor, onOpen }: { c: Case; role: Role; actor: Person; onOpen: () => void }) {
  const ready = useMemo(
    () => closureChecks(c, actor, { kind: 'EVIDENCE', outcome: 'ready', evidenceRef: 'ready', plan: 'ready' }).every((x) => x.ok),
    [c, actor],
  );
  if (isClosed(c) && c.closure) {
    return (
      <Card tone="teal" aria-labelledby="closed-title">
        <h2 id="closed-title" className="text-card-title text-slate-900">Closed</h2>
        <dl className="mt-3">
          <Row label="Result" value={c.closure.outcome} />
          <Row label="Signed by" value={c.closure.signedBy} />
          <Row label="Date" value={fmtDate(c.closure.signedAt)} />
        </dl>
        <p className="mt-3 text-[14px] font-semibold text-slate-900">Plan</p>
        <p className="text-[16px] text-slate-700">{c.closure.plan}</p>
      </Card>
    );
  }
  const doctor = role === 'PCP' || role === 'SPECIALIST';
  return (
    <Card aria-labelledby="close-title">
      <h2 id="close-title" className="text-card-title text-slate-900">Close this case</h2>
      {c.closure?.status === 'PENDING_APPROVAL' ? (
        <p className="mt-3 text-[16px] text-slate-700">Sent to the clinic lead for a second check.</p>
      ) : (
        <>
          <p className="mt-3 text-[16px] text-slate-500">A case can only be closed when the test is done and a plan is written down.</p>
          {!doctor && <p className="mt-3 text-[14px] text-slate-500">Only a doctor can close a case.</p>}
          {doctor && (
            <div className="mt-5">
              <Button kind={ready ? 'primary' : 'quiet'} full onClick={onOpen}>
                {ready ? 'Close case' : 'Close case — not ready yet'}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ close dialog */

const KIND_LABEL: Record<ClosureKind, string> = {
  EVIDENCE: 'Standard — the test is done and a plan is written',
  DECLINED_INFORMED: 'Patient said no after a clear talk',
  CARE_ELSEWHERE: 'Care completed at another service',
  OUT_OF_SCOPE: 'Patient moved away or died',
};

function plainCheck(c: Case, text: string): string {
  // The server writes these checks in plain words; only the list of missing steps is reworded with the screen's step names.
  if (text.startsWith('Steps still to do')) {
    const missing = pathwayOf(c).steps.filter((s) => s.id !== 'CLOSE' && !c.steps[s.id]?.completedAt);
    return `Steps still to do: ${missing.map((s) => stepLabel(c, s.id, s.label)).join(', ')}`;
  }
  return text;
}

function CloseDialog({ c, actor, d, onClose }: { c: Case; actor: Person; d: Dispatch; onClose: () => void }) {
  const id = useId();
  const [kind, setKind] = useState<ClosureKind>('EVIDENCE');
  const [outcome, setOutcome] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [plan, setPlan] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [justification, setJustification] = useState('');
  const [sent, setSent] = useState<null | 'exception'>(null);
  const exception = kind !== 'EVIDENCE';

  const input: ClosureInput = {
    kind, outcome, evidenceRef, plan,
    ...(nextDue ? { nextScreeningDue: nextDue } : {}),
    ...(exception ? { justification } : {}),
  };
  const checks = closureChecks(c, actor, input);
  const allOk = checks.every((x) => x.ok);

  const submit = () => {
    if (!allOk) return;
    d({
      type: 'CLOSE_CASE',
      id: c.id,
      closure: {
        kind,
        outcome: outcome.trim(),
        evidenceRef: evidenceRef.trim(),
        plan: plan.trim(),
        ...(nextDue ? { nextScreeningDue: nextDue } : {}),
        ...(exception && justification.trim() ? { justification: justification.trim() } : {}),
      },
    });
    if (exception) setSent('exception'); else onClose();
  };

  if (sent) {
    return (
      <Dialog title="Sent for a second check" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <p>Sent to the clinic lead for a second check. The case stays open until they agree.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Close this case?"
      onClose={onClose}
      footer={(
        <>
          <Button kind="quiet" onClick={onClose}>Not yet</Button>
          <SaveButton disabled={!allOk} onClick={submit}>Close case</SaveButton>
        </>
      )}
    >
      <p className="-mt-2 text-[16px] text-slate-500">Only a doctor can close a case. Check the list first.</p>

      <div className="mt-5 rounded-card bg-slate-50 p-5">
        <p className="text-[14px] font-semibold text-slate-500" id={`${id}-list`}>Before you close</p>
        <ul aria-labelledby={`${id}-list`} aria-live="polite" className="mt-3 space-y-3">
          {checks.map((x) => (
            <li key={x.text} className="flex items-center gap-3">
              {x.ok ? (
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><CheckIcon /></span>
              ) : (
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-slate-400 text-slate-400"><CrossIcon /></span>
              )}
              <span className="min-w-0 flex-1 text-[16px] text-slate-900">{plainCheck(c, x.text)}</span>
              <Chip tone={x.ok ? 'emerald' : 'amber'}>{x.ok ? 'Done' : 'Not done'}</Chip>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 space-y-5">
        <Field label="How is this case ending?" htmlFor={`${id}-k`}>
          <Select id={`${id}-k`} value={kind} onChange={(e) => setKind(e.target.value as ClosureKind)}>
            {(Object.keys(KIND_LABEL) as ClosureKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="What did the test show?" htmlFor={`${id}-o`}>
          <Input id={`${id}-o`} value={outcome} placeholder="What the test showed" onChange={(e) => setOutcome(e.target.value)} />
        </Field>
        <Field label="Where is the report?" hint="The report reference, at least 4 characters." htmlFor={`${id}-e`}>
          <Input id={`${id}-e`} value={evidenceRef} placeholder="Where the report can be found" onChange={(e) => setEvidenceRef(e.target.value)} />
        </Field>
        <Field label="What is the plan now?" htmlFor={`${id}-p`}>
          <Textarea id={`${id}-p`} rows={3} value={plan} placeholder="What happens next" onChange={(e) => setPlan(e.target.value)} />
        </Field>
        <Field label="Next screening due (optional)" htmlFor={`${id}-n`}>
          <Input id={`${id}-n`} type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
        </Field>
        {exception && (
          <Field label="Why are you closing without a test? (at least 30 characters)" htmlFor={`${id}-j`}>
            <Textarea id={`${id}-j`} rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </Field>
        )}
        {exception && (
          <p className="text-[14px] text-slate-500">This kind of closure goes to the clinic lead for a second check before the case is closed.</p>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ hand-over dialog */

function HandOverDialog({ c, me, d, onClose }: { c: Case; me: Person; d: Dispatch; onClose: () => void }) {
  const id = useId();
  const first = firstName(c.patient.name);
  const { directory } = useHalqa();
  const staffIn = (role: Role) => directory.people.filter((p) => p.role === role);
  const specialists = staffIn('SPECIALIST').filter((p) => directory.services.some((s) => s.pathway === c.pathwayId && s.specialist === p.id));
  const people = [...staffIn('PCP'), ...(specialists.length ? specialists : staffIn('SPECIALIST'))]
    .filter((p) => p.id !== c.accountable?.id && p.id !== me.id);
  const [personId, setPersonId] = useState('');
  const [reason, setReason] = useState('');
  const ok = !!personId && reason.trim().length > 0;

  return (
    <Dialog
      title="Hand over this patient"
      onClose={onClose}
      footer={(
        <>
          <Button kind="quiet" onClick={onClose}>Cancel</Button>
          <SaveButton
            disabled={!ok}
            onClick={() => { d({ type: 'REQUEST_TRANSFER', id: c.id, personId, reason: reason.trim() }); onClose(); }}
          >
            Send request
          </SaveButton>
        </>
      )}
    >
      <p className="-mt-2 text-[16px] text-slate-500">Choose who looks after {first} next. They must accept before anything changes.</p>
      <fieldset className="mt-5">
        <legend className="sr-only">Choose a person</legend>
        <div className="space-y-3">
          {people.map((p) => {
            const on = personId === p.id;
            return (
              <label
                key={p.id}
                className={cx(
                  'flex cursor-pointer items-center gap-4 rounded-card border p-4 transition-colors focus-within:ring-2 focus-within:ring-teal-700',
                  on ? 'border-2 border-teal-700 bg-teal-50' : 'border-slate-200 bg-white hover:bg-slate-50',
                )}
              >
                <input type="radio" name={`${id}-who`} value={p.id} checked={on} onChange={() => setPersonId(p.id)} className="sr-only" />
                <Avatar initials={initialsOf(p.name)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold text-slate-900">{p.name}</span>
                  <span className="block text-[14px] text-slate-500">{TEAM_ROLE_LABEL[p.role]} · {p.org}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full', on ? 'bg-teal-700 text-white' : 'border-2 border-slate-400')}
                >
                  {on && <CheckIcon />}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <Field label="Why are you handing over?" htmlFor={`${id}-r`} className="mt-5">
        <Input id={`${id}-r`} value={reason} placeholder="The reason for the hand-over" onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}
