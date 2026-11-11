'use client';

import React, { useEffect, useState } from 'react';
import { useHalqa, useCase } from '@/context/HalqaStore';
import { Case, Lang } from '@/types/halqa';
import { caseStatus, pathwayOf, fmtDateTime, fmtSlot, isClosed, currentStep } from '@/lib/engine';
import { URGENCY_FACTOR } from '@/lib/pathways';
import { LANGS, EXPLAIN, STEP_LABEL, t } from '@/lib/i18n';
import { slotsFor } from './case/NextAction';
import { Card, Badge, Btn, cx, inputCls } from './ui';
import { Volume2, Square, CheckCircle2, Circle, PhoneCall, MessageCircle, Languages, CalendarCheck, ShieldCheck, Heart, Sparkles, MonitorSmartphone, ArrowRight } from 'lucide-react';

export function PatientApp() {
  const { s, d } = useHalqa();
  const c = useCase(s.patientCaseId) ?? s.cases.find((x) => !x.historical)!;
  const demoCases = s.cases.filter((x) => !x.historical);

  return (
    <div className="grid lg:grid-cols-[1fr_400px_1fr] gap-6 items-start">
      <div className="space-y-3 lg:pt-6">
        <Card className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700">Patient experience</div>
          <h2 className="font-bold text-slate-900 text-lg mt-1">Clear, kind, in your own language</h2>
          <ul className="text-xs text-slate-600 mt-2 space-y-1.5">
            <li>• Privacy-safe SMS/WhatsApp — no diagnosis in the message, secure link only</li>
            <li>• Plain-language explanation (Arabic, English, Hindi, Urdu) with <b>read-aloud</b> for low literacy</li>
            <li>• <b>Teach-back check</b> confirms understanding — wrong answer or low confidence triggers a nurse call</li>
            <li>• “Delivery-tracker” journey: what’s next, who is responsible, by when</li>
            <li>• Self-book appointment, request call back, ask for an interpreter, message the team</li>
          </ul>
        </Card>
        <Card className="p-4">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">View the app as patient</label>
          <select value={c.id} onChange={(e) => d({ type: 'PATIENT_CASE', id: e.target.value })} className={cx(inputCls, 'mt-1 text-xs')}>
            {demoCases.map((x) => <option key={x.id} value={x.id}>{x.patient.name} — {pathwayOf(x).short} ({LANGS.find((l) => l.id === x.patient.lang)?.label})</option>)}
          </select>
          <Btn size="sm" tone="ghost" className="mt-2" onClick={() => { d({ type: 'VIEW', view: 'command' }); d({ type: 'SELECT', id: c.id }); }}>Open this case in Command Centre <ArrowRight className="w-3 h-3" /></Btn>
        </Card>
      </div>

      <Phone key={c.id} c={c} />

      <LiveFeed c={c} />
    </div>
  );
}

