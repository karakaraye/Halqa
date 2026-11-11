'use client';

import React, { useState } from 'react';
import { useHalqa, useCase } from '@/context/HalqaStore';
import { Case } from '@/types/halqa';
import { caseStatus, pathwayOf, stepStart, slaMs, fmtDateTime, fmtDuration, actionItems, isClosed, currentStep, DELAY_LABEL } from '@/lib/engine';
import { STAFF_BY_ROLE, ROLE_LABEL, ESCALATION_RULES } from '@/lib/pathways';
import { LANGS } from '@/lib/i18n';
import { toFhirBundle, downloadJson } from '@/lib/fhir';
import { Btn, Badge, UrgencyBadge, PathwayBadge, SlaPill, SectionTitle, inputCls, cx } from '../ui';
import { NextAction } from './NextAction';
import { ClosureGate } from './ClosureGate';
import {
  X, FileJson, Users, ShieldAlert, MessageSquare, History, CheckCircle2, Circle, AlertTriangle, ArrowRightLeft, Stethoscope, Smartphone, Languages, HeartHandshake,
} from 'lucide-react';

export function CaseDrawer() {
  const { s, d } = useHalqa();
  const c = useCase(s.selectedId);
  const [tab, setTab] = useState<'journey' | 'comms' | 'audit'>('journey');
  if (!c) return null;
  const st = caseStatus(c, s.now);
  const items = actionItems(c, s.now);
  const lang = LANGS.find((l) => l.id === c.patient.lang)!;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => d({ type: 'SELECT', id: null })} />
      <aside className="relative w-full max-w-[880px] h-full bg-slate-50 shadow-2xl flex flex-col animate-[slidein_.2s_ease-out]">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">{c.id}</span>
                <PathwayBadge c={c} /><UrgencyBadge u={c.urgency} /><SlaPill c={c} now={s.now} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1.5">{c.patient.name} <span className="text-sm font-normal text-slate-500">{c.patient.age}{c.patient.sex} · {c.patient.id}</span></h2>
              <div className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-slate-800">{c.finding}</span>
                <span>from {c.sourceLab} · {fmtDateTime(c.issuedAt)}</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1"><Languages className="w-3 h-3" />{lang.label}</span>
                <span className="flex items-center gap-1"><Smartphone className="w-3 h-3" />Prefers {c.patient.preferredChannel}</span>
                <span>{c.patient.phone}</span>
                {c.patient.nationality && <span>{c.patient.nationality}</span>}
                {c.patient.needsInterpreter && <Badge tone="violet">Interpreter needed</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Btn size="sm" tone="secondary" onClick={() => downloadJson(`${c.id}-fhir-bundle.json`, toFhirBundle(c))}><FileJson className="w-3.5 h-3.5" />FHIR</Btn>
              <button onClick={() => d({ type: 'SELECT', id: null })} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
            </div>
          </div>
          <div className="flex gap-1 mt-3 -mb-1">
            {(['journey', 'comms', 'audit'] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={cx('px-3 py-1.5 text-xs font-semibold rounded-lg', tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
                {k === 'journey' ? 'Journey & actions' : k === 'comms' ? `Communication (${c.messages.length + c.notifications.length})` : `Audit trail (${c.audit.length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {items.filter((i) => i.severity >= 2).length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-1">
              {items.filter((i) => i.severity >= 2).map((i, k) => (
                <div key={k} className="text-xs font-semibold text-rose-800 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{i.text}</div>
              ))}
            </div>
          )}

          {tab === 'journey' && (
            <>
              <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
                <div className="space-y-4">
                  <NextAction key={`${c.id}-${currentStep(c)?.id}`} c={c} />
                  <Escalations c={c} />
                  <PatientVoice c={c} />
                  <ClosureGate key={`${c.id}-${currentStep(c)?.id}-${c.closure?.status}`} c={c} />
                </div>
                <div className="space-y-4">
                  <Ownership c={c} />
                  <Timeline c={c} />
                </div>
              </div>
            </>
          )}
          {tab === 'comms' && <Comms c={c} />}
          {tab === 'audit' && <Audit c={c} />}
        </div>
      </aside>
    </div>
  );
}

function Timeline({ c }: { c: Case }) {
  const { s } = useHalqa();
  const p = pathwayOf(c);
  const cur = currentStep(c);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <SectionTitle icon={<Stethoscope className="w-3.5 h-3.5" />}>End-to-end journey</SectionTitle>
      <ol className="relative mt-2">
        <li className="flex gap-3 pb-3">
          <div className="flex flex-col items-center"><CheckCircle2 className="w-5 h-5 text-teal-600" /><div className="w-px flex-1 bg-teal-200 mt-1" /></div>
          <div className="text-xs pb-1"><div className="font-semibold text-slate-800">Result issued</div><div className="text-slate-500">{fmtDateTime(c.issuedAt)}</div></div>
        </li>
        {p.steps.map((step, i) => {
          const rec = c.steps[step.id];
          const done = !!rec?.completedAt;
          const isCur = cur?.id === step.id && !isClosed(c);
          const start = stepStart(c, step);
          const sla = slaMs(c, step);
          const took = done ? rec!.completedAt! - start : s.now - start;
          const late = took > sla;
          const skipped = !done && c.closure && (c.closure.kind !== 'EVIDENCE');
          return (
            <li key={step.id} className="flex gap-3 pb-3 last:pb-0">
              <div className="flex flex-col items-center">
                {done ? <CheckCircle2 className={cx('w-5 h-5', late ? 'text-amber-500' : 'text-teal-600')} /> : isCur ? <span className="w-5 h-5 rounded-full bg-amber-400 ring-4 ring-amber-100 animate-pulse" /> : <Circle className="w-5 h-5 text-slate-300" />}
                {i < p.steps.length - 1 && <div className={cx('w-px flex-1 mt-1', done ? 'bg-teal-200' : 'bg-slate-200')} />}
              </div>
              <div className="text-xs min-w-0 pb-1">
                <div className={cx('font-semibold', done ? 'text-slate-800' : isCur ? 'text-amber-800' : 'text-slate-400')}>{step.label}</div>
                {done && (
                  <div className="text-slate-500">
                    {fmtDateTime(rec!.completedAt!)} · <span className={late ? 'text-amber-700 font-semibold' : 'text-teal-700'}>{fmtDuration(took)}{late ? ` (target ${fmtDuration(sla)})` : ' ✓'}</span>
                    <div className="truncate" title={rec!.note}>{rec!.by}</div>
                  </div>
                )}
                {isCur && <div className={cx(late ? 'text-rose-600 font-semibold' : 'text-slate-500')}>{late ? `Overdue by ${fmtDuration(took - sla)}` : `Due in ${fmtDuration(sla - took)}`} · {ROLE_LABEL[step.ownerRole]}</div>}
                {skipped && <div className="text-slate-400 italic">Not required — exception closure</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Ownership({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const st = caseStatus(c, s.now);
  const [showTransfer, setShowTransfer] = useState(false);
  const [to, setTo] = useState(STAFF_BY_ROLE.PCP.find((p) => p.id !== c.accountable?.id)?.id ?? 'pcp_arjun');
  const [reason, setReason] = useState('Patient moved to a new primary care centre');
  const roles: ('NAVIGATOR' | 'PCP' | 'SPECIALIST')[] = ['NAVIGATOR', 'PCP', 'SPECIALIST'];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <SectionTitle icon={<Users className="w-3.5 h-3.5" />}>Ownership</SectionTitle>
      <div className={cx('rounded-lg p-2.5 border', c.accountable ? 'bg-teal-50 border-teal-200' : 'bg-rose-50 border-rose-200')}>
        <div className="text-[10px] uppercase font-bold text-slate-500">Accountable clinician (end-to-end)</div>
        <div className={cx('text-sm font-bold', c.accountable ? 'text-teal-900' : 'text-rose-700')}>{c.accountable?.name ?? 'NONE — assign now'}</div>
        {c.accountable && <div className="text-[11px] text-slate-600">{c.accountable.org}</div>}
      </div>
      <div className="rounded-lg p-2.5 border border-amber-200 bg-amber-50/60">
        <div className="text-[10px] uppercase font-bold text-slate-500">Owns the current step</div>
        <div className={cx('text-sm font-semibold', st.unassigned ? 'text-rose-700' : 'text-slate-900')}>{st.ownerName}</div>
        <div className="text-[11px] text-slate-600">{st.ownerDetail}</div>
      </div>
      <div className="space-y-1.5">
        {roles.map((r) => (
          <div key={r} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 w-20 shrink-0">{r === 'NAVIGATOR' ? 'Navigator' : r === 'PCP' ? 'PCP' : 'Specialist'}</span>
            <select value={c.team[r]?.id ?? ''} onChange={(e) => e.target.value && d({ type: 'ASSIGN', id: c.id, role: r, personId: e.target.value })}
              className={cx('flex-1 min-w-0 text-xs border rounded-md px-1.5 py-1', c.team[r] ? 'border-slate-200 text-slate-800' : 'border-rose-300 text-rose-600 bg-rose-50')}>
              <option value="">— unassigned —</option>
              {STAFF_BY_ROLE[r].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      {c.pendingTransfer ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs space-y-2">
          <div><b>Handshake pending:</b> {c.pendingTransfer.to.name} must accept. {c.accountable?.name ?? 'Current owner'} stays accountable until then.</div>
          <div className="flex gap-1.5">
            <Btn size="sm" tone="success" onClick={() => d({ type: 'TRANSFER_DECISION', id: c.id, accept: true })}>Accept as {c.pendingTransfer.to.name.split(' ').slice(-1)}</Btn>
            <Btn size="sm" tone="secondary" onClick={() => d({ type: 'TRANSFER_DECISION', id: c.id, accept: false })}>Decline</Btn>
          </div>
        </div>
      ) : showTransfer ? (
        <div className="space-y-1.5 text-xs">
          <select value={to} onChange={(e) => setTo(e.target.value)} className={cx(inputCls, 'text-xs py-1.5')}>
            {[...STAFF_BY_ROLE.PCP, ...STAFF_BY_ROLE.SPECIALIST].filter((p) => p.id !== c.accountable?.id).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.org}</option>)}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={cx(inputCls, 'text-xs py-1.5')} />
          <div className="flex gap-1.5">
            <Btn size="sm" tone="primary" onClick={() => { d({ type: 'REQUEST_TRANSFER', id: c.id, personId: to, reason }); setShowTransfer(false); }}>Request handshake</Btn>
            <Btn size="sm" tone="ghost" onClick={() => setShowTransfer(false)}>Cancel</Btn>
          </div>
        </div>
      ) : (
        !isClosed(c) && <Btn size="sm" tone="secondary" className="w-full" onClick={() => setShowTransfer(true)}><ArrowRightLeft className="w-3.5 h-3.5" />Transfer accountability</Btn>
      )}
    </div>
  );
}

function Escalations({ c }: { c: Case }) {
  const { d } = useHalqa();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!c.escalations.length) return null;
  const open = c.escalations.filter((e) => !e.resolvedAt);
  const done = c.escalations.filter((e) => e.resolvedAt);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <SectionTitle icon={<ShieldAlert className="w-3.5 h-3.5" />} right={<span className="text-[10px] text-slate-400">Engine alerts humans · never acts clinically</span>}>Escalations</SectionTitle>
      <div className="space-y-2">
        {open.map((e) => {
          const rule = ESCALATION_RULES.find((r) => r.id === e.ruleId);
          return (
            <div key={e.id} className={cx('rounded-lg border p-2.5 text-xs', e.level >= 2 ? 'border-rose-300 bg-rose-50' : 'border-amber-300 bg-amber-50')}>
              <div className="flex items-center justify-between">
                <span className="font-bold">Level {e.level} · {rule?.name ?? e.ruleId}</span>
                <span className="text-slate-500">{fmtDateTime(e.at)}</span>
              </div>
              <div className="mt-0.5">{e.reason} → <b>{e.to}</b></div>
              {rule && <div className="text-slate-500 mt-0.5">Expected: {rule.action}</div>}
              <div className="flex gap-1.5 mt-2">
                <input value={notes[e.id] ?? ''} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} placeholder="Decision / action taken…" className={cx(inputCls, 'text-xs py-1')} />
                <Btn size="sm" tone="primary" disabled={!(notes[e.id] ?? '').trim()} onClick={() => d({ type: 'RESOLVE_ESC', id: c.id, escId: e.id, note: notes[e.id] })}>Resolve</Btn>
              </div>
            </div>
          );
        })}
        {done.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{done.length} resolved escalation{done.length > 1 ? 's' : ''}</summary>
            <ul className="mt-1 space-y-1">
              {done.map((e) => <li key={e.id}>✓ L{e.level} {e.reason} — {e.resolution} ({e.resolvedBy}, {fmtDuration(e.resolvedAt! - e.at)} to resolve)</li>)}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function PatientVoice({ c }: { c: Case }) {
  const { d } = useHalqa();
  const [note, setNote] = useState('Called patient, explained result in their language, questions answered');
  if (!c.feedback && !c.callbackRequestedAt && !c.delayReasons.length) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
      <SectionTitle icon={<HeartHandshake className="w-3.5 h-3.5" />}>Patient understanding & reassurance</SectionTitle>
      {c.feedback && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone={c.feedback.understoodQ1 ? 'emerald' : 'rose'}>Meaning of result: {c.feedback.understoodQ1 ? 'understood' : 'misunderstood'}</Badge>
          <Badge tone={c.feedback.understoodQ2 ? 'emerald' : 'rose'}>Next step: {c.feedback.understoodQ2 ? 'understood' : 'misunderstood'}</Badge>
          <Badge tone={c.feedback.confidence >= 4 ? 'emerald' : c.feedback.confidence >= 3 ? 'amber' : 'rose'}>Confidence {c.feedback.confidence}/5</Badge>
          <Badge>{c.feedback.lang.toUpperCase()} · {fmtDateTime(c.feedback.at)}</Badge>
        </div>
      )}
      {c.callbackRequestedAt && !c.callbackDoneAt && (
        <div className="flex gap-2 items-center">
          <span className="text-xs font-semibold text-sky-800 whitespace-nowrap">📞 Call back requested {fmtDateTime(c.callbackRequestedAt)}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputCls, 'text-xs py-1')} />
          <Btn size="sm" tone="primary" onClick={() => d({ type: 'CALLBACK_DONE', id: c.id, note })}>Done</Btn>
        </div>
      )}
      {c.delayReasons.length > 0 && (
        <div className="text-xs text-slate-600">Delay / drop-off reasons captured: {c.delayReasons.map((r) => DELAY_LABEL[r.reason]).join(' · ')}</div>
      )}
    </div>
  );
}

function Comms({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const [ec, setEc] = useState('');
  const [pm, setPm] = useState('');
  const thread = (k: 'ECONSULT' | 'PATIENT') => c.messages.filter((m) => m.thread === k);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col">
        <SectionTitle icon={<Stethoscope className="w-3.5 h-3.5" />}>Clinician ↔ clinician e-consult</SectionTitle>
        <div className="flex-1 space-y-2 min-h-[160px]">
          {thread('ECONSULT').map((m) => <Bubble key={m.id} m={m} mine={m.fromRole === s.role} />)}
          {!thread('ECONSULT').length && <div className="text-xs text-slate-400">Ask the receiving specialist a question without a full referral — answers are attached to the case.</div>}
        </div>
        <div className="flex gap-2 mt-3">
          <input value={ec} onChange={(e) => setEc(e.target.value)} placeholder={`Message as ${ROLE_LABEL[s.role]}…`} className={cx(inputCls, 'text-xs')} />
          <Btn size="sm" tone="primary" disabled={!ec.trim()} onClick={() => { d({ type: 'MESSAGE', id: c.id, thread: 'ECONSULT', text: ec }); setEc(''); }}>Send</Btn>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col">
        <SectionTitle icon={<MessageSquare className="w-3.5 h-3.5" />}>Patient ↔ care team</SectionTitle>
        <div className="flex-1 space-y-2 min-h-[160px]">
          {thread('PATIENT').map((m) => <Bubble key={m.id} m={m} mine={m.fromRole !== 'PATIENT'} />)}
          {!thread('PATIENT').length && <div className="text-xs text-slate-400">Secure messages from the patient app appear here.</div>}
        </div>
        <div className="flex gap-2 mt-3">
          <input value={pm} onChange={(e) => setPm(e.target.value)} placeholder="Reply to patient…" className={cx(inputCls, 'text-xs')} />
          <Btn size="sm" tone="primary" disabled={!pm.trim()} onClick={() => { d({ type: 'MESSAGE', id: c.id, thread: 'PATIENT', text: pm }); setPm(''); }}>Send</Btn>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 lg:col-span-2">
        <SectionTitle icon={<Smartphone className="w-3.5 h-3.5" />}>Notification log</SectionTitle>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-slate-100">
            {c.notifications.map((n, i) => (
              <tr key={i}><td className="py-1.5 text-slate-500">{fmtDateTime(n.at)}</td><td>{n.channel}</td><td>{n.lang.toUpperCase()}</td>
                <td><Badge tone={n.status === 'FAILED' || n.status === 'NO_ANSWER' ? 'rose' : 'emerald'}>{n.status.replace('_', ' ')}</Badge></td><td className="text-slate-500">{n.by}</td></tr>
            ))}
            {!c.notifications.length && <tr><td className="py-2 text-slate-400">No contact attempts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Bubble({ m, mine }: { m: Case['messages'][number]; mine: boolean }) {
  return (
    <div className={cx('max-w-[85%] rounded-xl px-3 py-2 text-xs', mine ? 'ml-auto bg-teal-700 text-white' : 'bg-slate-100 text-slate-800')}>
      <div className={cx('text-[10px] font-semibold mb-0.5', mine ? 'text-teal-100' : 'text-slate-500')}>{m.from} · {fmtDateTime(m.at)}</div>
      {m.text}
    </div>
  );
}

function Audit({ c }: { c: Case }) {
  const rows = [...c.audit].sort((a, b) => b.at - a.at);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <SectionTitle icon={<History className="w-3.5 h-3.5" />} right={<span className="text-[10px] text-slate-400">Append-only · every action attributed</span>}>Audit trail</SectionTitle>
      <ol className="space-y-2.5 border-l-2 border-slate-200 ml-1.5 pl-4">
        {rows.map((a, i) => (
          <li key={i} className="relative text-xs">
            <span className={cx('absolute -left-[22px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-white', a.system ? 'bg-slate-400' : 'bg-teal-600')} />
            <div className="font-mono text-[10px] text-slate-400">{fmtDateTime(a.at)}</div>
            <div className="font-semibold text-slate-800">{a.action}</div>
            <div className="text-slate-500">{a.actor}{a.system ? ' (system)' : ''}</div>
            {a.detail && <div className="mt-0.5 text-slate-600 bg-slate-50 rounded px-2 py-1">{a.detail}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}
