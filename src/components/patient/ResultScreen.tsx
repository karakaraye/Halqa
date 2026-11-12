'use client';
/** Your result screen. Never shows a diagnosis word. */
import React, { useEffect, useState } from 'react';
import { Volume2, Square } from 'lucide-react';
import { Button, Card, Chip } from '@/components/design/primitives';
import { langInfo } from '@/lib/i18n';
import { ScreenProps, useTr } from './common';

function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

export function ResultScreen({ lang, patient, onContinue, onSteps }: ScreenProps & { onContinue: () => void; onSteps: () => void }) {
  const tr = useTr(lang);
  const [speaking, setSpeaking] = useState(false);

  // Stop reading aloud when the language changes or the screen closes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading aloud stops when the language changes, which is an external speech engine
    setSpeaking(false);
    if (speechAvailable()) window.speechSynthesis.cancel();
    return () => { if (speechAvailable()) window.speechSynthesis.cancel(); };
  }, [lang]);

  const listen = () => {
    if (!speechAvailable()) return;
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    const text = [tr('resultTitle'), tr('closerCheck'), tr('notDiagnosis'), tr('resultBody'), tr('nextTitle'), tr('nextBody')].join(' ');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langInfo(lang).speech;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  const resultCard = (
    <Card className="flex flex-col items-start gap-3 !p-5">
      <h1 className="text-[24px] font-bold leading-[1.25] text-slate-900">{tr('resultTitle')}</h1>
      <Chip tone="amber" dot>{tr('closerCheck')}</Chip>
      <p className="text-[20px] font-bold leading-[1.35] text-teal-800">{tr('notDiagnosis')}</p>
      <p className="text-[18px] leading-[1.45] text-slate-700">{tr('resultBody')}</p>
      {patient.understood && (
        <p className="mt-1 text-[18px] font-semibold leading-[1.45] text-emerald-600">{tr('understood')}</p>
      )}
    </Card>
  );

  if (patient.understood) {
    return (
      <div className="flex flex-col gap-5">
        {resultCard}
        <Button kind="secondary" size="lg" full onClick={onSteps}>{tr('goSteps')}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {resultCard}
      <Card tone="amber" className="flex flex-col gap-3 !border-slate-200 !p-5">
        <h2 className="text-[20px] font-bold leading-[1.3] text-slate-900">{tr('nextTitle')}</h2>
        <p className="text-[18px] leading-[1.45] text-slate-700">{tr('nextBody')}</p>
      </Card>
      <Button kind="secondary" size="lg" full onClick={listen} aria-pressed={speaking}>
        {speaking
          ? <Square aria-hidden="true" size={22} strokeWidth={2} />
          : <Volume2 aria-hidden="true" size={24} strokeWidth={2} className="rtl:-scale-x-100" />}
        {speaking ? tr('stop') : tr('listen')}
      </Button>
      <Button kind="primary" size="lg" full onClick={onContinue}>{tr('continue')}</Button>
    </div>
  );
}
