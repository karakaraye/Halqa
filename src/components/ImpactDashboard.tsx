'use client';

import React, { useMemo, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { computeMetrics, DELAY_LABEL } from '@/lib/engine';
import { BASELINE, PATHWAY_LIST } from '@/lib/pathways';
import { PathwayId } from '@/types/halqa';
import { Card, Badge, cx, inputCls, Btn } from './ui';
import { TrendingDown, ShieldCheck, Clock, HeartHandshake, AlertOctagon, Download, Info } from 'lucide-react';

const TEAL = '#0f766e';
const GRAY = '#94a3b8';

const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');
const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toString() : '—');

export function ImpactDashboard() {
  const { s } = useHalqa();
  const [pw, setPw] = useState<PathwayId | 'ALL'>('ALL');
  const m = useMemo(() => computeMetrics(s.cases, s.now, pw), [s.cases, s.now, pw]);

  const compare = [
    { label: 'Median time to patient notification', unit: 'h', base: BASELINE.medianHoursToNotify, now: m.medianHoursToNotify, better: 'lower' as const },
    { label: 'Median days result → diagnostic test', unit: 'd', base: BASELINE.medianDaysToDiagnostic, now: m.medianDaysToDiagnostic, better: 'lower' as const },
    { label: 'Referral → diagnostic completion', unit: '%', base: BASELINE.referralCompletionPct, now: m.referralCompletionPct, better: 'higher' as const },
    { label: 'Cases with documented closure', unit: '%', base: BASELINE.documentedClosurePct, now: (100 * m.closed) / Math.max(1, m.total), better: 'higher' as const },
    { label: 'Patient confidence navigating care', unit: '/5', base: BASELINE.patientConfidence, now: m.avgConfidence, better: 'higher' as const },
  ];

  const exportCsv = () => {
    const rows = [['metric', 'baseline', 'halqa'], ...compare.map((c) => [c.label, c.base, c.now.toFixed(2)]),
      ['SLA compliance %', '', m.slaCompliancePct.toFixed(1)], ['Referral acceptance %', '', m.referralAcceptPct.toFixed(1)], ['First-time attendance %', '', m.attendancePct.toFixed(1)],
      ['Teach-back understood %', '', m.understandingPct.toFixed(1)], ['Unresolved actionable results', '', m.unresolved], ['Unresolved overdue', '', m.unresolvedOverdue]];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'halqa-impact-metrics.csv'; a.click();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900 text-lg">Closure & patient-impact measures</h2>
          <p className="text-xs text-slate-500 flex items-center gap-1"><Info className="w-3.5 h-3.5" />Computed live from {m.total} cases ({m.closed} closed, {m.active} open) in this simulation. Baseline figures are illustrative placeholders — replace with programme audit data.</p>
        </div>
        <div className="flex gap-2">
          <select value={pw} onChange={(e) => setPw(e.target.value as PathwayId | 'ALL')} className={cx(inputCls, 'text-xs w-auto')}>
            <option value="ALL">All programmes</option>
            {PATHWAY_LIST.map((p) => <option key={p.id} value={p.id}>{p.short}</option>)}
          </select>
          <Btn size="sm" tone="secondary" onClick={exportCsv}><Download className="w-3.5 h-3.5" />CSV</Btn>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile icon={<Clock className="w-4 h-4 text-teal-600" />} label="Median time to notification" value={`${f1(m.medianHoursToNotify)} h`} sub={`Acknowledged in ${f1(m.medianHoursToAck)} h`} />
        <Tile icon={<TrendingDown className="w-4 h-4 text-teal-600" />} label="Result → diagnostic test" value={`${f1(m.medianDaysToDiagnostic)} d`} sub={`Consult ${f1(m.medianDaysToConsult)} d · care starts ${f1(m.medianDaysToCarePlan)} d`} />
        <Tile icon={<ShieldCheck className="w-4 h-4 text-teal-600" />} label="Closures with signed evidence" value={`${f0(m.closedWithEvidencePct)}%`} sub={`${m.closed} closed · SLA met on ${f0(m.slaCompliancePct)}% of steps`} />
        <Tile icon={<HeartHandshake className="w-4 h-4 text-teal-600" />} label="Understood result (teach-back)" value={`${f0(m.understandingPct)}%`} sub={`Confidence ${f1(m.avgConfidence)}/5 · n=${m.feedbackN}`} />
        <Tile icon={<AlertOctagon className="w-4 h-4 text-rose-500" />} label="Unresolved actionable results" value={`${m.unresolved}`} sub={`${m.unresolvedOverdue} overdue · ${m.escalationsOpen} open escalations`} />
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <Card className="p-4">
          <ChartTitle title="Before vs with Halqa" sub="Lower is better for times; higher is better for rates" legend={[{ c: GRAY, l: 'Baseline (illustrative)' }, { c: TEAL, l: 'Halqa (simulated, live)' }]} />
          <div className="space-y-3.5 mt-3">
            {compare.map((row) => {
              const max = Math.max(row.base, row.now, row.unit === '%' ? 100 : row.unit === '/5' ? 5 : 0) || 1;
              const delta = row.better === 'lower' ? ((row.base - row.now) / row.base) * 100 : row.now - row.base;
              return (
                <div key={row.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700">{row.label}</span>
                    <span className="font-semibold text-slate-900">
                      {row.better === 'lower' ? `${f0(delta)}% faster` : row.unit === '/5' ? `+${f1(delta)}` : `+${f0(delta)} pts`}
                    </span>
                  </div>
                  <Bar value={row.base} max={max} color={GRAY} label={`${f1(row.base)}${row.unit}`} title={`Baseline: ${f1(row.base)}${row.unit}`} />
                  <div className="h-0.5" />
                  <Bar value={row.now} max={max} color={TEAL} label={`${f1(row.now)}${row.unit}`} title={`Halqa: ${f1(row.now)}${row.unit}`} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <ChartTitle title="Where patients drop off" sub="Cancer pathways — cases reaching each milestone (no silent drop-off: every gap is an open, owned case)" />
          <div className="space-y-1.5 mt-3">
            {m.funnel.map((f, i) => {
              const top = m.funnel[0].n || 1;
              return (
                <div key={f.id} className="flex items-center gap-2 text-xs">
                  <span className="w-28 text-slate-600 shrink-0">{i + 1}. {f.label}</span>
                  <div className="flex-1"><Bar value={f.n} max={top} color={TEAL} label={`${f.n} (${f0((100 * f.n) / top)}%)`} title={`${f.label}: ${f.n} cases`} /></div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <ChartTitle title="SLA compliance by step" sub="Share of completed steps finished within their target time" />
          <div className="space-y-1.5 mt-3">
            {m.stepSla.map((x) => (
              <div key={x.id} className="flex items-center gap-2 text-xs">
                <span className="w-44 text-slate-600 shrink-0 truncate" title={x.label}>{x.label}</span>
                <div className="flex-1"><Bar value={x.pct} max={100} color={TEAL} label={`${f0(x.pct)}%`} title={`${x.label}: ${f0(x.pct)}% on time (n=${x.n})`} /></div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <ChartTitle title="Reasons for delay or drop-off" sub="Captured as structured data at the moment they happen" />
          <div className="space-y-1.5 mt-3">
            {m.delayReasons.map((x) => {
              const max = m.delayReasons[0]?.n || 1;
              return (
                <div key={x.reason} className="flex items-center gap-2 text-xs">
                  <span className="w-44 text-slate-600 shrink-0">{DELAY_LABEL[x.reason]}</span>
                  <div className="flex-1"><Bar value={x.n} max={max} color={TEAL} label={`${x.n}`} title={`${DELAY_LABEL[x.reason]}: ${x.n}`} /></div>
                </div>
              );
            })}
            {!m.delayReasons.length && <div className="text-xs text-slate-400">No delays recorded.</div>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <Mini label="Referral acceptance" value={`${f0(m.referralAcceptPct)}%`} />
            <Mini label="Attended first time" value={`${f0(m.attendancePct)}%`} />
            <Mini label="Escalation resolved in" value={`${f1(m.medianHoursEscalationResolve)} h`} />
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 pb-2"><ChartTitle title="By screening programme" sub="Median days from result to diagnostic/confirmatory test vs clinical target" /></div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th className="text-left px-4 py-2">Programme</th><th className="text-right px-3 py-2">Cases</th><th className="text-right px-3 py-2">Median days to diagnostic</th><th className="text-right px-3 py-2">Target</th><th className="text-right px-3 py-2">Within target</th><th className="text-right px-4 py-2">Closed</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {m.byPathway.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-medium text-slate-800">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.n}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f1(r.medianDaysDx)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">≤ {r.targetDays}</td>
                <td className="px-3 py-2 text-right"><Badge tone={r.withinTargetPct >= 85 ? 'emerald' : r.withinTargetPct >= 70 ? 'amber' : 'rose'}>{f0(r.withinTargetPct)}%</Badge></td>
                <td className="px-4 py-2 text-right tabular-nums">{f0(r.closedPct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-4 gap-2 p-4 border-t border-slate-100">
          {m.unresolvedAgeBuckets.map((b) => <Mini key={b.label} label={`Open ${b.label}`} value={`${b.n}`} />)}
        </div>
      </Card>
    </div>
  );
}

function Bar({ value, max, color, label, title }: { value: number; max: number; color: string; label: string; title: string }) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  return (
    <div className="group relative flex items-center gap-2 h-4" title={title}>
      <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-r-[4px] transition-all duration-500 group-hover:brightness-110" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-20 text-[11px] font-semibold text-slate-700 tabular-nums">{label}</span>
    </div>
  );
}

function ChartTitle({ title, sub, legend }: { title: string; sub: string; legend?: { c: string; l: string }[] }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-bold text-slate-900 text-sm">{title}</h3><p className="text-[11px] text-slate-500">{sub}</p></div>
      {legend && <div className="flex gap-3">{legend.map((x) => <span key={x.l} className="flex items-center gap-1 text-[11px] text-slate-600"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: x.c }} />{x.l}</span>)}</div>}
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between"><span className="text-[11px] text-slate-500 font-medium">{label}</span>{icon}</div>
      <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5">{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 border border-slate-200 p-2"><div className="text-lg font-extrabold text-slate-900 tabular-nums">{value}</div><div className="text-[10px] text-slate-500">{label}</div></div>;
}
