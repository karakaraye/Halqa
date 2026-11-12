'use client';
/** Shown after the patient sends the quick-check answers. */
import React from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/design/primitives';
import { ScreenProps, useTr } from './common';

export function AllDone({ lang, patient, onBack }: ScreenProps & { onBack: () => void }) {
  const tr = useTr(lang);
  const names = patient.team.map((m) => m.name).join(', ');
  return (
    <div className="flex flex-col items-center gap-6 pt-6 text-center">
      <span aria-hidden="true" className="flex h-32 w-32 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <Check size={64} strokeWidth={3} />
      </span>
      <div className="flex flex-col gap-4">
        <h1 role="status" className="text-[28px] font-bold leading-[1.25] text-slate-900">{tr('thanks')}</h1>
        <p className="text-[18px] leading-[1.45] text-slate-700">{tr('thanksBody')}</p>
        {names && <p className="text-[16px] leading-[1.45] text-slate-500">{tr('teamLine', { names })}</p>}
      </div>
      <Button kind="secondary" size="lg" full onClick={onBack}>{tr('backResult')}</Button>
      <p className="text-[16px] leading-[1.45] text-slate-500">{tr('askHint')}</p>
    </div>
  );
}