function Phone({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const [lang, setLang] = useState<Lang>(c.patient.lang);
  const [tab, setTab] = useState<'result' | 'journey' | 'help'>('result');
  const L = LANGS.find((l) => l.id === lang)!;
  const p = pathwayOf(c);
  const ex = EXPLAIN[c.pathwayId][lang];
  const notified = !!c.steps.NOTIFY?.completedAt;
  const withinDays = Math.max(3, Math.round(p.targetDaysToDiagnosis * URGENCY_FACTOR[c.urgency]));

  return (
    <div className="mx-auto w-[380px]">
      <div className="bg-slate-900 rounded-[2.6rem] p-2.5 shadow-2xl ring-1 ring-slate-700">
        <div className="bg-white rounded-[2.1rem] overflow-hidden h-[760px] flex flex-col" dir={L.dir}>
          <div className="bg-gradient-to-br from-teal-700 to-teal-900 text-white px-5 pt-6 pb-4">
            <div className="flex items-center justify-between text-[10px] opacity-80" dir="ltr"><span>{fmtDateTime(s.now).split(' ').pop()}</span><span>●●● 5G</span></div>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1.5 font-bold"><Heart className="w-4 h-4" />Halqa Care</div>
              <div className="flex gap-1" dir="ltr">
                {LANGS.map((l) => (
                  <button key={l.id} onClick={() => setLang(l.id)} className={cx('text-[10px] px-1.5 py-0.5 rounded-full border', lang === l.id ? 'bg-white text-teal-800 border-white font-bold' : 'border-white/30 text-white/90')}>{l.native}</button>
                ))}
              </div>
            </div>
            <div className="text-lg font-bold mt-3">{t(lang, 'hello')}, {c.patient.name.split(' ')[0]}</div>
            <div className="text-[11px] text-teal-100">{t(lang, 'reassure')}</div>
          </div>

          <div className="flex border-b border-slate-200 text-xs font-semibold">
            {(['result', 'journey', 'help'] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={cx('flex-1 py-2.5', tab === k ? 'text-teal-800 border-b-2 border-teal-700' : 'text-slate-500')}>{t(lang, `${k}Tab`)}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            {!notified ? (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 text-center text-xs text-slate-600 space-y-2">
                <PhoneCall className="w-6 h-6 mx-auto text-teal-600" />
                <div>{c.urgency === 'CRITICAL' ? t(lang, 'critical') : '…'}</div>
                <div className="text-[10px] text-slate-400" dir="ltr">(Demo: result not yet released to the patient — notify from the Command Centre first.)</div>
              </div>
            ) : (
              <>
                {tab === 'result' && <ResultTab c={c} lang={lang} ex={ex} withinDays={withinDays} />}
                {tab === 'journey' && <JourneyTab c={c} lang={lang} />}
                {tab === 'help' && <HelpTab c={c} lang={lang} />}
              </>
            )}
          </div>
          <div className="text-center text-[9px] text-slate-400 py-1.5 border-t" dir="ltr">Translations for demo — clinical use requires certified medical translation</div>
        </div>
      </div>
      {notified && (
        <div className="mt-3 rounded-xl bg-white border border-slate-200 p-3 text-xs shadow-sm" dir={L.dir}>
          <div className="text-[10px] font-bold uppercase text-slate-400">{t(lang, 'smsLabel')} · {c.notifications.find((n) => n.status !== 'FAILED' && n.status !== 'NO_ANSWER')?.channel}</div>
          <div className="text-slate-700 mt-0.5">{t(lang, 'sms')}</div>
        </div>
      )}
      {!notified && <div className="text-center mt-2"><Btn size="sm" tone="ghost" onClick={() => d({ type: 'SELECT', id: c.id })}>Open case to notify patient</Btn></div>}
    </div>
  );
}

function ResultTab({ c, lang, ex, withinDays }: { c: Case; lang: Lang; ex: { body: string; next: string }; withinDays: number }) {
  const { d } = useHalqa();
  const [speaking, setSpeaking] = useState(false);
  const [q1, setQ1] = useState<string | null>(null);
  const [q2, setQ2] = useState<string | null>(null);
  const [conf, setConf] = useState<number | null>(null);
  const L = LANGS.find((l) => l.id === lang)!;
  const acked = !!c.steps.ACK?.completedAt;
  const lowFlag = c.feedback && !acked;

  useEffect(() => () => { if (typeof window !== 'undefined') window.speechSynthesis?.cancel(); }, []);

  const speak = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(`${t(lang, 'title')}. ${t(lang, 'notDiagnosis')} ${ex.body}`);
    u.lang = L.speech;
    const v = synth.getVoices().find((vv) => vv.lang.toLowerCase().startsWith(lang));
    if (v) u.voice = v;
    u.rate = 0.92;
    u.onend = () => setSpeaking(false);
    synth.cancel(); synth.speak(u); setSpeaking(true);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900">{t(lang, 'title')}</h3>
        <button onClick={speak} className="flex items-center gap-1 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1">
          {speaking ? <Square className="w-3 h-3" /> : <Volume2 className="w-3.5 h-3.5" />}{speaking ? t(lang, 'stop') : t(lang, 'listen')}
        </button>
      </div>
      <div className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-0.5"><ShieldCheck className="w-3 h-3" />{t(lang, 'notDiagnosis')}</div>
      <p className="text-[13px] leading-relaxed text-slate-700">{ex.body}</p>
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
        <div className="text-[10px] font-bold uppercase text-amber-700">{t(lang, 'nextStep')}</div>
        <div className="font-bold text-slate-900">{ex.next}</div>
        <div className="text-xs text-amber-800">{t(lang, 'within', { n: withinDays })}</div>
      </div>

      {acked ? (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{t(lang, 'ackAlready')}</div>
      ) : lowFlag ? (
        <div className="rounded-2xl bg-sky-50 border border-sky-200 p-3 text-xs text-sky-900 flex items-start gap-2"><PhoneCall className="w-4 h-4 shrink-0" />{t(lang, 'wrongHelp')}</div>
      ) : (
        <div className="rounded-2xl border border-slate-200 p-3 space-y-3 bg-slate-50/60">
          <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-teal-600" />{t(lang, 'checkTitle')}</div>
          <Quiz lang={lang} q="q1" opts={['q1a', 'q1b', 'q1c']} value={q1} onChange={setQ1} />
          <Quiz lang={lang} q="q2" opts={['q2b', 'q2a', 'q2c']} value={q2} onChange={setQ2} />
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1">{t(lang, 'confidenceQ')}</div>
            <div className="flex gap-1.5" dir="ltr">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setConf(n)} className={cx('flex-1 h-9 rounded-lg border text-sm font-bold', conf === n ? 'bg-teal-700 text-white border-teal-700' : 'bg-white border-slate-300 text-slate-600')}>{n}</button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5"><span>{t(lang, 'notAtAll')}</span><span>{t(lang, 'very')}</span></div>
          </div>
          <button disabled={!q1 || !q2 || !conf}
            onClick={() => d({ type: 'PATIENT_ACK', id: c.id, q1: q1 === 'q1b', q2: q2 === 'q2a', confidence: conf!, lang })}
            className="w-full py-2.5 rounded-xl bg-teal-700 text-white font-semibold text-sm disabled:opacity-40">{t(lang, 'confirm')}</button>
        </div>
      )}
    </>
  );
}

function Quiz({ lang, q, opts, value, onChange }: { lang: Lang; q: string; opts: string[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-700 mb-1">{t(lang, q)}</div>
      <div className="space-y-1">
        {opts.map((o) => (
          <button key={o} onClick={() => onChange(o)} className={cx('w-full text-start text-xs px-2.5 py-2 rounded-lg border', value === o ? 'bg-teal-50 border-teal-600 text-teal-900 font-semibold' : 'bg-white border-slate-200 text-slate-700')}>{t(lang, o)}</button>
        ))}
      </div>
    </div>
  );
}

function JourneyTab({ c, lang }: { c: Case; lang: Lang }) {
  const { s, d } = useHalqa();
  const p = pathwayOf(c);
  const cur = currentStep(c);
  const st = caseStatus(c, s.now);
  const closed = isClosed(c);
  const canBook = cur?.id === 'BOOK' && c.referral?.status === 'ACCEPTED';
  return (
    <>
      {closed && <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex gap-2"><ShieldCheck className="w-5 h-5 shrink-0" />{t(lang, 'completed')}</div>}
      {!closed && cur && (
        <div className="rounded-2xl bg-teal-50 border border-teal-200 p-3 text-xs">
          <div className="text-[10px] font-bold uppercase text-teal-700">{t(lang, 'now')}</div>
          <div className="font-bold text-slate-900 text-sm">{STEP_LABEL[cur.id][lang]}</div>
          <div className="text-slate-600 mt-1">{t(lang, 'responsible')}: <b>{st.ownerName}</b></div>
          <div className="text-slate-600" dir="ltr">{t(lang, 'expectedBy')}: {fmtDateTime(st.dueAt)}</div>
          {cur.id === 'ACCEPT' && c.referral?.status === 'SENT' && <div className="mt-1 text-slate-600">{t(lang, 'waitingAccept')}</div>}
        </div>
      )}
      {canBook && (
        <div className="rounded-2xl border-2 border-teal-600 p-3 space-y-2">
          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5"><CalendarCheck className="w-4 h-4 text-teal-700" />{t(lang, 'chooseSlot')} · {EXPLAIN[c.pathwayId][lang].next}</div>
          {slotsFor(s.now).map((slot) => (
            <button key={slot} onClick={() => d({ type: 'BOOK', id: c.id, at: slot, location: c.referral!.facility, byPatient: true })} className="w-full text-start text-xs px-3 py-2 rounded-lg border border-slate-300 hover:border-teal-600 hover:bg-teal-50" dir="ltr">
              <b>{fmtSlot(slot)}</b><div className="text-[10px] text-slate-500">{c.referral!.facility}</div>
            </button>
          ))}
        </div>
      )}
      {c.appointment && c.steps.BOOK?.completedAt && !c.steps.ATTEND?.completedAt && (
        <div className="rounded-2xl bg-sky-50 border border-sky-200 p-3 text-xs"><div className="text-[10px] font-bold uppercase text-sky-700">{t(lang, 'booked')}</div><div className="font-bold" dir="ltr">{fmtSlot(c.appointment.at)}</div><div className="text-slate-600">{c.appointment.location}</div></div>
      )}
      <ol className="space-y-0">
        {p.steps.map((step, i) => {
          const done = !!c.steps[step.id]?.completedAt;
          const isCur = cur?.id === step.id && !closed;
          return (
            <li key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                {done ? <CheckCircle2 className="w-5 h-5 text-teal-600" /> : isCur ? <span className="w-5 h-5 rounded-full bg-amber-400 ring-4 ring-amber-100" /> : <Circle className="w-5 h-5 text-slate-300" />}
                {i < p.steps.length - 1 && <div className={cx('w-0.5 h-6', done ? 'bg-teal-300' : 'bg-slate-200')} />}
              </div>
              <div className={cx('text-xs pt-0.5', done ? 'text-slate-800' : isCur ? 'text-amber-800 font-bold' : 'text-slate-400')}>
                {STEP_LABEL[step.id][lang]}
                {done && <span className="text-[10px] text-slate-400 ms-1" dir="ltr">{fmtDateTime(c.steps[step.id]!.completedAt!).split(',')[0]}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function HelpTab({ c, lang }: { c: Case; lang: Lang }) {
  const { d } = useHalqa();
  const [msg, setMsg] = useState('');
  const pending = c.callbackRequestedAt && !c.callbackDoneAt;
  const thread = c.messages.filter((m) => m.thread === 'PATIENT');
  return (
    <>
      <button disabled={!!pending} onClick={() => d({ type: 'CALLBACK_REQUEST', id: c.id })}
        className={cx('w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2', pending ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-teal-700 text-white')}>
        <PhoneCall className="w-4 h-4" />{pending ? t(lang, 'callbackDone') : t(lang, 'callback')}
      </button>
      <button onClick={() => d({ type: 'INTERPRETER', id: c.id, on: !c.patient.needsInterpreter })}
        className={cx('w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border', c.patient.needsInterpreter ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-white border-slate-300 text-slate-700')}>
        <Languages className="w-4 h-4" />{c.patient.needsInterpreter ? t(lang, 'interpreterOn') : t(lang, 'interpreter')}
      </button>
      <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><MessageCircle className="w-4 h-4 text-teal-700" />{t(lang, 'message')}</div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {thread.map((m) => (
            <div key={m.id} className={cx('text-xs rounded-xl px-2.5 py-1.5 max-w-[85%]', m.fromRole === 'PATIENT' ? 'ms-auto bg-teal-700 text-white' : 'bg-slate-100 text-slate-800')}>
              <div className="text-[9px] opacity-70">{m.fromRole === 'PATIENT' ? t(lang, 'you') : `${t(lang, 'teamReply')} · ${m.from}`}</div>{m.text}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t(lang, 'placeholder')} className="flex-1 text-xs px-2.5 py-2 border border-slate-300 rounded-lg" />
          <button disabled={!msg.trim()} onClick={() => { d({ type: 'MESSAGE', id: c.id, thread: 'PATIENT', text: msg, asPatient: true }); setMsg(''); }} className="px-3 rounded-lg bg-teal-700 text-white text-xs font-semibold disabled:opacity-40">{t(lang, 'send')}</button>
        </div>
      </div>
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
        <div className="text-[10px] font-bold uppercase text-slate-500">{t(lang, 'yourTeam')}</div>
        {c.team.NAVIGATOR && <div><b>{c.team.NAVIGATOR.name}</b> · Care Navigator</div>}
        {c.accountable && <div><b>{c.accountable.name}</b> · {c.accountable.org}</div>}
        {c.team.SPECIALIST && <div><b>{c.team.SPECIALIST.name}</b> · {c.team.SPECIALIST.org}</div>}
      </div>
    </>
  );
}

function LiveFeed({ c }: { c: Case }) {
  const { s } = useHalqa();
  const st = caseStatus(c, s.now);
  const rows = [...c.audit].sort((a, b) => b.at - a.at).slice(0, 7);
  return (
    <div className="space-y-3 lg:pt-6">
      <Card className="p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5"><MonitorSmartphone className="w-3.5 h-3.5" />What the care team sees — live</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="teal">Step {st.stepNo}/{st.totalSteps}: {st.step?.label ?? 'Closed'}</Badge>
          <Badge>{st.ownerName}</Badge>
          {c.feedback && <Badge tone={c.feedback.confidence >= 3 ? 'emerald' : 'rose'}>Confidence {c.feedback.confidence}/5</Badge>}
          {c.patient.needsInterpreter && <Badge tone="violet">Interpreter</Badge>}
        </div>
        <ol className="mt-3 space-y-2 border-l-2 border-slate-200 ml-1 pl-3">
          {rows.map((a, i) => (
            <li key={i} className={cx('text-xs', i === 0 && 'animate-[fadein_.4s_ease-out]')}>
              <div className="text-[10px] font-mono text-slate-400">{fmtDateTime(a.at)}</div>
              <div className="font-semibold text-slate-800">{a.action}</div>
              <div className="text-slate-500">{a.actor}</div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
