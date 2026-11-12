'use client';
/** My work (Figma: "My work — desktop", node 11:22). Navigator and doctor worklist. */
import React, { useMemo } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { priorityScore, isClosed } from '@/lib/engine';
import { hourOfDay } from '@/lib/time';
import { Avatar, Button, Chip, Empty, Loading, cx, initialsOf } from '@/components/design/primitives';
import {
  LANG_NAME, STATUS_LABEL, STATUS_TONE, WorkStatus, dueLine, firstName, nextActionText, workStatus,
} from './caseView';

function greeting(now: number) {
  const hour = hourOfDay(now);
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const SUMMARY: Array<{ key: WorkStatus; title: string; text: string; box: string; num: string }> = [
  { key: 'NOW', title: 'Needs you now', text: 'Act first', box: 'bg-rose-50', num: 'text-rose-600' },
  { key: 'LATE', title: 'Late', text: 'Past its time', box: 'bg-rose-50', num: 'text-rose-600' },
  { key: 'DUE_SOON', title: 'Due soon', text: 'Coming up today', box: 'bg-amber-50', num: 'text-amber-600' },
  { key: 'WAITING', title: 'Waiting for others', text: 'Nothing to do yet', box: 'bg-sky-50', num: 'text-sky-600' },
];

export function MyWork() {
  const { s, d, user } = useHalqa();
  const role = user.person.role;
  const now = s.now;

  const rows = useMemo(() => (s.cases ?? [])
    .filter((c) => !c.historical && !isClosed(c))
    .map((c) => ({ c, status: workStatus(c, role, now), score: priorityScore(c, now) }))
    .sort((a, b) => {
      // Cases waiting on others go below cases this person can act on.
      const wa = a.status === 'WAITING' ? 1 : 0;
      const wb = b.status === 'WAITING' ? 1 : 0;
      return wa - wb || b.score - a.score;
    }), [s.cases, role, now]);

  if (!Array.isArray(s.cases)) return <Loading label="Loading your patients…" />;

  const counts = SUMMARY.reduce<Record<string, number>>((acc, k) => {
    acc[k.key] = rows.filter((r) => r.status === k.key).length;
    return acc;
  }, {});
  const timeGreeting = greeting(now);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-page-title text-slate-900">{timeGreeting}, {firstName(user.person.name)}</h1>
        <p className="mt-2 text-[18px] text-slate-500">Here is what needs you today. Start with the first card.</p>
      </div>

      <ul aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        {SUMMARY.map((k) => (
          <li key={k.key} className={cx('rounded-card p-5 sm:p-6', k.box)}>
            <p className={cx('text-[48px] font-bold leading-[56px]', k.num)}>{counts[k.key]}</p>
            <p className="mt-2 text-[18px] font-semibold text-slate-900">{k.title}</p>
            <p className="text-[16px] text-slate-500">{k.text}</p>
          </li>
        ))}
      </ul>

      <section aria-labelledby="your-patients">
        <h2 id="your-patients" className="text-[24px] font-semibold leading-8 text-slate-900">Your patients</h2>
        {rows.length === 0 ? (
          <div className="mt-4">
            <Empty title="All clear." text={`Nothing needs you right now. Enjoy your ${timeGreeting.replace('Good ', '')}.`} />
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {rows.map(({ c, status }) => {
              const urgent = status === 'NOW' || status === 'LATE';
              const waiting = status === 'WAITING';
              const lang = LANG_NAME[c.patient.lang] ?? c.patient.lang;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-4 rounded-card border border-slate-200 bg-white p-4 sm:flex-nowrap sm:px-6 sm:py-6">
                  <Avatar initials={initialsOf(c.patient.name)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[20px] font-semibold leading-7 text-slate-900">{c.patient.name}</p>
                    <p className="text-[16px] text-slate-500">{c.patient.age} · Speaks {lang}</p>
                    <p className="mt-0.5 text-[18px] text-slate-900">{nextActionText(c, role, now)}</p>
                  </div>
                  <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
                      <span className="text-[16px] text-slate-500">{dueLine(c, status, now)}</span>
                    </div>
                    <Button
                      kind={urgent ? 'primary' : 'secondary'}
                      onClick={() => d({ type: 'SELECT', id: c.id })}
                      aria-label={`${waiting ? 'View' : 'Open'} ${c.patient.name}`}
                      className="min-w-[96px]"
                    >
                      {waiting ? 'View' : 'Open'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
