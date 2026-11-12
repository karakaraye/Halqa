'use client';
/**
 * Overview — "How we are doing" (Figma frame 14:203). For all staff.
 * Every figure is computed live by computeMetrics() in src/lib/engine.ts.
 */
import React, { useMemo } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { computeMetrics, DELAY_LABEL, Metrics } from '@/lib/engine';
import { Button, Card, Chip, Tone } from '@/components/design/primitives';
import type { DelayReason } from '@/types/halqa';

/** Plain wording from the design for each drop-off reason; falls back to DELAY_LABEL. */
const STUCK_LABEL: Record<DelayReason, string> = {
  UNREACHABLE: 'Could not be reached by phone',
  DNA: 'Missed their appointment',
  REFERRAL_REJECTED: 'Referral sent back',
  CAPACITY: 'Waiting for a specialist slot',
  LOW_UNDERSTANDING: 'Did not understand the result',
  PATIENT_DECLINED: 'Said no to the next step',
  PATIENT_TRAVEL: 'Away or travelling',
  INFO_MISSING: 'Doctor needed more information',
};

/** Hours as "2 hours" (one decimal under 10). Em dash when there is no data. */
function fmtHours(h: number) {
  if (!Number.isFinite(h)) return '—';
  const n = h < 10 ? Math.round(h * 10) / 10 : Math.round(h);
  return `${n} ${n === 1 ? 'hour' : 'hours'}`;
}

const pct = (n: number) => (Number.isFinite(n) ? `${Math.round(n)}%` : '—');

type Programme = Metrics['byPathway'][number];

function programmeState(pw: Programme): { tone: Tone; chip: string; sentence: string } {
  if (pw.n === 0) return { tone: 'slate', chip: 'No data', sentence: 'No patients yet.' };
  if (!Number.isFinite(pw.medianDaysDx)) return { tone: 'slate', chip: 'No data', sentence: 'No patients have had their test yet.' };
  if (pw.withinTargetPct >= 80) return { tone: 'teal', chip: 'On track', sentence: 'Most patients are moving to their next step on time.' };
  if (pw.withinTargetPct >= 50) return { tone: 'amber', chip: 'Needs attention', sentence: 'Some patients are waiting too long for their next test.' };
  return { tone: 'rose', chip: 'Behind', sentence: 'Many check-ups are late. Someone should look at this today.' };
}

export function Overview() {
  const { s } = useHalqa();
  const m = useMemo(() => computeMetrics(s.cases, s.now), [s.cases, s.now]);

  // "Tests done on time": case-weighted average of byPathway[].withinTargetPct,
  // weighted by byPathway[].n, counting only programmes where at least one test is done (medianDaysDx is a number).
  const onTime = useMemo(() => {
    const withData = m.byPathway.filter((p) => p.n > 0 && Number.isFinite(p.medianDaysDx));
    const n = withData.reduce((sum, p) => sum + p.n, 0);
    return n ? withData.reduce((sum, p) => sum + p.withinTargetPct * p.n, 0) / n : NaN;
  }, [m.byPathway]);

  const stats = [
    {
      // computeMetrics().medianHoursToNotify — median hours from result issued to patient told.
      value: fmtHours(m.medianHoursToNotify),
      label: 'Typical time to tell a patient their result',
    },
    {
      // computeMetrics().byPathway[].withinTargetPct, weighted by byPathway[].n (see onTime above).
      value: pct(onTime),
      label: 'Tests done on time',
    },
    {
      // computeMetrics().closedWithEvidencePct — closed cases that were closed with a test result as evidence.
      value: pct(m.closedWithEvidencePct),
      label: 'Patients who are fully finished',
    },
    {
      // computeMetrics().understandingPct (shown as "k in 5", k = round(pct / 20)); em dash when feedbackN is 0.
      value: m.feedbackN > 0 ? `${Math.round(m.understandingPct / 20)} in 5` : '—',
      label: 'Patients who understood their result',
    },
  ];

  // computeMetrics().delayReasons — already sorted by n, highest first.
  const stuck = m.delayReasons.slice(0, 5);
  const maxStuck = Math.max(1, ...stuck.map((x) => x.n));

  const exportCsv = () => {
    const rows = [
      ['Programme', 'Patients', 'Tests on time (%)', 'Median days to test', 'Target days', 'Finished (%)', 'Status'],
      ...m.byPathway.map((p) => [
        p.name,
        String(p.n),
        p.n && Number.isFinite(p.medianDaysDx) ? String(Math.round(p.withinTargetPct)) : '',
        Number.isFinite(p.medianDaysDx) ? p.medianDaysDx.toFixed(1) : '',
        String(p.targetDays),
        p.n ? String(Math.round(p.closedPct)) : '',
        programmeState(p).chip,
      ]),
    ];
    const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `halqa-programmes-${new Date(s.now).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-page-title text-slate-900">How we are doing</h1>
          <p className="mt-2 text-body text-slate-700">
            Based on all patients in the programme.
          </p>
        </div>
        <Button kind="secondary" onClick={exportCsv}>Export CSV</Button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        {stats.map((st) => (
          <Card key={st.label}>
            <p className="text-[40px] font-bold leading-[48px] text-teal-700">{st.value}</p>
            <p className="mt-3 text-body font-semibold text-slate-900">{st.label}</p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="text-[22px] font-semibold leading-8 text-slate-900">Where patients get stuck</h2>
        {stuck.length === 0 ? (
          <p className="mt-3 text-body text-slate-500">No drop-offs recorded yet</p>
        ) : (
          <>
            <ul className="mt-4 space-y-4">
              {stuck.map((x) => (
                <li key={x.reason}>
                  <p className="text-body text-slate-900">{STUCK_LABEL[x.reason] ?? DELAY_LABEL[x.reason]}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-7 min-w-0 flex-1">
                      <div
                        className="h-full rounded-md bg-teal-700"
                        style={{ width: `${Math.max(4, (100 * x.n) / maxStuck)}%` }}
                        aria-hidden="true"
                      />
                    </div>
                    <span className="w-8 shrink-0 text-body font-semibold text-slate-900">{x.n}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-small text-slate-500">Tip: the top item is the one to tackle first.</p>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-[22px] font-semibold leading-8 text-slate-900">Programmes</h2>
        <ul className="mt-4 space-y-3">
          {m.byPathway.map((p) => {
            const st = programmeState(p);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-input bg-slate-50 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-slate-900">{p.name}</p>
                  <p className="text-small text-slate-700">{st.sentence}</p>
                </div>
                <Chip tone={st.tone}>{st.chip}</Chip>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
