'use client';
/**
 * Referrals (Figma frame 13:138) — for specialists.
 * Accept the patients who should come to you, ask for more information, or send the referral back with a reason.
 * The server decides what this user may see and do; this screen shows every SENT referral in s.cases.
 */
import React, { useId, useMemo, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { currentStep, isClosed, pathwayOf } from '@/lib/engine';
import { fmtDate, fmtDateTime, friendlyDuration } from '@/lib/time';
import { Button, Card, Chip, Dialog, Empty, Field, SaveButton, Select, Textarea, Tone, cx } from '@/components/design/primitives';
import type { Case, Lang, PathwayId, StepId, Urgency } from '@/types/halqa';

const PATHWAY_TONE: Record<PathwayId, Tone> = {
  CRC_FIT: 'sky',
  BREAST_BIRADS: 'violet',
  CERVICAL_HPV: 'violet',
  DIABETES_HBA1C: 'teal',
};

const URGENCY: Record<Urgency, { tone: Tone; label: string; factor: number }> = {
  CRITICAL: { tone: 'rose', label: 'Needs you now', factor: 0.5 },
  ELEVATED: { tone: 'amber', label: 'Soon', factor: 1 },
  ROUTINE: { tone: 'slate', label: 'Routine', factor: 1.5 },
};

const LANGUAGE: Record<Lang, string> = { en: 'English', ar: 'Arabic', hi: 'Hindi', ur: 'Urdu' };

const NEXT_STEP: Partial<Record<StepId, string>> = {
  BOOK: 'booking next',
  ATTEND: 'test next',
  OUTCOME: 'result next',
  CARE_PLAN: 'care plan next',
};

/** Send-back reasons in the design's plain wording. First is the default. */
const SEND_BACK_REASONS = [
  'Wrong service — send to another unit',
  'Not enough information yet',
  'Outside our area',
  'No space in the time we need',
];

const ACCEPTED_STEPS: StepId[] = ['BOOK', 'ATTEND', 'OUTCOME', 'CARE_PLAN'];

function PathwayChip({ c }: { c: Case }) {
  return <Chip tone={PATHWAY_TONE[c.pathwayId]}>{pathwayOf(c).short}</Chip>;
}

export function Referrals() {
  const { s } = useHalqa();
  const filterId = useId();
  const [facility, setFacility] = useState('ALL');

  const facilities = useMemo(
    () => Array.from(new Set(s.cases.map((c) => c.referral?.facility).filter((f): f is string => !!f))).sort(),
    [s.cases],
  );

  const open = s.cases.filter((c) => !isClosed(c) && (facility === 'ALL' || c.referral?.facility === facility));
  const waiting = open
    .filter((c) => c.referral?.status === 'SENT')
    .sort((a, b) => (a.urgency === 'CRITICAL' ? 0 : 1) - (b.urgency === 'CRITICAL' ? 0 : 1) || a.referral!.sentAt - b.referral!.sentAt);
  const questions = open.filter((c) => {
    const thread = c.messages.filter((m) => m.thread === 'ECONSULT');
    return thread.length > 0 && thread[thread.length - 1].fromRole === 'PCP';
  });
  const accepted = open.filter((c) => {
    const step = currentStep(c);
    return c.referral?.status === 'ACCEPTED' && !!step && ACCEPTED_STEPS.includes(step.id);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-page-title text-slate-900">Referrals</h1>
        <p className="mt-2 text-body text-slate-700">
          Accept the patients who should come to you. If you cannot help, send the referral back with a reason.
        </p>
      </header>

      {facilities.length > 1 && (
        <Field label="Receiving service" htmlFor={filterId} className="max-w-sm">
          <Select id={filterId} value={facility} onChange={(e) => setFacility(e.target.value)}>
            <option value="ALL">All services</option>
            {facilities.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <section aria-labelledby="waiting-heading" className="min-w-0 space-y-6">
          <h2 id="waiting-heading" className="sr-only">Waiting for your decision ({waiting.length})</h2>
          {waiting.length === 0 ? (
            <Empty title="Nothing waiting for you" text="No referrals are waiting. You are all caught up." />
          ) : (
            waiting.map((c) => <ReferralCard key={c.id} c={c} />)
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <Card>
            <h2 className="text-card-title text-slate-900">Questions from doctors ({questions.length})</h2>
            {questions.length === 0 ? (
              <p className="mt-3 text-body text-slate-500">No questions from doctors right now.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-200">
                {questions.map((c) => <QuestionRow key={c.id} c={c} />)}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-card-title text-slate-900">Accepted ({accepted.length})</h2>
            {accepted.length === 0 ? (
              <p className="mt-3 text-body text-slate-500">No accepted patients are waiting on you.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {accepted.map((c) => <AcceptedRow key={c.id} c={c} />)}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Referral card */

function ReferralCard({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const infoId = useId();
  const ref = c.referral!;
  const pw = pathwayOf(c);
  const urgency = URGENCY[c.urgency];
  const days = Math.round(pw.targetDaysToDiagnosis * urgency.factor);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const pcp = c.team.PCP;
  const sentBack = Math.max(0, ref.attempts - 1);

  return (
    <Card as="article" aria-label={`Referral for ${c.patient.name}`}>
      <div className="flex flex-wrap gap-2">
        <PathwayChip c={c} />
        <Chip tone={urgency.tone}>{urgency.label}</Chip>
        {sentBack > 0 && <Chip tone="amber">{sentBack === 1 ? 'Sent back once' : `Sent back ${sentBack} times`}</Chip>}
      </div>

      <h3 className="mt-4 text-[24px] font-semibold leading-8 text-slate-900">
        {c.patient.name} · {c.patient.age} · speaks {LANGUAGE[c.patient.lang]}
      </h3>
      <p className="mt-1 text-small text-slate-500">
        From {pcp?.name ?? 'the referring doctor'}{pcp?.org ? ` at ${pcp.org}` : ''} · sent {fmtDateTime(ref.sentAt)} · waiting {friendlyDuration(s.now - ref.sentAt)}
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-input bg-slate-50 p-4">
          <p className="text-small text-slate-500">What was found</p>
          <p className="mt-1 text-body font-semibold text-slate-900">{c.finding}</p>
        </div>
        <div className="rounded-input bg-slate-50 p-4">
          <p className="text-small text-slate-500">What is needed</p>
          <p className="mt-1 text-body font-semibold text-slate-900">{pw.diagnosticTest} within {days} days</p>
        </div>
      </div>

      {ref.note && (
        <div className="mt-4 rounded-input bg-teal-50 p-4">
          <p className="text-small font-semibold text-teal-800">Doctor&apos;s message</p>
          <p className="mt-1 text-body text-slate-900">{ref.note}</p>
        </div>
      )}

      {asking ? (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim().length < 5) return;
            d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'INFO', reason: question.trim() });
            setAsking(false);
            setQuestion('');
          }}
        >
          <Field label="What do you need from the doctor?" hint="At least 5 characters." htmlFor={infoId}>
            <Textarea id={infoId} rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus />
          </Field>
          <div className="flex flex-wrap gap-3">
            <SaveButton type="submit" kind="primary" disabled={question.trim().length < 5}>Send question</SaveButton>
            <Button kind="quiet" onClick={() => { setAsking(false); setQuestion(''); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <SaveButton kind="success" onClick={() => d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'ACCEPT' })}>Accept</SaveButton>
          <Button kind="secondary" onClick={() => setAsking(true)}>Ask for more information</Button>
          <Button kind="danger" onClick={() => setSendingBack(true)}>Send back</Button>
        </div>
      )}

      {sendingBack && <SendBackDialog c={c} onClose={() => setSendingBack(false)} />}
    </Card>
  );
}

function SendBackDialog({ c, onClose }: { c: Case; onClose: () => void }) {
  const { d } = useHalqa();
  const name = useId();
  const [reason, setReason] = useState(SEND_BACK_REASONS[0]);
  return (
    <Dialog
      title="Send this referral back?"
      onClose={onClose}
      footer={
        <>
          <Button kind="quiet" onClick={onClose}>Cancel</Button>
          <SaveButton
            kind="danger"
            onClick={() => {
              d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'REJECT', reason });
              onClose();
            }}
          >
            Send back
          </SaveButton>
        </>
      }
    >
      <p>Tell the doctor why. They see it straight away and can send it to another service.</p>
      <fieldset className="mt-4">
        <legend className="sr-only">Reason for sending {c.patient.name}&apos;s referral back</legend>
        <div className="space-y-2">
          {SEND_BACK_REASONS.map((r) => (
            <label
              key={r}
              className={cx(
                'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-input border px-4 py-3 text-body',
                reason === r ? 'border-teal-700 bg-teal-50 text-slate-900' : 'border-slate-200 bg-white text-slate-700',
              )}
            >
              <input type="radio" name={name} value={r} checked={reason === r} onChange={() => setReason(r)} className="h-5 w-5 accent-teal-700" />
              {r}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-small text-slate-500">The doctor will be told the reason.</p>
    </Dialog>
  );
}

/* ------------------------------------------------------------- Right column */

function QuestionRow({ c }: { c: Case }) {
  const { d } = useHalqa();
  const replyId = useId();
  const [text, setText] = useState('');
  const thread = c.messages.filter((m) => m.thread === 'ECONSULT');
  const last = thread[thread.length - 1];
  return (
    <form
      className="py-4 first:pt-0 last:pb-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        d({ type: 'MESSAGE', id: c.id, thread: 'ECONSULT', text: text.trim() });
        setText('');
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body font-semibold text-slate-900">{c.patient.name}</p>
        <PathwayChip c={c} />
      </div>
      <blockquote className="mt-3 text-body text-slate-700">&ldquo;{last.text}&rdquo;</blockquote>
      <label htmlFor={replyId} className="sr-only">Reply about {c.patient.name}</label>
      <Textarea id={replyId} className="mt-4" rows={3} placeholder="Type your reply…" value={text} onChange={(e) => setText(e.target.value)} />
      <SaveButton type="submit" kind="primary" full className="mt-4" disabled={!text.trim()}>Send reply</SaveButton>
    </form>
  );
}

function AcceptedRow({ c }: { c: Case }) {
  const { d } = useHalqa();
  const step = currentStep(c);
  return (
    <li>
      <div className="rounded-input bg-slate-50 p-4">
        <p className="text-body font-semibold text-slate-900">{c.patient.name}</p>
        <p className="text-small text-slate-700">
          {pathwayOf(c).short} · {(step && NEXT_STEP[step.id]) ?? step?.label.toLowerCase()}
        </p>
        {c.referral?.respondedAt && <p className="text-small text-slate-500">Accepted {fmtDate(c.referral.respondedAt)}</p>}
      </div>
      <Button kind="secondary" full className="mt-3" onClick={() => d({ type: 'SELECT', id: c.id })} aria-label={`Open ${c.patient.name}`}>
        Open
      </Button>
    </li>
  );
}
