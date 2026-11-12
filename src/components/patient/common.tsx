'use client';
/** Shared pieces for the patient phone screens. */
import React from 'react';
import { Phone } from 'lucide-react';
import type { Lang } from '@/types/halqa';
import type { PatientSummary } from '@/shared/protocol';
import { langInfo, t } from '@/lib/i18n';
import { formatter } from '@/lib/time';
import { useHalqa } from '@/context/HalqaStore';
import { SaveButton, cx } from '@/components/design/primitives';

export interface ScreenProps {
  lang: Lang;
  patient: PatientSummary;
}

/** Translator bound to the screen language. */
export const useTr = (lang: Lang) => (key: string, vars?: Record<string, string | number>) => t(lang, key, vars);

const fmt = (lang: Lang, opts: Intl.DateTimeFormatOptions) => formatter(langInfo(lang).locale, opts);

/** "12 Nov" */
export const fmtShortDate = (lang: Lang, at: number) => fmt(lang, { day: 'numeric', month: 'short' }).format(at);
/** "10:30 am" */
export const fmtTime = (lang: Lang, at: number) => fmt(lang, { hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
/** "Thursday 14 November, 10:30 am" */
export const fmtLongDateTime = (lang: Lang, at: number) => {
  const sep = langInfo(lang).dir === 'rtl' ? '، ' : ', ';
  return `${fmt(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(at)}${sep}${fmtTime(lang, at)}`;
};

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-[28px] font-bold leading-[1.25] text-slate-900">{children}</h1>;
}

/** White pill chip with a coloured dot ("Next step" / "Booked"). */
export function PillChip({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[16px] font-semibold leading-[1.3] text-slate-900">
      <span aria-hidden="true" className={cx('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
      {children}
    </span>
  );
}

/** "Ask for a call back": used on Help (primary) and Waiting (secondary). */
export function CallbackButton({ patient, lang, kind }: ScreenProps & { kind: 'primary' | 'secondary' }) {
  const { d } = useHalqa();
  const tr = useTr(lang);
  const pending = patient.callbackPending;
  return (
    <SaveButton
      kind={kind}
      size="lg"
      full
      tr={tr}
      disabled={pending}
      onClick={() => d({ type: 'CALLBACK_REQUEST', id: patient.id })}
    >
      <Phone aria-hidden="true" size={24} strokeWidth={2} />
      {pending ? tr('callbackDone') : tr('callback')}
    </SaveButton>
  );
}
