'use client';

import React from 'react';
import { useHalqa, View } from '@/context/HalqaStore';
import { fmtDateTime, actionItems, isClosed } from '@/lib/engine';
import { ACTING_AS, ROLE_LABEL } from '@/lib/pathways';
import { Role } from '@/types/halqa';
import { cx } from './ui';
import {
  LayoutDashboard, Inbox, Smartphone, BarChart3, ShieldCheck, Play, Pause, FastForward, RotateCcw, FlaskConical, Clock3,
} from 'lucide-react';

const TABS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'command', label: 'Command Centre', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'specialist', label: 'Specialist Inbox', icon: <Inbox className="w-4 h-4" /> },
  { id: 'patient', label: 'Patient App', icon: <Smartphone className="w-4 h-4" /> },
  { id: 'impact', label: 'Impact', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'governance', label: 'Governance', icon: <ShieldCheck className="w-4 h-4" /> },
];

const ROLES: Role[] = ['NAVIGATOR', 'PCP', 'SPECIALIST', 'LEAD'];

export function Header() {
  const { s, d } = useHalqa();
  const needs = s.cases.filter((c) => !isClosed(c) && actionItems(c, s.now).some((i) => i.severity >= 2)).length;
  const inbox = s.cases.filter((c) => c.referral?.status === 'SENT' || [...c.messages].reverse().find((m) => m.thread === 'ECONSULT')?.fromRole === 'PCP').filter((c) => !isClosed(c)).length;
  const approvals = s.cases.filter((c) => c.closure?.status === 'PENDING_APPROVAL').length;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6">
        <div className="flex items-center justify-between gap-4 h-14">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-600 to-teal-800 grid place-items-center shadow-md shadow-teal-700/20">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M21 3v6h-6" /></svg>
            </div>
            <div className="leading-tight">
              <div className="font-black tracking-tight text-slate-900">HALQA <span className="font-normal text-teal-600">حَلْقَة</span></div>
              <div className="text-[10px] text-slate-500 hidden sm:block">Closing the screening-to-care loop</div>
            </div>
          </div>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const count = t.id === 'command' ? needs : t.id === 'specialist' ? inbox : t.id === 'governance' ? approvals : 0;
              return (
                <button key={t.id} onClick={() => d({ type: 'VIEW', view: t.id })}
                  className={cx('relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors',
                    s.view === t.id ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100')}>
                  {t.icon}<span className="hidden md:inline">{t.label}</span>
                  {count > 0 && <span className={cx('min-w-[18px] h-[18px] px-1 rounded-full text-[10px] grid place-items-center text-white', t.id === 'command' ? 'bg-rose-500' : 'bg-teal-600')}>{count}</span>}
                </button>
              );
            })}
          </nav>

          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-slate-500">Acting as</span>
            <select value={s.role} onChange={(e) => d({ type: 'ROLE', role: e.target.value as Role })}
              className="text-xs font-semibold border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-800">
              {ROLES.map((r) => <option key={r} value={r}>{ACTING_AS[r].name} · {ROLE_LABEL[r]}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Simulation bar */}
      <div className="bg-slate-900 text-slate-200">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-6 h-10 flex items-center gap-3 text-xs overflow-x-auto">
          <span className="flex items-center gap-1.5 font-mono text-teal-300 whitespace-nowrap"><Clock3 className="w-3.5 h-3.5" />{fmtDateTime(s.now)} GST</span>
          <span className="text-slate-500 hidden sm:inline">Simulation clock</span>
          <div className="flex items-center gap-1">
            <button onClick={() => d({ type: 'SET_PLAYING', on: !s.playing })} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">
              {s.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}{s.playing ? 'Pause' : 'Play'}
            </button>
            {[1, 6, 24, 72].map((h) => (
              <button key={h} onClick={() => d({ type: 'TICK', hours: h })} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 whitespace-nowrap">
                <FastForward className="w-3 h-3" />+{h < 24 ? `${h}h` : `${h / 24}d`}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button onClick={() => d({ type: 'INGEST' })} className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-500 text-white font-semibold whitespace-nowrap">
            <FlaskConical className="w-3.5 h-3.5" />Simulate incoming lab result
          </button>
          <button onClick={() => { if (confirm('Reset the demo to its starting state?')) d({ type: 'RESET' }); }} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 text-slate-400 whitespace-nowrap">
            <RotateCcw className="w-3.5 h-3.5" />Reset
          </button>
          <select value={s.role} onChange={(e) => d({ type: 'ROLE', role: e.target.value as Role })}
            className="lg:hidden text-xs border border-slate-700 rounded px-1.5 py-1 bg-slate-800 text-slate-100">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
      </div>
    </header>
  );
}

export function Toasts() {
  const { s, d } = useHalqa();
  React.useEffect(() => {
    if (!s.toasts.length) return;
    const h = setTimeout(() => d({ type: 'DISMISS_TOAST', id: s.toasts[0].id }), 5500);
    return () => clearTimeout(h);
  }, [s.toasts, d]);
  const tone = { info: 'border-sky-300 bg-sky-50 text-sky-900', warn: 'border-amber-300 bg-amber-50 text-amber-900', danger: 'border-rose-300 bg-rose-50 text-rose-900', success: 'border-emerald-300 bg-emerald-50 text-emerald-900' };
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-[360px] max-w-[calc(100vw-2rem)]">
      {s.toasts.map((t) => (
        <div key={t.id} className={cx('border rounded-xl px-3 py-2.5 text-xs shadow-lg flex items-start gap-2 animate-[slidein_.25s_ease-out]', tone[t.tone])}>
          <div className="flex-1">{t.text}</div>
          {t.caseId && <button onClick={() => { d({ type: 'VIEW', view: 'command' }); d({ type: 'SELECT', id: t.caseId! }); d({ type: 'DISMISS_TOAST', id: t.id }); }} className="font-semibold underline whitespace-nowrap">Open</button>}
          <button onClick={() => d({ type: 'DISMISS_TOAST', id: t.id })} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      ))}
    </div>
  );
}
