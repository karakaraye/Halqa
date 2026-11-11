'use client';

import React, { useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { Case, Channel } from '@/types/halqa';
import { caseStatus, fmtSlot, pathwayOf, fmtDateTime } from '@/lib/engine';
import { SPECIALIST_SERVICES, REJECT_REASONS, DAY, HOUR, STAFF_BY_ROLE, ROLE_LABEL } from '@/lib/pathways';
import { t as tr } from '@/lib/i18n';
import { Btn, Field, inputCls, cx, Badge } from '../ui';
import { Phone, MessageSquare, Smartphone, Send, PhoneOff, CheckCircle2, CalendarDays, XCircle, Inbox, ArrowRight, Info } from 'lucide-react';

export function NextAction({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const st = caseStatus(c, s.now);
  const step = st.step;
  const p = pathwayOf(c);
  if (!step || c.closure?.status === 'PENDING_APPROVAL') return null;

  const wrap = (children: React.ReactNode) => (
    <div className="rounded-xl border-2 border-teal-600/30 bg-teal-50/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-teal-800">Next action · step {st.stepNo} of {st.totalSteps}</div>
          <div className="font-bold text-slate-900">{step.label}</div>
          <div className="text-xs text-slate-500">{step.hint}</div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>Owner: <b className={st.unassigned ? 'text-rose-600' : 'text-slate-800'}>{st.unassigned ? 'UNASSIGNED' : st.ownerName}</b></div>
          <div>Due {fmtDateTime(st.dueAt)}</div>
        </div>
      </div>
      {children}
    </div>
  );

  // Ownership gap blocks clinical work until someone is assigned
  if (st.unassigned && step.ownerRole !== 'PATIENT' && step.ownerRole !== 'SPECIALIST') {
    const role = step.ownerRole as 'PCP' | 'NAVIGATOR';
    return wrap(<AssignInline c={c} role={role} />);
  }

  switch (step.id) {
    case 'NOTIFY': return wrap(<Notify c={c} />);
    case 'ACK': return wrap(<Ack c={c} />);
    case 'CONSULT': return wrap(<SimpleComplete c={c} stepId="CONSULT" options={['Tele-consultation (video)', 'Phone consultation', 'In-person visit', 'Asynchronous e-consult']} placeholder="Summary of discussion, symptoms, agreed plan…" cta="Record consultation" />);
    case 'CONFIRM_TEST': return wrap(<SimpleComplete c={c} stepId="CONFIRM_TEST" options={['Repeat HbA1c ≥ 6.5% — confirmed', 'Fasting glucose ≥ 126 mg/dL — confirmed', 'Repeat HbA1c 5.7–6.4% — prediabetes', 'Repeat HbA1c < 5.7% — not confirmed']} placeholder="Result value & lab reference…" cta="Record confirmatory result" />);
    case 'REFER': return wrap(<Refer c={c} />);
    case 'ACCEPT': return wrap(<Accept c={c} />);
    case 'BOOK': return wrap(<Book c={c} />);
    case 'ATTEND': return wrap(<Attend c={c} />);
    case 'OUTCOME': return wrap(<Outcome c={c} />);
    case 'CARE_PLAN': return wrap(<SimpleComplete c={c} stepId="CARE_PLAN" options={carePlanOptions(c)} placeholder="Treatment / surveillance details, next date…" cta="Record care plan started" />);
    case 'CLOSE': return wrap(<div className="text-sm text-slate-700"><ArrowRight className="w-4 h-4 text-teal-600 inline -mt-0.5 me-1" />All clinical steps done. Complete the <b>closure gate</b> below with evidence and signature.</div>);
  }
  return wrap(<div className="text-sm text-slate-500">{p.name}</div>);
}

function carePlanOptions(c: Case) {
  const cat = c.outcomeCategory;
  if (c.pathwayId === 'DIABETES_HBA1C') return ['Metformin started + diabetes education (DSMES) booked', 'Lifestyle programme + dietitian referral, review in 3 months', 'Referred to endocrinology (complex case)'];
  if (cat === 'DISEASE') return ['MDT discussed — treatment started', 'Referred to oncology — first treatment date booked'];
  if (cat === 'PRECANCER') return ['Lesion treated — surveillance scheduled', 'Surveillance procedure booked per guideline'];
  return ['Return to routine screening interval', 'Short-interval follow-up scheduled'];
}

function AssignInline({ c, role }: { c: Case; role: 'PCP' | 'NAVIGATOR' }) {
  const { d } = useHalqa();
  const [pid, setPid] = useState(STAFF_BY_ROLE[role][0].id);
  return (
    <div className="space-y-2">
      <div className="text-sm text-rose-700 font-semibold flex items-center gap-1.5"><Info className="w-4 h-4" />No {ROLE_LABEL[role].toLowerCase()} owns this step. Assign one before work can continue.</div>
      <div className="flex gap-2">
        <select value={pid} onChange={(e) => setPid(e.target.value)} className={inputCls}>
          {STAFF_BY_ROLE[role].map((p) => <option key={p.id} value={p.id}>{p.name} — {p.org}</option>)}
        </select>
        <Btn tone="primary" onClick={() => d({ type: 'ASSIGN', id: c.id, role, personId: pid })}>Assign owner</Btn>
      </div>
    </div>
  );
}

function Notify({ c }: { c: Case }) {
  const { d } = useHalqa();
  const critical = c.urgency === 'CRITICAL';
  const [note, setNote] = useState('');
  const fails = c.notifications.filter((n) => n.status === 'FAILED' || n.status === 'NO_ANSWER').length;
  const digital: { ch: Channel; icon: React.ReactNode; label: string }[] = [
    { ch: 'WHATSAPP', icon: <MessageSquare className="w-4 h-4" />, label: 'WhatsApp' },
    { ch: 'SMS', icon: <Send className="w-4 h-4" />, label: 'SMS' },
    { ch: 'APP', icon: <Smartphone className="w-4 h-4" />, label: 'App push' },
  ];
  return (
    <div className="space-y-3">
      {critical && <div className="text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-2.5"><b>Safety rule:</b> CRITICAL results must be delivered by a human phone call first. Digital messages are held until the patient is reached.</div>}
      {fails > 0 && <div className="text-xs text-amber-800 font-semibold">{fails} failed attempt{fails > 1 ? 's' : ''} so far — 3 failures (or 1 on CRITICAL) auto-escalates to the Clinical Lead.</div>}
      <div className="rounded-lg bg-white border border-slate-200 p-2.5 text-xs">
        <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Privacy-safe message preview · {c.patient.lang.toUpperCase()}</div>
        <div dir={c.patient.lang === 'ar' || c.patient.lang === 'ur' ? 'rtl' : 'ltr'} className="text-slate-700">{tr(c.patient.lang, 'sms')}</div>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call note (e.g. explained result, patient’s questions)…" className={inputCls} />
      <div className="flex flex-wrap gap-2">
        <Btn tone="primary" onClick={() => d({ type: 'NOTIFY', id: c.id, channel: 'PHONE', phoneOutcome: 'REACHED', note: note || 'Result explained by phone with teach-back' })}><Phone className="w-4 h-4" />Called — patient reached</Btn>
        <Btn tone="secondary" onClick={() => d({ type: 'NOTIFY', id: c.id, channel: 'PHONE', phoneOutcome: 'NO_ANSWER', note: 'No answer' })}><PhoneOff className="w-4 h-4" />No answer</Btn>
        {digital.map((x) => (
          <Btn key={x.ch} tone="secondary" disabled={critical} title={critical ? 'Held: CRITICAL result needs a phone call first' : ''} onClick={() => d({ type: 'NOTIFY', id: c.id, channel: x.ch })}>{x.icon}{x.label}</Btn>
        ))}
      </div>
      {!c.patient.phoneReachable && <div className="text-[11px] text-slate-500">Demo note: this patient’s number is not reachable — digital messages will fail.</div>}
    </div>
  );
}

function Ack({ c }: { c: Case }) {
  const { d } = useHalqa();
  const [note, setNote] = useState('Teach-back by phone: patient explained result and next step in own words');
  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-700">Waiting for <b>{c.patient.name}</b> to confirm understanding in the patient app (teach-back + confidence check), or a navigator can confirm by phone.</div>
      {c.feedback && <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-900">Last app check: teach-back {Number(c.feedback.understoodQ1) + Number(c.feedback.understoodQ2)}/2 · confidence {c.feedback.confidence}/5 — needs a human explanation.</div>}
      <div className="flex flex-wrap gap-2">
        <Btn tone="secondary" onClick={() => { d({ type: 'PATIENT_CASE', id: c.id }); d({ type: 'VIEW', view: 'patient' }); d({ type: 'SELECT', id: null }); }}><Smartphone className="w-4 h-4" />Open patient’s app view</Btn>
      </div>
      <div className="flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        <Btn tone="primary" onClick={() => d({ type: 'STAFF_ACK', id: c.id, note })}><Phone className="w-4 h-4" />Confirm by phone</Btn>
      </div>
    </div>
  );
}

function SimpleComplete({ c, stepId, options, placeholder, cta }: { c: Case; stepId: 'CONSULT' | 'CONFIRM_TEST' | 'CARE_PLAN'; options: string[]; placeholder: string; cta: string }) {
  const { d } = useHalqa();
  const [opt, setOpt] = useState(options[0]);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2">
      <select value={opt} onChange={(e) => setOpt(e.target.value)} className={inputCls}>{options.map((o) => <option key={o}>{o}</option>)}</select>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={placeholder} className={inputCls} />
      <Btn tone="primary" onClick={() => d({ type: 'COMPLETE_STEP', id: c.id, step: stepId, note: `${opt}${note ? ` — ${note}` : ''}` })}><CheckCircle2 className="w-4 h-4" />{cta}</Btn>
    </div>
  );
}

function referralPacket(c: Case) {
  return `${c.resultCode}. ${c.finding}. Urgency ${c.urgency}. Language ${c.patient.lang.toUpperCase()}${c.patient.needsInterpreter ? ' (interpreter needed)' : ''}. Consult: ${c.steps.CONSULT?.note ?? '—'}`;
}

function Refer({ c }: { c: Case }) {
  const { d } = useHalqa();
  const opts = SPECIALIST_SERVICES.filter((x) => x.pathway === c.pathwayId);
  const [fac, setFac] = useState(opts[0]?.facility ?? '');
  const [prio, setPrio] = useState<'URGENT' | 'SOON' | 'ROUTINE'>(c.urgency === 'CRITICAL' ? 'URGENT' : c.urgency === 'ELEVATED' ? 'SOON' : 'ROUTINE');
  const [note, setNote] = useState(referralPacket(c));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2"><Field label="Receiving service"><select value={fac} onChange={(e) => setFac(e.target.value)} className={inputCls}>{opts.map((o) => <option key={o.facility}>{o.facility}</option>)}</select></Field></div>
        <Field label="Priority"><select value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)} className={inputCls}><option>URGENT</option><option>SOON</option><option>ROUTINE</option></select></Field>
      </div>
      <Field label="Structured referral packet (auto-filled)"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls} /></Field>
      <Btn tone="primary" onClick={() => d({ type: 'SEND_REFERRAL', id: c.id, facility: fac, priority: prio, note })}><Send className="w-4 h-4" />Send referral (FHIR ServiceRequest)</Btn>
    </div>
  );
}

