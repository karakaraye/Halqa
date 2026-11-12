'use client';
/** Booked appointment. "Add to my calendar" builds a local .ics file; no network calls. */
import React, { useState } from 'react';
import { CalendarDays, CalendarPlus, ClipboardCheck, MapPin } from 'lucide-react';
import { useHalqa } from '@/context/HalqaStore';
import { Button, Card, SaveButton } from '@/components/design/primitives';
import { PillChip, ScreenProps, fmtLongDateTime, useTr } from './common';

const icsDate = (at: number) => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function buildIcs(appointment: { at: number; location: string }, uidSeed: string) {
  const end = appointment.at + 30 * 60_000;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Halqa//Patient portal//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${icsText(uidSeed)}-${appointment.at}@halqa`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(appointment.at)}`,
    `DTEND:${icsDate(end)}`,
    'SUMMARY:Halqa appointment',
    `LOCATION:${icsText(appointment.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function downloadIcs(appointment: { at: number; location: string }, uidSeed: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([buildIcs(appointment, uidSeed)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'halqa-appointment.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Booked({ lang, patient }: ScreenProps) {
  const { d } = useHalqa();
  const tr = useTr(lang);
  const [asked, setAsked] = useState(false);
  const appt = patient.appointment;
  if (!appt) return null;

  const askChange = () => {
    d({ type: 'MESSAGE', id: patient.id, thread: 'PATIENT', text: 'I need to change my appointment.', asPatient: true });
    setAsked(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <Card tone="sky" className="flex flex-col gap-4 !border-slate-200 !p-5">
        <PillChip dot="bg-emerald-600">{tr('bookedChip')}</PillChip>
        <h2 className="text-[20px] font-bold leading-[1.3] text-slate-900">{tr('appointment')}</h2>
        <div className="flex items-start gap-3">
          <CalendarDays aria-hidden="true" size={24} className="mt-0.5 shrink-0 text-sky-600" />
          <p className="min-w-0 text-[20px] font-bold leading-[1.35] text-slate-900">{fmtLongDateTime(lang, appt.at)}</p>
        </div>
        <div className="flex items-start gap-3">
          <MapPin aria-hidden="true" size={24} className="mt-0.5 shrink-0 text-sky-600" />
          <p className="min-w-0 break-words text-[18px] leading-[1.45] text-slate-900">{appt.location}</p>
        </div>
        <div className="flex items-start gap-3">
          <ClipboardCheck aria-hidden="true" size={24} className="mt-0.5 shrink-0 text-sky-600" />
          <p className="min-w-0 text-[18px] leading-[1.45] text-slate-700">{tr('bring')}</p>
        </div>
      </Card>
      <Button kind="secondary" size="lg" full onClick={() => downloadIcs(appt, patient.id)}>
        <CalendarPlus aria-hidden="true" size={24} strokeWidth={2} />
        {tr('addCalendar')}
      </Button>
      <SaveButton kind="quiet" size="lg" full tr={tr} disabled={asked} onClick={askChange}>{tr('change')}</SaveButton>
      {asked && <p role="status" className="text-center text-[16px] text-slate-500">{tr('changeSent')}</p>}
    </div>
  );
}
