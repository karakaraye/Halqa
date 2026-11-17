'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { fromFhirBundle, SAMPLE_BUNDLES } from '@/lib/fhirIngest';
import { sourceRefOf } from '@/lib/fhir';
import { PATHWAYS } from '@/lib/pathways';
import { Btn, UrgencyBadge, cx, inputCls } from './ui';
import { FileJson, Upload, X, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

/** Inbound integration point: paste or upload a FHIR R4 result Bundle and open a case from it. */
export function FhirImport({ onClose }: { onClose: () => void }) {
  const { s, d } = useHalqa();
  const [raw, setRaw] = useState(SAMPLE_BUNDLES[0].json);
  const file = useRef<HTMLInputElement>(null);

  const existing = useMemo(() => new Map(s.cases.map((c) => [sourceRefOf(c), c.id])), [s.cases]);
  const r = useMemo(() => fromFhirBundle(raw, s.now, existing, s.fhirSeq ?? 0), [raw, s.now, existing, s.fhirSeq]);

  const ingest = () => {
    if (!r.ok) return;
    d({ type: 'VIEW', view: 'command' });
    d({ type: 'INGEST_FHIR', c: r.case });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Import FHIR result" className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h2 className="font-bold text-slate-900 flex items-center gap-2"><FileJson className="w-4 h-4 text-teal-600" />Import a lab result (FHIR R4 Bundle)</h2>
            <p className="text-xs text-slate-500">The same parser a lab or HIE feed would call: Patient + DiagnosticReport (+ Observation) in, one owned case out.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid md:grid-cols-5 gap-4 p-5 overflow-y-auto">
          <div className="md:col-span-3 space-y-2 min-w-0">
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_BUNDLES.map((b) => (
                <button key={b.label} onClick={() => setRaw(b.json)} className={cx('text-[11px] px-2 py-1 rounded-full border', raw === b.json ? 'bg-teal-50 border-teal-300 text-teal-800 font-semibold' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>{b.label}</button>
              ))}
              <button onClick={() => file.current?.click()} className="text-[11px] px-2 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center gap-1"><Upload className="w-3 h-3" />Upload .json</button>
              <input ref={file} type="file" accept=".json,application/json,application/fhir+json" className="hidden"
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRaw(await f.text()); e.target.value = ''; }} />
            </div>
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} aria-label="FHIR Bundle JSON"
              className={cx(inputCls, 'font-mono text-[11px] leading-relaxed h-[46vh] resize-none')} />
          </div>

          <div className="md:col-span-2 space-y-3 text-xs">
            {r.ok ? (
              <>
                <div className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 className="w-4 h-4" />Valid — ready to open a case</div>
                <dl className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                  <Row k="Patient" v={`${r.case.patient.name} · ${r.case.patient.age || '?'}${r.case.patient.sex} · ${r.case.patient.lang.toUpperCase()}`} />
                  <Row k="Result" v={r.case.finding} />
                  <Row k="Pathway" v={<>{PATHWAYS[r.preview.pathwayId].short}<div className="text-slate-500">matched on {r.preview.matchedOn}</div></>} />
                  <Row k="Urgency" v={<><UrgencyBadge u={r.preview.urgency} /><div className="text-slate-500 mt-0.5">{r.preview.urgencyWhy}</div></>} />
                  <Row k="Navigator" v={r.case.team.NAVIGATOR?.name} />
                  <Row k="Accountable GP" v={r.case.team.PCP?.name ?? <span className="text-rose-600 font-semibold">Unassigned — will be flagged</span>} />
                  <Row k="Source" v={<span className="font-mono">{r.preview.sourceRef}</span>} />
                </dl>
                {r.warnings.map((w) => <div key={w} className="flex gap-1.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</div>)}
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 font-semibold text-rose-700"><XCircle className="w-4 h-4" />Rejected — no case opened</div>
                {r.errors.map((e) => <div key={e} className="text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2">{e}</div>)}
              </>
            )}
            <p className="text-[11px] text-slate-500">Code map and urgency thresholds are illustrative defaults. Nothing leaves the browser.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <Btn tone="secondary" onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!r.ok} onClick={ingest}>Open case from this result</Btn>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex gap-3 px-3 py-2"><dt className="w-24 shrink-0 text-slate-500">{k}</dt><dd className="text-slate-900 min-w-0 break-words">{v}</dd></div>;
}
