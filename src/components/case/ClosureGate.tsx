'use client';

import React, { useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { Case, ClosureKind } from '@/types/halqa';
import { pathwayOf, fmtDateTime, isClosed, actorFor } from '@/lib/engine';
import { ROLE_LABEL } from '@/lib/pathways';
import { Btn, Field, inputCls, cx, Badge } from '../ui';
import { Lock, ShieldCheck, CheckCircle2, XCircle, FileSignature, Users } from 'lucide-react';
import confetti from 'canvas-confetti';

const KIND_LABEL: Record<ClosureKind, string> = {
  EVIDENCE: 'Standard — diagnostic evidence + plan',
  DECLINED_INFORMED: 'Exception — patient declined after informed discussion',
  CARE_ELSEWHERE: 'Exception — care completed at another provider',
  OUT_OF_SCOPE: 'Exception — moved out of jurisdiction / deceased (with handover)',
};

export function ClosureGate({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const p = pathwayOf(c);
  const actor = actorFor(c, s.role);
  const [kind, setKind] = useState<ClosureKind>('EVIDENCE');
  const reportMatch = (c.steps.OUTCOME?.note ?? c.steps.CONFIRM_TEST?.note ?? '').match(/(HIS|RPT|LAB)-[\w-]+/);
  const [outcome, setOutcome] = useState(c.steps.OUTCOME?.note?.replace(/\s*\(report.*\)$/, '') ?? c.steps.CONFIRM_TEST?.note ?? '');
  const [evidenceRef, setEvidenceRef] = useState(reportMatch?.[0] ?? '');
  const [plan, setPlan] = useState(c.steps.CARE_PLAN?.note ?? '');
  const [next, setNext] = useState('');
  const [just, setJust] = useState('');
  const [approveNote, setApproveNote] = useState('');

  if (isClosed(c) && c.closure) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4">
        <div className="flex items-center gap-2 font-bold text-emerald-800"><ShieldCheck className="w-5 h-5" />Loop closed — documented & signed</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-xs">
          <Item k="Closure type" v={KIND_LABEL[c.closure.kind]} />
          <Item k="Outcome" v={c.closure.outcome} />
          <Item k="Evidence" v={c.closure.evidenceRef} />
          <Item k="Plan" v={c.closure.plan} />
          <Item k="Signed" v={`${c.closure.signedBy} (${c.closure.signedLicence}) · ${fmtDateTime(c.closure.signedAt)}`} />
          {c.closure.approvedBy && <Item k="2nd approver" v={`${c.closure.approvedBy} · ${fmtDateTime(c.closure.approvedAt!)}`} />}
          {c.closure.nextScreeningDue && <Item k="Next screening due" v={c.closure.nextScreeningDue} />}
        </dl>
      </div>
    );
  }

  if (c.closure?.status === 'PENDING_APPROVAL') {
    const canApprove = s.role === 'LEAD';
    return (
      <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 font-bold text-indigo-900"><Users className="w-5 h-5" />Exception closure — awaiting second approver</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Item k="Type" v={KIND_LABEL[c.closure.kind]} />
          <Item k="Submitted by" v={`${c.closure.signedBy} (${c.closure.signedLicence})`} />
          <Item k="Outcome" v={c.closure.outcome} />
          <Item k="Evidence" v={c.closure.evidenceRef} />
          <div className="col-span-2"><Item k="Justification" v={c.closure.justification ?? '—'} /></div>
          <div className="col-span-2"><Item k="Safety-net plan" v={c.closure.plan} /></div>
        </dl>
        {canApprove ? (
          <div className="space-y-2">
            <input value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="Governance decision note…" className={inputCls} />
            <div className="flex gap-2">
              <Btn tone="success" onClick={() => d({ type: 'APPROVE_CLOSURE', id: c.id, approve: true, note: approveNote || 'Reviewed — documentation adequate' })}><CheckCircle2 className="w-4 h-4" />Approve closure</Btn>
              <Btn tone="danger" onClick={() => d({ type: 'APPROVE_CLOSURE', id: c.id, approve: false, note: approveNote || 'Insufficient documentation — reopen' })}><XCircle className="w-4 h-4" />Reject & reopen</Btn>
            </div>
          </div>
        ) : (
          <div className="text-xs text-indigo-800 flex items-center gap-2">
            Only the Clinical Governance Lead can approve.
            <Btn size="sm" tone="secondary" onClick={() => d({ type: 'ROLE', role: 'LEAD' })}>Switch to Governance Lead</Btn>
          </div>
        )}
      </div>
    );
  }

  const priorSteps = p.steps.filter((x) => x.id !== 'CLOSE');
  const missing = priorSteps.filter((x) => !c.steps[x.id]?.completedAt);
  const hasResult = !!(c.steps.OUTCOME?.completedAt || c.steps.CONFIRM_TEST?.completedAt);
  const hasPlan = !!c.steps.CARE_PLAN?.completedAt;
  const isClinician = s.role === 'PCP' || s.role === 'SPECIALIST';
  const openL2 = c.escalations.some((e) => !e.resolvedAt && e.level >= 2);

  const checks = kind === 'EVIDENCE'
    ? [
      { ok: missing.length === 0, text: missing.length ? `All pathway steps complete — missing: ${missing.map((m) => m.label).join(', ')}` : 'All pathway steps complete' },
      { ok: hasResult, text: 'Diagnostic / confirmatory result recorded' },
      { ok: hasPlan, text: 'Treatment or surveillance plan documented' },
      { ok: evidenceRef.trim().length >= 4, text: 'Evidence reference (report / document ID) attached' },
      { ok: isClinician, text: `Signed by a licensed clinician (you are acting as ${ROLE_LABEL[s.role]})` },
      { ok: !openL2, text: 'No open Level-2 safety escalation' },
    ]
    : [
      { ok: just.trim().length >= 30, text: 'Written justification (≥ 30 characters)' },
      { ok: evidenceRef.trim().length >= 4, text: 'Supporting document reference (consent note / external report)' },
      { ok: plan.trim().length >= 5, text: 'Safety-net plan (re-entry, recall date)' },
      { ok: isClinician, text: `Submitted by a licensed clinician (you are acting as ${ROLE_LABEL[s.role]})` },
      { ok: true, text: 'Second approver (Clinical Governance Lead) will be required' },
    ];
  const allOk = checks.every((x) => x.ok);

  const submit = () => {
    d({ type: 'CLOSE_CASE', id: c.id, closure: { kind, outcome: outcome || (kind === 'EVIDENCE' ? 'Completed' : KIND_LABEL[kind]), evidenceRef, plan, nextScreeningDue: next || undefined, justification: kind !== 'EVIDENCE' ? just : undefined } });
    if (kind === 'EVIDENCE') confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ['#0f766e', '#14b8a6', '#10b981', '#f59e0b'] });
  };

  return (
    <div className={cx('rounded-xl border p-4 space-y-3', allOk ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/60')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-slate-900"><Lock className="w-4 h-4 text-slate-500" />Closure gate</div>
        <Badge tone={allOk ? 'emerald' : 'slate'}>{checks.filter((x) => x.ok).length}/{checks.length} requirements met</Badge>
      </div>
      <p className="text-xs text-slate-500 -mt-1">A case can only be closed with documented evidence, or by an authorised human decision with a second approver. Nothing closes automatically.</p>

      <Field label="Closure type">
        <select value={kind} onChange={(e) => setKind(e.target.value as ClosureKind)} className={inputCls}>
          {(Object.keys(KIND_LABEL) as ClosureKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </Field>

      <ul className="space-y-1">
        {checks.map((x, i) => (
          <li key={i} className={cx('text-xs flex items-start gap-1.5', x.ok ? 'text-emerald-800' : 'text-slate-500')}>
            {x.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />}{x.text}
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Outcome"><input value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputCls} placeholder="e.g. Adenoma removed" /></Field>
        <Field label="Evidence reference"><input value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} className={inputCls} placeholder="e.g. HIS-26-55120" /></Field>
        <div className="col-span-2"><Field label={kind === 'EVIDENCE' ? 'Treatment / surveillance plan' : 'Safety-net plan'}><input value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls} /></Field></div>
        {kind !== 'EVIDENCE' && <div className="col-span-2"><Field label="Justification"><textarea value={just} onChange={(e) => setJust(e.target.value)} rows={2} className={inputCls} placeholder="Capacity, discussion held, language used, information given…" /></Field></div>}
        <Field label="Next screening due"><input value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} placeholder="e.g. Nov 2029" /></Field>
        <Field label="Signature"><div className="text-xs py-2 text-slate-700 flex items-center gap-1.5"><FileSignature className="w-4 h-4 text-teal-600" />{actor.name} {actor.licence ? `(${actor.licence})` : ''}</div></Field>
      </div>

      <div className="flex items-center gap-2">
        <Btn tone={kind === 'EVIDENCE' ? 'success' : 'primary'} disabled={!allOk} onClick={submit}>
          <ShieldCheck className="w-4 h-4" />{kind === 'EVIDENCE' ? 'Sign & close loop' : 'Submit for 2nd approval'}
        </Btn>
        {!isClinician && <Btn size="sm" tone="ghost" onClick={() => d({ type: 'ROLE', role: 'PCP' })}>Switch to PCP</Btn>}
      </div>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-[10px] uppercase font-bold text-slate-400">{k}</dt><dd className="text-slate-800">{v}</dd></div>;
}
