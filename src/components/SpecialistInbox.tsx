'use client';

import React, { useEffect, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { Case } from '@/types/halqa';
import { caseStatus, fmtDateTime, isClosed, pathwayOf, currentStep, fmtDuration } from '@/lib/engine';
import { SPECIALIST_SERVICES, REJECT_REASONS } from '@/lib/pathways';
import { LANGS } from '@/lib/i18n';
import { Card, Btn, Badge, UrgencyBadge, PathwayBadge, SlaPill, inputCls, cx } from './ui';
import { Inbox, CheckCircle2, XCircle, HelpCircle, Stethoscope, ClipboardList, Building2 } from 'lucide-react';

const FACILITIES = Array.from(new Set(SPECIALIST_SERVICES.map((s) => s.facility)));

export function SpecialistInbox() {
  const { s, d } = useHalqa();
  const [fac, setFac] = useState<string>('ALL');
  useEffect(() => { if (s.role !== 'SPECIALIST') d({ type: 'ROLE', role: 'SPECIALIST' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = s.cases.filter((c) => !isClosed(c) && !c.historical);
  const inFac = (c: Case) => fac === 'ALL' || c.referral?.facility === fac;
  const rank = { CRITICAL: 0, ELEVATED: 1, ROUTINE: 2 };
  const incoming = open.filter((c) => c.referral?.status === 'SENT' && inFac(c)).sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.referral!.sentAt - b.referral!.sentAt);
  const econsults = open.filter((c) => [...c.messages].reverse().find((m) => m.thread === 'ECONSULT')?.fromRole === 'PCP' && inFac(c));
  const mine = open.filter((c) => c.referral?.status === 'ACCEPTED' && inFac(c) && ['BOOK', 'ATTEND', 'OUTCOME', 'CARE_PLAN'].includes(currentStep(c)?.id ?? ''));

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div>
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Inbox className="w-5 h-5 text-teal-600" />Specialist referral inbox</h2>
          <p className="text-xs text-slate-500">Every referral must be explicitly <b>accepted</b> (custody confirmed) or <b>rejected with a reason</b> — rejected referrals return to the referring PCP automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-400" />
          <select value={fac} onChange={(e) => setFac(e.target.value)} className={cx(inputCls, 'text-xs w-auto')}>
            <option value="ALL">All receiving services</option>
            {FACILITIES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
      </Card>

      <div className="grid xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">New referrals awaiting decision ({incoming.length})</h3>
          {incoming.map((c) => <ReferralCard key={c.id} c={c} />)}
          {!incoming.length && <Card className="p-8 text-center text-sm text-slate-400"><CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400 mb-1" />No referrals waiting. Try “Simulate incoming lab result” and send a referral from the Command Centre.</Card>}

          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 pt-2">Accepted — in my custody ({mine.length})</h3>
          <Card className="divide-y divide-slate-100">
            {mine.map((c) => {
              const st = caseStatus(c, s.now);
              return (
                <button key={c.id} onClick={() => d({ type: 'SELECT', id: c.id })} className="w-full text-left p-3 hover:bg-slate-50 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{c.patient.name} <span className="font-mono text-[11px] text-slate-400">{c.id}</span></div>
                    <div className="text-[11px] text-slate-500">{c.referral?.facility} · next: {st.step?.label}</div>
                  </div>
                  <PathwayBadge c={c} /><SlaPill c={c} now={s.now} />
                </button>
              );
            })}
            {!mine.length && <div className="p-4 text-xs text-slate-400">No accepted cases in progress.</div>}
          </Card>
        </div>

        <div className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">E-consult questions from PCPs ({econsults.length})</h3>
          {econsults.map((c) => <EconsultCard key={c.id} c={c} />)}
          {!econsults.length && <Card className="p-4 text-xs text-slate-400">No e-consult questions waiting.</Card>}
        </div>
      </div>
    </div>
  );
}

function ReferralCard({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [mode, setMode] = useState<'none' | 'reject' | 'info'>('none');
  const [info, setInfo] = useState('Please add current medications and anticoagulant status.');
  const r = c.referral!;
  const p = pathwayOf(c);
  const waited = s.now - r.sentAt;
  const lang = LANGS.find((l) => l.id === c.patient.lang)!;
  return (
    <Card className={cx('p-4', c.urgency === 'CRITICAL' && 'border-rose-300')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5"><PathwayBadge c={c} /><UrgencyBadge u={c.urgency} /><Badge tone={r.priority === 'URGENT' ? 'rose' : 'slate'}>{r.priority}</Badge>{r.attempts > 1 && <Badge tone="amber">Re-routed (attempt {r.attempts})</Badge>}</div>
          <div className="text-base font-bold text-slate-900 mt-1">{c.patient.name} <span className="text-xs font-normal text-slate-500">{c.patient.age}{c.patient.sex} · {lang.label}{c.patient.needsInterpreter ? ' · interpreter' : ''}</span></div>
          <div className="text-xs text-slate-500">To <b>{r.facility}</b> from {c.team.PCP?.name} ({c.team.PCP?.org}) · sent {fmtDateTime(r.sentAt)} · waiting {fmtDuration(waited)}</div>
        </div>
        <SlaPill c={c} now={s.now} />
      </div>
      <div className="mt-3 grid md:grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5"><div className="text-[10px] font-bold uppercase text-amber-700">Screening finding</div><div className="font-semibold text-slate-800">{c.finding}</div></div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5"><div className="text-[10px] font-bold uppercase text-slate-500">Requested</div><div className="font-semibold text-slate-800">{p.diagnosticTest} · target ≤ {Math.round(p.targetDaysToDiagnosis * (c.urgency === 'CRITICAL' ? 0.5 : c.urgency === 'ROUTINE' ? 1.5 : 1))} days from result</div></div>
        <div className="md:col-span-2 rounded-lg bg-slate-50 border border-slate-200 p-2.5"><div className="text-[10px] font-bold uppercase text-slate-500">Referral packet</div><div className="text-slate-700">{r.note}</div></div>
      </div>
      {mode === 'none' && (
        <div className="flex flex-wrap gap-2 mt-3">
          <Btn tone="success" onClick={() => d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'ACCEPT' })}><CheckCircle2 className="w-4 h-4" />Accept custody</Btn>
          <Btn tone="secondary" onClick={() => setMode('info')}><HelpCircle className="w-4 h-4" />Request info</Btn>
          <Btn tone="secondary" onClick={() => setMode('reject')}><XCircle className="w-4 h-4 text-rose-500" />Reject…</Btn>
          <Btn tone="ghost" onClick={() => d({ type: 'SELECT', id: c.id })}>Open full case</Btn>
        </div>
      )}
      {mode === 'reject' && (
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          <select value={reason} onChange={(e) => setReason(e.target.value)} className={cx(inputCls, 'w-auto text-xs')}>{REJECT_REASONS.map((x) => <option key={x}>{x}</option>)}</select>
          <Btn tone="danger" onClick={() => d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'REJECT', reason })}>Confirm reject → return to PCP</Btn>
          <Btn tone="ghost" onClick={() => setMode('none')}>Cancel</Btn>
        </div>
      )}
      {mode === 'info' && (
        <div className="flex gap-2 mt-3">
          <input value={info} onChange={(e) => setInfo(e.target.value)} className={cx(inputCls, 'text-xs')} />
          <Btn tone="warn" onClick={() => d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'INFO', reason: info })}>Send request</Btn>
          <Btn tone="ghost" onClick={() => setMode('none')}>Cancel</Btn>
        </div>
      )}
    </Card>
  );
}

function EconsultCard({ c }: { c: Case }) {
  const { d } = useHalqa();
  const [txt, setTxt] = useState('');
  const thread = c.messages.filter((m) => m.thread === 'ECONSULT');
  const last = thread[thread.length - 1];
  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><Stethoscope className="w-4 h-4 text-teal-600" />{c.patient.name}</div>
        <PathwayBadge c={c} />
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{last.from} · {fmtDateTime(last.at)}</div>
      <div className="mt-2 text-xs bg-slate-100 rounded-lg p-2.5 text-slate-800">{last.text}</div>
      <div className="flex gap-2 mt-2">
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Reply as specialist…" className={cx(inputCls, 'text-xs')} />
        <Btn size="sm" tone="primary" disabled={!txt.trim()} onClick={() => { d({ type: 'MESSAGE', id: c.id, thread: 'ECONSULT', text: txt }); setTxt(''); }}>Reply</Btn>
      </div>
      <button onClick={() => setTxt('Histology is being expedited — expected within 48h. I will call the patient myself with the result. First-degree relatives should be offered screening; I’ll include advice in the clinic letter.')} className="text-[11px] text-teal-700 mt-1.5 flex items-center gap-1"><ClipboardList className="w-3 h-3" />Insert suggested reply</button>
    </Card>
  );
}
