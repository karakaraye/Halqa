'use client';

import React, { useState } from 'react';
import { useHalqa, Action } from '@/context/HalqaStore';
import { cx } from './ui';
import { Presentation, ChevronDown, ChevronUp, Play } from 'lucide-react';

interface Step { title: string; say: string; criterion: string; run: Action[] }

const STEPS: Step[] = [
  { criterion: '1 · 2', title: 'A CRITICAL result arrives', say: 'A positive FIT lands from the lab. Halqa routes it to a named navigator and an accountable GP in seconds. For CRITICAL results the text message is held back: a nurse has to phone first.', run: [{ type: 'VIEW', view: 'command' }, { type: 'ROLE', role: 'NAVIGATOR' }, { type: 'INGEST' }] },
  { criterion: '3', title: 'Patient understands, in Hindi', say: 'Priya gets a WhatsApp with no diagnosis in it. In the app she reads (or listens to) a plain-language explanation, then answers a 2-question teach-back. If she gets one wrong, a nurse call is triggered.', run: [{ type: 'SELECT', id: null }, { type: 'PATIENT_CASE', id: 'HQ-1003' }, { type: 'VIEW', view: 'patient' }] },
  { criterion: '4', title: 'Specialist accepts custody', say: 'The referral arrives as a structured packet. The specialist must accept it or reject it with a reason, so a referral never just sits in a fax tray.', run: [{ type: 'SELECT', id: null }, { type: 'VIEW', view: 'specialist' }] },
  { criterion: '2 · 4', title: 'A rejected referral bounces back', say: 'Muhammad’s referral was rejected as out of catchment. It comes straight back to his GP with the reason attached and can be re-routed in one click.', run: [{ type: 'VIEW', view: 'command' }, { type: 'ROLE', role: 'PCP' }, { type: 'SELECT', id: 'HQ-1004' }] },
  { criterion: '2 · 5', title: 'Time passes: escalations fire', say: 'Fast-forward one day. Overdue steps escalate up a published ladder (L1 to the owner, L2 to clinical governance), and humans resolve them.', run: [{ type: 'SELECT', id: null }, { type: 'VIEW', view: 'command' }, { type: 'TICK', hours: 24 }] },
  { criterion: '5', title: 'Closure needs evidence', say: 'Lakshmi’s treatment is finished. The closure gate checks every requirement and only a licensed clinician can sign. Open Noura’s case to see the gate blocked.', run: [{ type: 'VIEW', view: 'command' }, { type: 'ROLE', role: 'PCP' }, { type: 'SELECT', id: 'HQ-1009' }] },
  { criterion: '5', title: 'Two-person rule for exceptions', say: 'Hessa declined colposcopy after an informed discussion. An exception like that can’t be closed by one person: the Clinical Governance Lead has to approve it.', run: [{ type: 'SELECT', id: null }, { type: 'VIEW', view: 'governance' }] },
  { criterion: '6', title: 'Prove the impact', say: 'Every measure in the brief is computed live from the case data: time to notification, time to diagnostic test, referral completion, closure, delay reasons, and patient understanding and confidence.', run: [{ type: 'SELECT', id: null }, { type: 'VIEW', view: 'impact' }] },
];

export function DemoGuide() {
  const { d } = useHalqa();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const go = (k: number) => { setI(k); STEPS[k].run.forEach((a) => d(a)); };

  return (
    <div className="fixed bottom-4 left-4 z-[55] w-[360px] max-w-[calc(100vw-2rem)]">
      {open ? (
        <div className="bg-slate-900 text-slate-100 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden">
          <button onClick={() => setOpen(false)} className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 text-xs font-bold">
            <span className="flex items-center gap-1.5"><Presentation className="w-4 h-4 text-teal-400" />Judge demo · step {i + 1}/{STEPS.length}</span><ChevronDown className="w-4 h-4" />
          </button>
          <div className="p-4 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-teal-400 font-bold">Criterion {step.criterion}</div>
              <div className="font-bold text-white">{step.title}</div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{step.say}</p>
            </div>
            <div className="flex gap-1">
              {STEPS.map((_, k) => <button key={k} onClick={() => go(k)} className={cx('flex-1 h-1.5 rounded-full', k === i ? 'bg-teal-400' : k < i ? 'bg-teal-700' : 'bg-slate-700')} title={STEPS[k].title} />)}
            </div>
            <div className="flex gap-2">
              <button onClick={() => go(i)} className="flex-1 flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg py-2"><Play className="w-3.5 h-3.5" />Show me</button>
              <button disabled={i === 0} onClick={() => setI(i - 1)} className="px-3 text-xs rounded-lg bg-slate-800 disabled:opacity-30">Back</button>
              <button disabled={i === STEPS.length - 1} onClick={() => setI(i + 1)} className="px-3 text-xs rounded-lg bg-slate-800 disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 bg-slate-900 text-white text-xs font-bold rounded-full pl-3 pr-4 py-2.5 shadow-xl hover:bg-slate-800">
          <Presentation className="w-4 h-4 text-teal-400" />Judge demo walkthrough<ChevronUp className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
