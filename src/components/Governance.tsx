'use client';

import React, { useEffect } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { ESCALATION_RULES, PATHWAY_LIST, URGENCY_FACTOR, ROLE_LABEL } from '@/lib/pathways';
import { fmtDateTime, fmtDuration, isClosed } from '@/lib/engine';
import { Card, Badge, Btn } from './ui';
import { ShieldCheck, Users, ShieldAlert, Settings2, Scale } from 'lucide-react';

export function Governance() {
  const { s, d } = useHalqa();
  useEffect(() => { if (s.role !== 'LEAD') d({ type: 'ROLE', role: 'LEAD' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = s.cases.filter((c) => c.closure?.status === 'PENDING_APPROVAL');
  const escalations = s.cases.filter((c) => !isClosed(c)).flatMap((c) => c.escalations.filter((e) => !e.resolvedAt).map((e) => ({ c, e }))).sort((a, b) => b.e.level - a.e.level || a.e.at - b.e.at);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="font-bold text-slate-900 text-lg flex items-center gap-2"><Scale className="w-5 h-5 text-teal-600" />Safe, human-governed operation</h2>
        <div className="grid md:grid-cols-4 gap-3 mt-3 text-xs">
          {[
            ['Automation only alerts', 'The rules engine raises escalations and routes work. It never completes a clinical step, changes urgency, or closes a case.'],
            ['Closure needs evidence', 'Standard closure requires every step, a diagnostic result, a plan, an evidence ID and a licensed clinician signature.'],
            ['Two-person rule', 'Exception closures (declined, care elsewhere, out of scope) need a second approver from clinical governance.'],
            ['Nothing is silent', 'Every overdue, rejected, unassigned or unreachable case surfaces on a worklist with a named owner, and the audit trail is append-only.'],
          ].map(([h, b]) => <div key={h} className="rounded-xl bg-teal-50/60 border border-teal-100 p-3"><div className="font-bold text-teal-900">{h}</div><div className="text-slate-600 mt-0.5">{b}</div></div>)}
        </div>
      </Card>

      <div className="grid xl:grid-cols-2 gap-4 items-start">
        <Card className="p-4">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-indigo-600" />Exception closures awaiting 2nd approval ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map((c) => (
              <div key={c.id} className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-xs">
                <div className="flex justify-between"><b className="text-slate-900">{c.patient.name} · {c.id}</b><span className="text-slate-500">{fmtDateTime(c.closure!.signedAt)}</span></div>
                <div className="mt-1 text-slate-700">{c.closure!.outcome}</div>
                <div className="text-slate-500 mt-0.5">“{c.closure!.justification}”</div>
                <div className="text-slate-500">Submitted by {c.closure!.signedBy} · evidence {c.closure!.evidenceRef}</div>
                <div className="flex gap-2 mt-2">
                  <Btn size="sm" tone="success" onClick={() => d({ type: 'APPROVE_CLOSURE', id: c.id, approve: true, note: 'Reviewed — informed decision documented; safety-net recall set' })}>Approve</Btn>
                  <Btn size="sm" tone="secondary" onClick={() => d({ type: 'APPROVE_CLOSURE', id: c.id, approve: false, note: 'Reopen — offer second discussion with female clinician' })}>Reject & reopen</Btn>
                  <Btn size="sm" tone="ghost" onClick={() => d({ type: 'SELECT', id: c.id })}>Open case</Btn>
                </div>
              </div>
            ))}
            {!pending.length && <div className="text-xs text-slate-400">No exception closures waiting.</div>}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2 mb-3"><ShieldAlert className="w-4 h-4 text-rose-500" />Open escalations across the network ({escalations.length})</h3>
          <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
            {escalations.map(({ c, e }) => (
              <button key={e.id} onClick={() => d({ type: 'SELECT', id: c.id })} className="w-full text-left rounded-lg border border-slate-200 hover:border-teal-400 p-2.5 text-xs flex items-center gap-2">
                <Badge tone={e.level >= 2 ? 'rose' : 'amber'}>L{e.level}</Badge>
                <div className="flex-1 min-w-0"><div className="font-semibold text-slate-800 truncate">{c.patient.name} — {e.reason}</div><div className="text-slate-500">→ {e.to} · open {fmtDuration(s.now - e.at)}</div></div>
              </button>
            ))}
            {!escalations.length && <div className="text-xs text-slate-400">No open escalations.</div>}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 pb-2"><h3 className="font-bold text-sm text-slate-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-teal-600" />Escalation ladder (transparent rules)</h3></div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="text-left px-4 py-2">Rule</th><th className="text-left px-3 py-2">Level</th><th className="text-left px-3 py-2">Triggers when</th><th className="text-left px-3 py-2">Goes to</th><th className="text-left px-4 py-2">Human action required</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {ESCALATION_RULES.map((r) => (
              <tr key={r.id}><td className="px-4 py-2 font-semibold text-slate-800">{r.name}</td><td className="px-3 py-2"><Badge tone={r.level >= 2 ? 'rose' : 'amber'}>L{r.level}</Badge></td><td className="px-3 py-2 text-slate-600">{r.when}</td><td className="px-3 py-2 text-slate-600">{r.to}</td><td className="px-4 py-2 text-slate-600">{r.action}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 pb-2">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2"><Settings2 className="w-4 h-4 text-slate-500" />Pathway service levels (configurable per programme)</h3>
          <p className="text-[11px] text-slate-500">Targets shown for ELEVATED urgency. CRITICAL × {URGENCY_FACTOR.CRITICAL}, ROUTINE × {URGENCY_FACTOR.ROUTINE}. Values are demo defaults, to be set against local clinical standards.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="text-left px-4 py-2">Pathway</th>{['Step & owner → target'].map((h) => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {PATHWAY_LIST.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 align-top font-semibold text-slate-800 w-48">{p.short}<div className="text-[10px] font-normal text-slate-500">Diagnostic target ≤ {p.targetDaysToDiagnosis} d</div></td>
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{p.steps.map((st, i) => <span key={st.id} className="rounded-md bg-slate-50 border border-slate-200 px-1.5 py-0.5"><b>{i + 1}.</b> {st.label} <span className="text-slate-400">· {ROLE_LABEL[st.ownerRole].split(' ')[0]} · {st.slaHours < 48 ? `${st.slaHours}h` : `${st.slaHours / 24}d`}</span></span>)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
