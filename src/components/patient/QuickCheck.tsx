'use client';
/** Quick check (teach-back). Sends the chosen answer keys; the server scores them (src/domain/teachback.ts). */
import React, { useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import type { Q1Answer, Q2Answer } from '@/domain/teachback';
import { SaveButton, cx } from '@/components/design/primitives';
import { PageTitle, ScreenProps, useTr } from './common';

function ChoiceGroup({ name, legend, options, value, onChange, tr }: {
  name: string; legend: string; options: string[]; value: string | null;
  onChange: (v: string) => void; tr: (k: string) => string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 text-[18px] font-bold leading-[1.35] text-slate-900">{legend}</legend>
      {options.map((key) => {
        const on = value === key;
        return (
          <label
            key={key}
            className={cx(
              'flex min-h-[64px] cursor-pointer items-center gap-4 rounded-card border-2 px-4 py-3 transition-colors',
              'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-teal-700',
              on ? 'border-teal-700 bg-teal-50' : 'border-slate-200 bg-white hover:border-slate-400',
            )}
          >
            <input type="radio" name={name} value={key} checked={on} onChange={() => onChange(key)} className="sr-only" />
            <span
              aria-hidden="true"
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                on ? 'border-teal-700 bg-teal-700' : 'border-slate-400 bg-white',
              )}
            >
              {on && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
            </span>
            <span className={cx('min-w-0 text-[17px] leading-[1.35] text-slate-900', on && 'font-semibold')}>{tr(key)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function QuickCheck({ lang, patient, onDone }: ScreenProps & { onDone: () => void }) {
  const { d } = useHalqa();
  const tr = useTr(lang);
  const [c1, setC1] = useState<string | null>(null);
  const [c2, setC2] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const ready = !!c1 && !!c2 && confidence !== null;

  const send = () => {
    if (!ready) return;
    d({ type: 'PATIENT_ACK', id: patient.id, answers: { q1: c1 as Q1Answer, q2: c2 as Q2Answer }, confidence: confidence!, lang });
    onDone();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageTitle>{tr('quickTitle')}</PageTitle>
        <p className="text-[17px] leading-[1.45] text-slate-700">{tr('quickIntro')}</p>
      </div>
      <ChoiceGroup name="q1" legend={`1. ${tr('q1')}`} options={['q1a', 'q1b', 'q1c']} value={c1} onChange={setC1} tr={tr} />
      <ChoiceGroup name="q2" legend={`2. ${tr('q2')}`} options={['q2a', 'q2b', 'q2c']} value={c2} onChange={setC2} tr={tr} />
      <fieldset className="flex min-w-0 flex-col">
        <legend className="mb-3 text-[18px] font-bold leading-[1.35] text-slate-900">3. {tr('q3')}</legend>
        <div className="flex justify-between gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = confidence === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                aria-label={n === 1 ? `1 (${tr('notSure')})` : n === 5 ? `5 (${tr('verySure')})` : String(n)}
                onClick={() => setConfidence(n)}
                className={cx(
                  'flex aspect-square w-full max-w-[56px] min-w-[48px] items-center justify-center rounded-full border-2 text-[20px] font-bold transition-colors',
                  on ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-400 bg-white text-slate-900 hover:border-teal-700',
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[15px] text-slate-500">
          <span>{tr('notSure')}</span>
          <span>{tr('verySure')}</span>
        </div>
      </fieldset>
      <SaveButton kind="primary" size="lg" full tr={tr} disabled={!ready} onClick={send}>{tr('sendAnswers')}</SaveButton>
    </div>
  );
}