function Accept({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const r = c.referral;
  const opts = SPECIALIST_SERVICES.filter((x) => x.pathway === c.pathwayId);
  const [fac, setFac] = useState(opts.find((o) => o.facility !== r?.facility)?.facility ?? opts[0]?.facility);
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  if (!r) return null;
  if (r.status === 'REJECTED' || r.status === 'INFO_REQUESTED') {
    return (
      <div className="space-y-2">
        <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-900">
          <b>{r.status === 'REJECTED' ? 'Referral rejected' : 'More information requested'}</b> by {r.facility}: “{r.rejectReason}”. The case came back to the referring PCP — it cannot silently drop.
        </div>
        <div className="flex gap-2">
          <select value={fac} onChange={(e) => setFac(e.target.value)} className={inputCls}>{opts.map((o) => <option key={o.facility}>{o.facility}</option>)}</select>
          <Btn tone="primary" onClick={() => d({ type: 'SEND_REFERRAL', id: c.id, facility: fac!, priority: r.priority, note: `${r.note} [Re-routed after: ${r.rejectReason}]` })}><Send className="w-4 h-4" />Re-route referral</Btn>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-700"><Inbox className="w-4 h-4 text-teal-600 inline -mt-0.5 me-1" />Waiting for <b>{r.facility}</b> to accept custody. Sent {fmtDateTime(r.sentAt)} · attempt {r.attempts}.</div>
      <div className="flex flex-wrap gap-2 items-center">
        <Btn tone="secondary" onClick={() => { d({ type: 'VIEW', view: 'specialist' }); d({ type: 'SELECT', id: null }); }}><Inbox className="w-4 h-4" />Open specialist inbox</Btn>
        {s.role === 'SPECIALIST' && (
          <>
            <Btn tone="success" onClick={() => d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'ACCEPT' })}><CheckCircle2 className="w-4 h-4" />Accept</Btn>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={cx(inputCls, 'w-auto text-xs')}>{REJECT_REASONS.map((x) => <option key={x}>{x}</option>)}</select>
            <Btn tone="danger" onClick={() => d({ type: 'REFERRAL_RESPOND', id: c.id, decision: 'REJECT', reason })}><XCircle className="w-4 h-4" />Reject</Btn>
          </>
        )}
      </div>
    </div>
  );
}

