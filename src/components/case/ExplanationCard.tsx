'use client';

import React, { useState } from 'react';
import { Case } from '@/types/halqa';
import { useHalqa } from '@/context/HalqaStore';
import { pathwayOf, actorFor, fmtDateTime } from '@/lib/engine';
import { EXPLAIN, LANGS } from '@/lib/i18n';
import { Btn, Badge, SectionTitle, inputCls, cx } from '../ui';
import { Sparkles, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';

/**
 * Result-specific patient explanation. AI writes a first draft; a licensed
 * clinician edits and approves it; only then does the patient see it.
 */
export function ExplanationCard({ c }: { c: Case }) {
  const { s, d } = useHalqa();
  const ex = c.explanation;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [body, setBody] = useState(ex?.body ?? '');
  const [next, setNext] = useState(ex?.next ?? '');
  const p = pathwayOf(c);
  const L = LANGS.find((l) => l.id === c.patient.lang)!;
  const actor = actorFor(c, s.role);
  const canApprove = (s.role === 'PCP' || s.role === 'SPECIALIST') && !!actor.licence;
  const standard = EXPLAIN[c.pathwayId];

  const draft = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/draft-explanation', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // No name, MRN or phone number leaves the browser.
        body: JSON.stringify({
          pathway: p.name, finding: c.finding, resultCode: c.resultCode, urgency: c.urgency, diagnosticTest: p.diagnosticTest,
          withinDays: p.targetDaysToDiagnosis, lang: c.patient.lang, age: c.patient.age, sex: c.patient.sex, standardExplanation: standard.en.body,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.draft) { setErr(j?.message ?? 'Could not draft an explanation. The standard explanation stays in use.'); return; }
      d({ type: 'EXPLANATION_DRAFT', id: c.id, draft: { ...j.draft, lang: c.patient.lang, model: j.model } });
    } catch {
      setErr('Could not reach the drafting service. The standard explanation stays in use.');
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <SectionTitle icon={<Sparkles className="w-3.5 h-3.5" />} right={<span className="text-[10px] text-slate-400">AI drafts · a clinician approves · then the patient sees it</span>}>Explanation the patient reads</SectionTitle>

      {!ex && (
        <>
          <div className="text-xs text-slate-600">
            <Badge>Standard · {L.label}</Badge>
            <p className="mt-1.5 leading-relaxed" dir={L.dir}>{standard[c.patient.lang].body}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Btn size="sm" tone="primary" disabled={busy} onClick={draft}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{busy ? 'Drafting…' : `Draft one for this result in ${L.label}`}
            </Btn>
            <span className="text-[11px] text-slate-500">Sends the result, age and sex only. No name or contact details.</span>
          </div>
        </>
      )}

      {ex?.status === 'DRAFT' && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge tone="amber">Draft · not visible to patient</Badge>
            <span className="text-slate-500">{L.label} · drafted {fmtDateTime(ex.draftedAt)} · {ex.model}</span>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} dir={L.dir} rows={6} aria-label="Explanation text" className={cx(inputCls, 'leading-relaxed')} />
          <input value={next} onChange={(e) => setNext(e.target.value)} dir={L.dir} aria-label="Next step label" className={cx(inputCls, 'text-xs')} />
          {c.patient.lang !== 'en' && (
            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              <div className="font-semibold text-slate-700 mb-0.5">English back-translation of the original draft</div>
              <p className="text-slate-600 leading-relaxed">{ex.backTranslation}</p>
              {(body !== ex.body) && <p className="text-amber-700 mt-1">You have edited the text above; this back-translation no longer matches it.</p>}
            </div>
          )}
          {ex.reviewNotes.length > 0 && (
            <ul className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 space-y-1">
              {ex.reviewNotes.map((n) => <li key={n} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{n}</li>)}
            </ul>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Btn size="sm" tone="success" disabled={!canApprove || body.trim().length < 40 || !next.trim()} onClick={() => d({ type: 'EXPLANATION_APPROVE', id: c.id, body: body.trim(), next: next.trim() })}>
              <ShieldCheck className="w-3.5 h-3.5" />Approve & publish to patient
            </Btn>
            <Btn size="sm" tone="ghost" onClick={() => d({ type: 'EXPLANATION_DISCARD', id: c.id })}>Discard draft</Btn>
            {!canApprove && <span className="text-[11px] text-rose-600">Only a licensed clinician can approve. Switch “Acting as” to the GP or specialist.</span>}
          </div>
        </>
      )}

      {ex?.status === 'APPROVED' && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge tone="emerald">Live in patient app</Badge>
            <span className="text-slate-500">Approved by {ex.approvedBy} ({ex.approvedLicence}) · {fmtDateTime(ex.approvedAt!)} · {ex.edited ? 'edited before approval' : 'approved without edits'}</span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed" dir={L.dir}>{ex.body}</p>
          <Btn size="sm" tone="ghost" onClick={() => d({ type: 'EXPLANATION_DISCARD', id: c.id })}>Withdraw and return to standard</Btn>
        </>
      )}

      {err && <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{err}</div>}
    </div>
  );
}
