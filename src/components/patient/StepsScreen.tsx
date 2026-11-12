'use client';
/** Your steps screen; shows the booked appointment instead of the next-step card once booked. */
import React from 'react';
import { Check } from 'lucide-react';
import { Card, Chip, cx } from '@/components/design/primitives';
import { STEP_LABEL } from '@/lib/i18n';
import { Booked } from './Booked';
import { PageTitle, PillChip, ScreenProps, fmtShortDate, useTr } from './common';

export function StepsScreen({ lang, patient }: ScreenProps) {
  const tr = useTr(lang);
  const booked = !!patient.appointment;
  const canBook = patient.canBook && !booked && !!patient.facility;
  const currentIndex = patient.steps.findIndex((s) => !s.completedAt);
  const label = (s: PatientStepLike) => STEP_LABEL[s.id]?.[lang] ?? s.label;
  const current = currentIndex >= 0 ? patient.steps[currentIndex] : undefined;
  const nextTitle = current ? label(current) : patient.next?.label ?? '';

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>{booked ? tr('booked') : tr('stepsTitle')}</PageTitle>

      {booked ? (
        <Booked lang={lang} patient={patient} />
      ) : patient.next ? (
        <Card tone="teal" className="flex flex-col gap-3 !border-slate-200 !p-4 min-[375px]:!p-5">
          <PillChip dot="bg-teal-700">{tr('nextStep')}</PillChip>
          <h2 className="text-[22px] font-bold leading-[1.3] text-slate-900">{nextTitle}</h2>
          {patient.next.owner && <p className="text-[16px] leading-[1.45] text-slate-500">{tr('owner', { owner: patient.next.owner })}</p>}
          {canBook && <p className="text-[18px] leading-[1.45] text-slate-700">{tr('callToBook')}</p>}
        </Card>
      ) : null}

      {patient.steps.length > 0 && (
        <Card className="!p-5">
          <h2 className="text-[20px] font-bold leading-[1.3] text-slate-900">{tr('stepsTitle')}</h2>
          <ol className="mt-4 flex flex-col gap-5">
            {patient.steps.map((s, i) => {
              const state = s.completedAt ? 'done' : i === currentIndex ? 'now' : 'later';
              const sub = s.completedAt
                ? fmtShortDate(lang, s.completedAt)
                : state === 'now' && patient.next?.dueAt
                  ? tr('dueBy', { date: fmtShortDate(lang, patient.next.dueAt) })
                  : null;
              return (
                <li key={s.id} className="flex items-center gap-3" aria-current={state === 'now' ? 'step' : undefined}>
                  <span
                    aria-hidden="true"
                    className={cx(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                      state === 'done' && 'bg-teal-700 text-white',
                      state === 'now' && 'border-[3px] border-teal-700 bg-white',
                      state === 'later' && 'border-2 border-slate-400 bg-white',
                    )}
                  >
                    {state === 'done' && <Check size={16} strokeWidth={3} />}
                    {state === 'now' && <span className="h-3 w-3 rounded-full bg-teal-700" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cx('break-words text-[18px] leading-[1.3] text-slate-900', state !== 'later' && 'font-semibold')}>{label(s)}</p>
                    {sub && <p className="mt-0.5 text-[15px] leading-[1.35] text-slate-500">{sub}</p>}
                  </div>
                  <Chip tone={state === 'done' ? 'emerald' : state === 'now' ? 'teal' : 'slate'} dot className="shrink-0">
                    {tr(state)}
                  </Chip>
                </li>
              );
            })}
          </ol>
          {currentIndex === -1 && <p className="mt-4 text-[16px] text-slate-500">{tr('allDone')}</p>}
        </Card>
      )}
    </div>
  );
}

type PatientStepLike = ScreenProps['patient']['steps'][number];
