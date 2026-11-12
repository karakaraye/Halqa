'use client';
/** Shown until the care team releases the result. */
import React from 'react';
import { Card } from '@/components/design/primitives';
import { CallbackButton, ScreenProps, useTr } from './common';

export function Waiting({ lang, patient }: ScreenProps) {
  const tr = useTr(lang);
  return (
    <div className="flex flex-col gap-5 pt-3">
      <Card className="flex flex-col gap-4 !p-6 text-center">
        <h1 className="text-[24px] font-bold leading-[1.25] text-slate-900">{tr('waitTitle')}</h1>
        <p className="text-[17px] leading-[1.45] text-slate-700">{tr('waitBody')}</p>
      </Card>
      <CallbackButton lang={lang} patient={patient} kind="secondary" />
    </div>
  );
}
