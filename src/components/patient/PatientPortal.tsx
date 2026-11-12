'use client';
/**
 * Patient phone portal. Patients sign in on the shared sign-in screen (there is no SMS code sign-in:
 * no SMS provider exists). Arabic and Urdu are language choices that switch the layout to right-to-left.
 */
import React, { useEffect, useId, useState } from 'react';
import { FileText, LifeBuoy, ListChecks, LogOut, type LucideIcon } from 'lucide-react';
import type { Lang } from '@/types/halqa';
import { useHalqa } from '@/context/HalqaStore';
import { Loading, Select, cx } from '@/components/design/primitives';
import { StoreBanners } from '@/components/design/StoreBanners';
import { LANGS, langInfo } from '@/lib/i18n';
import { useTr } from './common';
import { ResultScreen } from './ResultScreen';
import { QuickCheck } from './QuickCheck';
import { AllDone } from './AllDone';
import { StepsScreen } from './StepsScreen';
import { HelpScreen } from './HelpScreen';
import { Waiting } from './Waiting';

type Tab = 'result' | 'steps' | 'help';
type ResultStep = 'result' | 'quick' | 'done';

const NAV: { id: Tab; key: string; Icon: LucideIcon }[] = [
  { id: 'result', key: 'navResult', Icon: FileText },
  { id: 'steps', key: 'navSteps', Icon: ListChecks },
  { id: 'help', key: 'navHelp', Icon: LifeBuoy },
];

export function PatientPortal() {
  const { patient, signOut, busy } = useHalqa();
  const [lang, setLang] = useState<Lang>(() => patient?.lang ?? 'en');
  const [tab, setTab] = useState<Tab>('result');
  const [step, setStep] = useState<ResultStep>('result');
  const langId = useId();
  const tr = useTr(lang);
  const dir = langInfo(lang).dir;

  // Each new screen starts at the top.
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, [tab, step]);

  const firstName = (patient?.name ?? '').trim().split(/\s+/)[0] ?? '';
  // The name is isolated so right-to-left layouts do not move the punctuation around it.
  const [helloBefore, helloAfter = ''] = tr('hello', { name: '{name}' }).split('{name}');
  const released = !!patient?.released;

  let screen: React.ReactNode;
  if (!patient) screen = <Loading />;
  else if (!released) screen = tab === 'help' ? <HelpScreen lang={lang} patient={patient} /> : <Waiting lang={lang} patient={patient} />;
  else if (tab === 'steps') screen = <StepsScreen lang={lang} patient={patient} />;
  else if (tab === 'help') screen = <HelpScreen lang={lang} patient={patient} />;
  else if (step === 'quick' && !patient.understood) screen = <QuickCheck lang={lang} patient={patient} onDone={() => setStep('done')} />;
  else if (step === 'done') screen = <AllDone lang={lang} patient={patient} onBack={() => setStep('result')} />;
  else screen = <ResultScreen lang={lang} patient={patient} onContinue={() => setStep('quick')} onSteps={() => setTab('steps')} />;

  return (
    <div dir={dir} lang={lang} className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <StoreBanners tr={tr} />
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col">
        <header className="bg-teal-800 px-4 pb-4 pt-5 text-white min-[375px]:px-5">
          <div className="flex items-center justify-between gap-3">
            <p className="shrink-0 text-[24px] font-bold leading-[1.2]" dir="ltr">Halqa</p>
            <p className="min-w-0 truncate text-[18px] font-medium leading-[1.3]">{helloBefore}<bdi>{firstName}</bdi>{helloAfter}</p>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label htmlFor={langId} className="sr-only">{tr('language')}</label>
            <Select large id={langId} value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="min-w-0 grow !border-white rtl:!pl-10 rtl:!pr-4">
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>{l.id === 'en' ? l.label : `${l.label} / ${l.native}`}</option>
              ))}
            </Select>
            <button
              type="button"
              disabled={busy}
              onClick={() => { void signOut(); }}
              className="inline-flex min-h-[56px] shrink-0 items-center gap-2 rounded-button border-2 border-white/70 px-3 text-[16px] font-semibold text-white hover:bg-white/10 disabled:opacity-60"
            >
              <LogOut aria-hidden="true" size={20} className="rtl:-scale-x-100" />
              {tr('signOut')}
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 pb-8 pt-7 min-[375px]:px-5">
          {screen}
        </main>

        <nav aria-label="Patient" className="sticky bottom-0 z-10 border-t border-slate-200 bg-white px-3 pb-6 pt-3">
          <ul className="flex gap-2">
            {NAV.map(({ id, key, Icon }) => {
              const active = tab === id;
              return (
                <li key={id} className="min-w-0 flex-1">
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => { setTab(id); if (id === 'result' && step === 'done') setStep('result'); }}
                    className={cx(
                      'flex min-h-[72px] w-full flex-col items-center justify-center gap-1 rounded-[20px] px-1 transition-colors',
                      active ? 'bg-teal-50 text-teal-800' : 'text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    <Icon aria-hidden="true" size={26} strokeWidth={2} />
                    <span className={cx('max-w-full text-center text-[15px] leading-[1.2] [overflow-wrap:anywhere] min-[375px]:text-[16px]', active ? 'font-bold' : 'font-semibold')}>{tr(key)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
