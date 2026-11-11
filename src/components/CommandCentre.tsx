'use client';

import React, { useMemo, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { actionItems, caseStatus, isClosed, priorityScore, fmtDate, pathwayOf, currentStep } from '@/lib/engine';
import { PATHWAY_LIST } from '@/lib/pathways';
import { LANGS } from '@/lib/i18n';
import { Case, PathwayId } from '@/types/halqa';
import { Card, Badge, UrgencyBadge, PathwayBadge, SlaPill, StepDots, EscalationBadge, cx, inputCls } from './ui';
import { AlertTriangle, UserX, Undo2, MessageCircle, ShieldAlert, Activity, Search, CheckCircle2, Layers, Timer } from 'lucide-react';

type Queue = 'action' | 'overdue' | 'unassigned' | 'returned' | 'patient' | 'active' | 'closed';

export function CommandCentre() {
  const { s, d } = useHalqa();
  const [queue, setQueue] = useState<Queue>('action');
  const [pathway, setPathway] = useState<PathwayId | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [stepFilter, setStepFilter] = useState<string | null>(null);

  const live = useMemo(() => s.cases.filter((c) => !c.historical || isClosed(c)), [s.cases]);
  const active = live.filter((c) => !isClosed(c));

  const tests: Record<Queue, (c: Case) => boolean> = {
    action: (c) => !isClosed(c) && actionItems(c, s.now).some((i) => i.severity >= 2),
    overdue: (c) => !isClosed(c) && caseStatus(c, s.now).state === 'OVERDUE',
    unassigned: (c) => !isClosed(c) && caseStatus(c, s.now).unassigned,
    returned: (c) => !isClosed(c) && !!c.referral && (c.referral.status === 'REJECTED' || c.referral.status === 'INFO_REQUESTED'),
    patient: (c) => !isClosed(c) && ((!!c.callbackRequestedAt && !c.callbackDoneAt) || actionItems(c, s.now).some((i) => i.kind === 'PATIENT_MESSAGE' || i.kind === 'LOW_UNDERSTANDING')),
    active: (c) => !isClosed(c),
    closed: (c) => isClosed(c),
  };

  const counts = Object.fromEntries((Object.keys(tests) as Queue[]).map((k) => [k, live.filter(tests[k]).length])) as Record<Queue, number>;

  const rows = live
    .filter(tests[queue])
    .filter((c) => pathway === 'ALL' || c.pathwayId === pathway)
    .filter((c) => !stepFilter || currentStep(c)?.id === stepFilter)
    .filter((c) => !q || `${c.id} ${c.patient.name} ${c.resultCode} ${c.team.PCP?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (queue === 'closed' ? (b.closure?.signedAt ?? 0) - (a.closure?.signedAt ?? 0) : priorityScore(b, s.now) - priorityScore(a, s.now)));

  const silent = active.filter((c) => s.now - Math.max(...c.audit.map((a) => a.at)) > 7 * 86_400_000 && !c.escalations.some((e) => !e.resolvedAt)).length;
  const escOpen = active.reduce((n, c) => n + c.escalations.filter((e) => !e.resolvedAt).length, 0);

  const QUEUES: { id: Queue; label: string; icon: React.ReactNode; tone: string }[] = [
    { id: 'action', label: 'Needs action now', icon: <AlertTriangle className="w-3.5 h-3.5" />, tone: 'rose' },
    { id: 'overdue', label: 'Overdue', icon: <Timer className="w-3.5 h-3.5" />, tone: 'rose' },
    { id: 'unassigned', label: 'Unassigned', icon: <UserX className="w-3.5 h-3.5" />, tone: 'rose' },
    { id: 'returned', label: 'Rejected / returned', icon: <Undo2 className="w-3.5 h-3.5" />, tone: 'amber' },
    { id: 'patient', label: 'Patient requests', icon: <MessageCircle className="w-3.5 h-3.5" />, tone: 'sky' },
    { id: 'active', label: 'All open', icon: <Layers className="w-3.5 h-3.5" />, tone: 'slate' },
    { id: 'closed', label: 'Closed', icon: <CheckCircle2 className="w-3.5 h-3.5" />, tone: 'emerald' },
  ];

  // pipeline counts (by current step across all pathways)
  const pipeline = ['NOTIFY', 'ACK', 'CONSULT', 'CONFIRM_TEST', 'REFER', 'ACCEPT', 'BOOK', 'ATTEND', 'OUTCOME', 'CARE_PLAN', 'CLOSE'].map((id) => {
    const cs = active.filter((c) => currentStep(c)?.id === id && c.closure?.status !== 'PENDING_APPROVAL');
    const label = { NOTIFY: 'Notify', ACK: 'Understand', CONSULT: 'Consult', CONFIRM_TEST: 'Confirm test', REFER: 'Refer', ACCEPT: 'Accept', BOOK: 'Book', ATTEND: 'Diagnostic', OUTCOME: 'Result', CARE_PLAN: 'Care plan', CLOSE: 'Close' }[id]!;
    return { id, label, n: cs.length, overdue: cs.filter((c) => caseStatus(c, s.now).state === 'OVERDUE').length };
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Open actionable results" value={active.length} icon={<Activity className="w-4 h-4 text-teal-600" />} />
        <Kpi label="Need action now" value={counts.action} tone="rose" icon={<AlertTriangle className="w-4 h-4 text-rose-500" />} onClick={() => setQueue('action')} />
        <Kpi label="Overdue vs SLA" value={counts.overdue} tone={counts.overdue ? 'rose' : 'slate'} icon={<Timer className="w-4 h-4 text-rose-500" />} onClick={() => setQueue('overdue')} />
        <Kpi label="Without an owner" value={counts.unassigned} tone={counts.unassigned ? 'rose' : 'slate'} icon={<UserX className="w-4 h-4 text-rose-500" />} onClick={() => setQueue('unassigned')} />
        <Kpi label="Open escalations" value={escOpen} tone={escOpen ? 'amber' : 'slate'} icon={<ShieldAlert className="w-4 h-4 text-amber-500" />} />
        <Kpi label="Silent cases (>7d, no alert)" value={silent} tone={silent ? 'rose' : 'emerald'} sub={silent ? 'Investigate' : 'No result can quietly drop'} icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} />
      </div>

      {/* Pipeline */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Where every open result is right now</span>
          {stepFilter && <button onClick={() => setStepFilter(null)} className="text-[11px] text-teal-700 font-semibold">Clear step filter ✕</button>}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {pipeline.map((p, i) => (
            <button key={p.id} onClick={() => { setStepFilter(stepFilter === p.id ? null : p.id); setQueue('active'); }}
              className={cx('flex-1 min-w-[84px] rounded-xl border px-2 py-2 text-left transition-colors relative',
                stepFilter === p.id ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-teal-300 bg-slate-50/60')}>
              <div className="text-[10px] text-slate-500 font-medium">{i + 1}. {p.label}</div>
              <div className="text-lg font-extrabold text-slate-900 tabular-nums leading-tight">{p.n}</div>
              {p.overdue > 0 && <div className="text-[10px] font-bold text-rose-600">{p.overdue} overdue</div>}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex gap-1 overflow-x-auto">
            {QUEUES.map((qq) => (
              <button key={qq.id} onClick={() => setQueue(qq.id)}
                className={cx('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border',
                  queue === qq.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                {qq.icon}{qq.label}
                <span className={cx('px-1.5 rounded-full text-[10px]', queue === qq.id ? 'bg-white/20' : counts[qq.id] && ['rose', 'amber'].includes(qq.tone) ? 'bg-rose-100 text-rose-700' : 'bg-slate-100')}>{counts[qq.id]}</span>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex gap-2">
            <select value={pathway} onChange={(e) => setPathway(e.target.value as PathwayId | 'ALL')} className={cx(inputCls, 'text-xs py-1.5 w-auto')}>
              <option value="ALL">All programmes</option>
              {PATHWAY_LIST.map((p) => <option key={p.id} value={p.id}>{p.short}</option>)}
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, case, clinician" className={cx(inputCls, 'text-xs py-1.5 pl-8 w-56')} />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Patient / case</th>
                <th className="text-left font-semibold px-3 py-2">Result</th>
                <th className="text-left font-semibold px-3 py-2">Current step</th>
                <th className="text-left font-semibold px-3 py-2">Owner right now</th>
                <th className="text-left font-semibold px-3 py-2">SLA</th>
                <th className="text-left font-semibold px-3 py-2">Why it needs attention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => <Row key={c.id} c={c} onOpen={() => d({ type: 'SELECT', id: c.id })} />)}
              {!rows.length && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-emerald-400" />Nothing in this queue. Every case here has an owner and is on time.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Row({ c, onOpen }: { c: Case; onOpen: () => void }) {
  const { s } = useHalqa();
  const st = caseStatus(c, s.now);
  const items = actionItems(c, s.now);
  const lang = LANGS.find((l) => l.id === c.patient.lang)!;
  return (
    <tr onClick={onOpen} className={cx('cursor-pointer hover:bg-teal-50/40 transition-colors', s.selectedId === c.id && 'bg-teal-50/70')}>
      <td className="px-4 py-3 align-top">
        <div className="font-semibold text-slate-900">{c.patient.name}</div>
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
          <span className="font-mono">{c.id}</span>·<span>{c.patient.age}{c.patient.sex}</span>·<span>{lang.native}</span>
          {c.patient.needsInterpreter && <Badge tone="violet">Interpreter</Badge>}
        </div>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex flex-wrap gap-1"><PathwayBadge c={c} /><UrgencyBadge u={c.urgency} /></div>
        <div className="text-[11px] text-slate-600 mt-1 font-medium">{c.resultCode}</div>
      </td>
      <td className="px-3 py-3 align-top">
        {isClosed(c) ? (
          <div className="text-xs text-emerald-700 font-semibold">{c.closure?.outcome}<div className="text-[11px] text-slate-500 font-normal">Closed {fmtDate(c.closure!.signedAt)}</div></div>
        ) : (
          <>
            <div className="text-xs font-semibold text-slate-800">{c.closure?.status === 'PENDING_APPROVAL' ? 'Exception closure review' : `${st.stepNo}/${st.totalSteps} · ${st.step?.label}`}</div>
            <div className="mt-1"><StepDots c={c} /></div>
          </>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        <div className={cx('text-xs font-semibold', st.unassigned ? 'text-rose-600' : 'text-slate-800')}>{st.unassigned ? '⚠ Unassigned' : st.ownerName}</div>
        <div className="text-[11px] text-slate-500 truncate max-w-[200px]">{st.ownerDetail}</div>
      </td>
      <td className="px-3 py-3 align-top"><div className="flex flex-col gap-1 items-start"><SlaPill c={c} now={s.now} /><EscalationBadge level={st.maxLevel} /></div></td>
      <td className="px-3 py-3 align-top">
        <div className="space-y-0.5">
          {items.slice(0, 2).map((i, k) => (
            <div key={k} className={cx('text-[11px] font-medium', i.severity >= 3 ? 'text-rose-700' : i.severity === 2 ? 'text-amber-700' : 'text-slate-500')}>• {i.text}</div>
          ))}
          {!items.length && !isClosed(c) && <span className="text-[11px] text-slate-400">On track — {pathwayOf(c).diagnosticTest.toLowerCase()} pathway</span>}
          {isClosed(c) && <span className="text-[11px] text-slate-500">Signed by {c.closure?.signedBy}</span>}
        </div>
      </td>
    </tr>
  );
}

function Kpi({ label, value, tone = 'slate', icon, sub, onClick }: { label: string; value: number; tone?: string; icon: React.ReactNode; sub?: string; onClick?: () => void }) {
  const t: Record<string, string> = { slate: 'text-slate-900', rose: 'text-rose-600', amber: 'text-amber-600', emerald: 'text-emerald-600' };
  return (
    <button onClick={onClick} disabled={!onClick} className="text-left bg-white rounded-2xl border border-slate-200 shadow-sm p-3.5 hover:border-teal-300 disabled:hover:border-slate-200 transition-colors">
      <div className="flex items-center justify-between"><span className="text-[11px] text-slate-500 font-medium">{label}</span>{icon}</div>
      <div className={cx('text-2xl font-extrabold tabular-nums mt-0.5', t[tone])}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </button>
  );
}
