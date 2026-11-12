'use client';
/**
 * Approvals (Figma frame 14:296) — for the clinic lead.
 * A case closed without a test result needs a second person to approve it (two-person rule, enforced by the server).
 */
import React, { useId, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { isClosed, pathwayOf } from '@/lib/engine';
import { fmtDate } from '@/lib/time';
import { Button, Card, Chip, Empty, Field, SaveButton, Textarea } from '@/components/design/primitives';
import type { Case, ClosureKind, Escalation } from '@/types/halqa';

const KIND_TEXT: Record<ClosureKind, string> = {
  EVIDENCE: 'Closed with a test result',
  DECLINED_INFORMED: 'Declined after a clear talk',
  CARE_ELSEWHERE: 'Care completed elsewhere',
  OUT_OF_SCOPE: 'Moved away or died',
};

const BULLETS = [
  'It reminds people when a step is due soon.',
  'It tells a senior person when a step is late.',
  'It never completes a medical step or closes a case by itself.',
  'Every change is written in the case history.',
];

export function Approvals() {
  const { s, d, user } = useHalqa();

  if (user.person.role !== 'LEAD') {
    return <Empty title="Approvals" text="This page is for the clinic lead." />;
  }

  const pending = s.cases.filter((c) => c.closure?.status === 'PENDING_APPROVAL');

  const late: { c: Case; e: Escalation }[] = s.cases
    .filter((c) => !isClosed(c))
    .flatMap((c) => c.escalations.filter((e) => !e.resolvedAt).map((e) => ({ c, e })))
    .sort((a, b) => b.e.level - a.e.level || a.e.at - b.e.at);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-page-title text-slate-900">Approvals</h1>
        <p className="mt-2 text-body text-slate-700">Only a second person can approve a case that is closed without a test result.</p>
      </header>

      <Card>
        <h2 className="text-[22px] font-semibold leading-8 text-slate-900">Waiting for your decision ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-body text-slate-500">No approvals are waiting.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-200">
            {pending.map((c) => <ApprovalItem key={c.id} c={c} />)}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-[22px] font-semibold leading-8 text-slate-900">Late or stuck ({late.length})</h2>
        {late.length === 0 ? (
          <p className="mt-3 text-body text-slate-500">Nothing is late or stuck right now.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {late.map(({ c, e }) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-input bg-slate-50 px-5 py-4 sm:flex-nowrap">
                {e.level >= 2 ? <Chip tone="rose">Late</Chip> : <Chip tone="amber">Needs a decision</Chip>}
                <p className="min-w-0 flex-1 basis-full text-body text-slate-900 sm:basis-auto">
                  <span className="font-semibold">{c.patient.name}</span> — {e.reason}
                </p>
                <Button kind="secondary" onClick={() => d({ type: 'SELECT', id: c.id })} aria-label={`Open ${c.patient.name}`}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-[22px] font-semibold leading-8 text-slate-900">How the app decides what is urgent</h2>
        <ul className="mt-3 space-y-2">
          {BULLETS.map((b) => (
            <li key={b} className="flex items-start gap-3 text-body text-slate-700">
              <span aria-hidden="true" className="mt-[9px] h-2 w-2 shrink-0 rounded-full bg-teal-700" />
              {b}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ApprovalItem({ c }: { c: Case }) {
  const { d } = useHalqa();
  const noteId = useId();
  const [note, setNote] = useState('');
  const cl = c.closure!;
  const ready = note.trim().length >= 5;

  return (
    <article className="py-5 first:pt-0 last:pb-0" aria-label={`Closure for ${c.patient.name}`}>
      <h3 className="text-card-title text-slate-900">{c.patient.name} · {pathwayOf(c).short}</h3>
      <p className="mt-1 text-body text-slate-700">{cl.outcome}</p>
      <p className="mt-1 text-small font-semibold text-slate-700">{KIND_TEXT[cl.kind]}</p>

      {cl.justification && (
        <div className="mt-4 rounded-input bg-teal-50 p-4">
          <p className="text-small font-semibold text-teal-800">Doctor&apos;s note</p>
          <blockquote className="mt-1 text-body text-slate-900">&ldquo;{cl.justification}&rdquo;</blockquote>
        </div>
      )}

      <p className="mt-3 text-small text-slate-500">
        Submitted by {cl.signedBy} on {fmtDate(cl.signedAt)} · evidence {cl.evidenceRef}
      </p>

      <Field label="Your decision note (at least 5 characters)" htmlFor={noteId} className="mt-4">
        <Textarea id={noteId} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="mt-4 flex flex-wrap gap-3">
        <SaveButton kind="success" disabled={!ready} onClick={() => { d({ type: 'APPROVE_CLOSURE', id: c.id, approve: true, note: note.trim() }); setNote(''); }}>
          Approve
        </SaveButton>
        <SaveButton kind="secondary" disabled={!ready} onClick={() => { d({ type: 'APPROVE_CLOSURE', id: c.id, approve: false, note: note.trim() }); setNote(''); }}>
          Send back to the doctor
        </SaveButton>
        <Button kind="quiet" onClick={() => d({ type: 'SELECT', id: c.id })}>Open case</Button>
      </div>
    </article>
  );
}
