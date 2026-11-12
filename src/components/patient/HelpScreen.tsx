'use client';
/** Help screen. No call-back time is promised: there is no approved service level for it. */
import React, { useId, useState } from 'react';
import { AlertTriangle, Globe, MessageSquare } from 'lucide-react';
import { useHalqa } from '@/context/HalqaStore';
import { Avatar, Button, Card, SaveButton, Textarea, cx, initialsOf } from '@/components/design/primitives';
import { fmtDateTime } from '@/lib/time';
import { CallbackButton, PageTitle, ScreenProps, useTr } from './common';

function Line({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-center text-[16px] leading-[1.45] text-slate-500">{children}</p>;
}

export function HelpScreen({ lang, patient }: ScreenProps) {
  const { d } = useHalqa();
  const tr = useTr(lang);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const fieldId = useId();

  const send = () => {
    const body = text.trim();
    if (!body) return;
    d({ type: 'MESSAGE', id: patient.id, thread: 'PATIENT', text: body, asPatient: true });
    setText('');
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>{tr('helpTitle')}</PageTitle>

      <div>
        <CallbackButton lang={lang} patient={patient} kind="primary" />
        <Line>{tr('callbackLine')}</Line>
      </div>

      <div>
        <SaveButton
          kind="secondary"
          size="lg"
          full
          tr={tr}
          aria-pressed={patient.needsInterpreter}
          onClick={() => d({ type: 'INTERPRETER', id: patient.id, on: !patient.needsInterpreter })}
        >
          <Globe aria-hidden="true" size={24} strokeWidth={2} />
          {patient.needsInterpreter ? tr('interpreterOn') : tr('interpreter')}
        </SaveButton>
        <Line>{tr('interpreterLine')}</Line>
      </div>

      <div>
        <Button kind="secondary" size="lg" full aria-expanded={composing} onClick={() => setComposing((v) => !v)}>
          <MessageSquare aria-hidden="true" size={24} strokeWidth={2} className="rtl:-scale-x-100" />
          {tr('message')}
        </Button>
        <Line>{tr('messageLine')}</Line>
      </div>

      {(composing || patient.messages.length > 0) && (
        <Card className="flex flex-col gap-4 !p-5">
          {patient.messages.length > 0 && (
            <ul className="flex flex-col gap-3">
              {patient.messages.map((m) => (
                <li key={m.id} className={cx('flex', m.patient ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[85%] rounded-card px-4 py-3', m.patient ? 'bg-teal-50' : 'bg-slate-100')}>
                    <p className="text-[14px] font-semibold text-slate-700">
                      {m.from} <span className="font-normal text-slate-500">· <time dir="ltr">{fmtDateTime(m.at)}</time></span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[17px] leading-[1.45] text-slate-900">{m.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {composing && (
            <div className="flex flex-col gap-3">
              <label htmlFor={fieldId} className="sr-only">{tr('yourMessage')}</label>
              <Textarea
                id={fieldId}
                value={text}
                maxLength={5000}
                placeholder={tr('placeholder')}
                onChange={(e) => setText(e.target.value)}
                className="text-[17px]"
              />
              <SaveButton kind="primary" size="lg" full tr={tr} disabled={!text.trim()} onClick={send}>{tr('send')}</SaveButton>
            </div>
          )}
        </Card>
      )}

      {patient.team.length > 0 && (
        <Card className="!p-5">
          <h2 className="text-[20px] font-bold leading-[1.3] text-slate-900">{tr('yourTeam')}</h2>
          <ul className="mt-4 flex flex-col gap-4">
            {patient.team.map((m) => (
              <li key={`${m.name}-${m.org}`} className="flex items-center gap-3">
                <Avatar initials={initialsOf(m.name)} />
                <div className="min-w-0">
                  <p className="break-words text-[18px] font-semibold leading-[1.3] text-slate-900">{m.name}</p>
                  <p className="break-words text-[16px] leading-[1.35] text-slate-500">{m.org}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div role="note" className="flex items-start gap-3 rounded-card border border-slate-200 bg-amber-50 p-5">
        <AlertTriangle aria-hidden="true" size={24} className="mt-0.5 shrink-0 text-amber-600" />
        <p className="text-[18px] font-semibold leading-[1.45] text-slate-900">{tr('emergency')}</p>
      </div>
    </div>
  );
}