export function slotsFor(now: number) {
  // next 3 working-day slots in GST (UTC+4)
  const base = new Date(now + 4 * HOUR);
  base.setUTCHours(0, 0, 0, 0);
  const day0 = base.getTime() - 4 * HOUR;
  return [2, 3, 5].map((dd, i) => day0 + dd * DAY + [9.5, 17, 11][i] * HOUR);
}

function Book({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const loc = c.referral?.facility ?? 'Primary care clinic';
  const slots = slotsFor(s.now);
  return (
    <div className="space-y-2">
      {(c.appointment?.dnaCount ?? 0) > 0 && <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-900">Previous appointment missed (DNA ×{c.appointment!.dnaCount}). Offer a slot that fits the patient — e.g. evening or weekend.</div>}
      <div className="text-xs text-slate-500">Patient can also self-book from 3 offered slots in the app.</div>
      <div className="grid grid-cols-3 gap-2">
        {slots.map((t) => (
          <button key={t} onClick={() => d({ type: 'BOOK', id: c.id, at: t, location: loc })} className="rounded-lg border border-slate-300 bg-white hover:border-teal-500 hover:bg-teal-50 p-2 text-left">
            <CalendarDays className="w-4 h-4 text-teal-600" />
            <div className="text-xs font-semibold text-slate-800 mt-1">{fmtSlot(t)}</div>
            <div className="text-[10px] text-slate-500 truncate">{loc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Attend({ c }: { c: Case }) {
  const { d } = useHalqa();
  const p = pathwayOf(c);
  const [reason, setReason] = useState('Patient forgot / work clash');
  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-700">{p.diagnosticTest} booked for <b>{c.appointment ? fmtSlot(c.appointment.at) : '—'}</b> at {c.appointment?.location}. Reminders: 72h, 24h and 2h before (patient language).</div>
      <div className="flex flex-wrap gap-2">
        <Btn tone="success" onClick={() => d({ type: 'COMPLETE_STEP', id: c.id, step: 'ATTEND', note: `${p.diagnosticTest} performed` })}><CheckCircle2 className="w-4 h-4" />Mark {p.diagnosticTest.toLowerCase()} performed</Btn>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={cx(inputCls, 'w-auto text-xs')}>
          {['Patient forgot / work clash', 'Transport problem', 'Bowel prep not completed', 'Patient anxious / changed mind', 'Unwell on the day'].map((x) => <option key={x}>{x}</option>)}
        </select>
        <Btn tone="warn" onClick={() => d({ type: 'DNA', id: c.id, note: reason })}>Did not attend</Btn>
      </div>
    </div>
  );
}

function Outcome({ c }: { c: Case }) {
  const { d } = useHalqa();
  const presets: Record<string, { cat: NonNullable<Case['outcomeCategory']>; label: string }[]> = {
    CRC_FIT: [{ cat: 'NORMAL', label: 'Normal colonoscopy' }, { cat: 'PRECANCER', label: 'Adenoma(s) removed — low-grade dysplasia' }, { cat: 'DISEASE', label: 'Adenocarcinoma confirmed' }],
    BREAST_BIRADS: [{ cat: 'BENIGN', label: 'Benign — fibroadenoma' }, { cat: 'PRECANCER', label: 'Atypical ductal hyperplasia' }, { cat: 'DISEASE', label: 'Invasive ductal carcinoma' }],
    CERVICAL_HPV: [{ cat: 'NORMAL', label: 'Normal colposcopy' }, { cat: 'PRECANCER', label: 'CIN2/3 on biopsy' }, { cat: 'DISEASE', label: 'Invasive carcinoma' }],
    DIABETES_HBA1C: [{ cat: 'DISEASE', label: 'Diabetes confirmed' }, { cat: 'BENIGN', label: 'Prediabetes' }],
  };
  const list = presets[c.pathwayId];
  const [i, setI] = useState(1 % list.length);
  const [ref, setRef] = useState(`HIS-26-${Math.floor(10000 + (c.id.charCodeAt(4) * 997) % 89999)}`);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2"><Field label="Diagnostic result"><select value={i} onChange={(e) => setI(+e.target.value)} className={inputCls}>{list.map((o, k) => <option key={k} value={k}>{o.label}</option>)}</select></Field></div>
        <Field label="Report ID"><input value={ref} onChange={(e) => setRef(e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={list[i].cat === 'DISEASE' ? 'rose' : list[i].cat === 'PRECANCER' ? 'amber' : 'emerald'}>{list[i].cat}</Badge>
        <span className="text-[11px] text-slate-500">{list[i].cat === 'DISEASE' ? 'Treatment pathway will be required before closure' : 'Surveillance / routine interval will be required before closure'}</span>
      </div>
      <Btn tone="primary" onClick={() => d({ type: 'COMPLETE_STEP', id: c.id, step: 'OUTCOME', note: `${list[i].label} (report ${ref})`, outcomeCategory: list[i].cat })}><CheckCircle2 className="w-4 h-4" />Record result & notify PCP</Btn>
    </div>
  );
}
