'use client';

import React from 'react';
import { clsx } from 'clsx';
import { Case, Urgency } from '@/types/halqa';
import { caseStatus, fmtDuration, SlaState, pathwayOf } from '@/lib/engine';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, Hourglass } from 'lucide-react';

export const cx = clsx;

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('bg-white rounded-2xl border border-slate-200 shadow-sm', className)} {...p}>{children}</div>;
}

type BtnTone = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'warn';
export function Btn({ tone = 'secondary', size = 'md', className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; size?: 'sm' | 'md' }) {
  const tones: Record<BtnTone, string> = {
    primary: 'bg-teal-700 hover:bg-teal-800 text-white shadow-sm',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm',
    warn: 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm',
    ghost: 'hover:bg-slate-100 text-slate-600',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer',
        size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3.5 py-2',
        tones[tone], className,
      )}
      {...p}
    >
      {children}
    </button>
  );
}

export function Badge({ tone = 'slate', className, children }: { tone?: string; className?: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    teal: 'bg-teal-50 text-teal-800 border-teal-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    sky: 'bg-sky-50 text-sky-800 border-sky-200',
    violet: 'bg-violet-50 text-violet-800 border-violet-200',
    pink: 'bg-pink-50 text-pink-800 border-pink-200',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  };
  return <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap', map[tone] ?? map.slate, className)}>{children}</span>;
}

export function UrgencyBadge({ u }: { u: Urgency }) {
  return <Badge tone={u === 'CRITICAL' ? 'rose' : u === 'ELEVATED' ? 'amber' : 'slate'}>{u === 'CRITICAL' && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />}{u}</Badge>;
}

export function PathwayBadge({ c }: { c: Case }) {
  const p = pathwayOf(c);
  return <Badge tone={p.color}>{p.short}</Badge>;
}

export function SlaPill({ c, now, className }: { c: Case; now: number; className?: string }) {
  const s = caseStatus(c, now);
  const conf: Record<SlaState, { tone: string; icon: React.ReactNode; text: string }> = {
    CLOSED: { tone: 'emerald', icon: <CheckCircle2 className="w-3 h-3" />, text: 'Closed' },
    PENDING_APPROVAL: { tone: 'indigo', icon: <Hourglass className="w-3 h-3" />, text: 'Awaiting approval' },
    OVERDUE: { tone: 'rose', icon: <AlertTriangle className="w-3 h-3" />, text: `Overdue ${fmtDuration(-s.remainingMs)}` },
    DUE_SOON: { tone: 'amber', icon: <Clock className="w-3 h-3" />, text: `Due in ${fmtDuration(s.remainingMs)}` },
    ON_TRACK: { tone: 'slate', icon: <Clock className="w-3 h-3" />, text: `${fmtDuration(s.remainingMs)} left` },
  };
  const k = conf[s.state];
  return <Badge tone={k.tone} className={className}>{k.icon}{k.text}</Badge>;
}

export function EscalationBadge({ level }: { level: number }) {
  if (!level) return null;
  return <Badge tone={level >= 2 ? 'rose' : 'amber'}><ShieldAlert className="w-3 h-3" />L{level}</Badge>;
}

export function StepDots({ c }: { c: Case }) {
  const p = pathwayOf(c);
  return (
    <div className="flex items-center gap-0.5">
      {p.steps.map((st) => {
        const done = !!c.steps[st.id]?.completedAt;
        const cur = !done && p.steps.find((x) => !c.steps[x.id]?.completedAt)?.id === st.id;
        return <span key={st.id} title={st.label} className={cx('h-1.5 rounded-full', done ? 'w-3 bg-teal-600' : cur ? 'w-4 bg-amber-500' : 'w-3 bg-slate-200')} />;
      })}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-[11px] text-slate-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full text-sm px-2.5 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500';

export function SectionTitle({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">{icon}{children}</h4>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'slate', icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; icon?: React.ReactNode }) {
  const toneText: Record<string, string> = { slate: 'text-slate-900', teal: 'text-teal-700', rose: 'text-rose-600', emerald: 'text-emerald-700', amber: 'text-amber-600' };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-xs font-medium">{label}</span>
        {icon}
      </div>
      <div className={cx('text-2xl font-extrabold mt-1 tabular-nums', toneText[tone])}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </Card>
  );
}
