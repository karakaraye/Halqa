// ─────────────────────────────────────────────────────────────
// FHIR R4 inbound: turn a lab/HIE result Bundle (Patient +
// DiagnosticReport [+ Observation]) into a Halqa case.
// Pure functions: no I/O, no clock — the caller passes "now".
// Code maps and urgency thresholds are illustrative defaults and
// must be confirmed against the programme's terminology service.
// ─────────────────────────────────────────────────────────────
import { Case, Channel, Lang, PathwayId, Person, Urgency } from '@/types/halqa';
import { PATHWAYS, PEOPLE, STAFF_BY_ROLE as STAFF } from './pathways';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const LOINC = 'http://loinc.org';

/** LOINC codes recognised per pathway (starter set). */
export const PATHWAY_CODES: Record<PathwayId, { loinc: string[]; keywords: RegExp; exportCode: string; exportDisplay: string }> = {
  CRC_FIT: { loinc: ['57905-2', '29771-3', '58453-2', '56490-6', '56491-4'], keywords: /\b(fit|f[ae]cal immunochemical|occult blood|h[ae]moglobin.*stool)\b/i, exportCode: '58453-2', exportDisplay: 'Hemoglobin.gastrointestinal.lower [Mass/volume] in Stool by Immunoassay' },
  BREAST_BIRADS: { loinc: ['24606-6', '24605-8', '26346-7', '26347-5'], keywords: /\b(mammogra\w*|bi-?rads)\b/i, exportCode: '24606-6', exportDisplay: 'MG Breast Screening' },
  CERVICAL_HPV: { loinc: ['77379-6', '59420-0', '21440-3', '82675-0', '10524-7'], keywords: /\b(hpv|papillomavirus|cervical cytology|pap smear|hsil|asc-h)\b/i, exportCode: '77379-6', exportDisplay: 'Human papilloma virus 16 and 18 and 31+33+35+39+45+51+52+56+58+59+66+68 DNA [Interpretation] in Cervix' },
  DIABETES_HBA1C: { loinc: ['4548-4', '17856-6', '41995-2'], keywords: /\b(hba1c|a1c|glycated h[ae]moglobin)\b/i, exportCode: '4548-4', exportDisplay: 'Hemoglobin A1c/Hemoglobin.total in Blood' },
};

export interface IngestPreview {
  pathwayId: PathwayId;
  urgency: Urgency;
  urgencyWhy: string;
  matchedOn: string;
  sourceRef: string;
  pcpFound: boolean;
}
export type IngestResult =
  | { ok: true; case: Case; preview: IngestPreview; warnings: string[] }
  | { ok: false; errors: string[] };

const codings = (cc?: Json): Json[] => (Array.isArray(cc?.coding) ? cc!.coding : []);
const textOf = (cc?: Json): string => [cc?.text, ...codings(cc).map((c) => c.display)].filter(Boolean).join(' ');

function detectPathway(concepts: Json[]): { id: PathwayId; matchedOn: string } | null {
  const ids = Object.keys(PATHWAY_CODES) as PathwayId[];
  for (const cc of concepts)
    for (const c of codings(cc))
      for (const id of ids)
        if ((!c.system || c.system === LOINC) && PATHWAY_CODES[id].loinc.includes(c.code)) return { id, matchedOn: `LOINC ${c.code}` };
  for (const cc of concepts) {
    const t = textOf(cc);
    for (const id of ids) if (t && PATHWAY_CODES[id].keywords.test(t)) return { id, matchedOn: `text “${t.slice(0, 40)}”` };
  }
  return null;
}

/** Urgency: an explicit FHIR interpretation flag wins; otherwise illustrative value thresholds. */
function deriveUrgency(pathwayId: PathwayId, obs: Json | undefined, text: string): { urgency: Urgency; why: string } {
  const flags = [...(obs?.interpretation ?? [])].flatMap((i: Json) => codings(i).map((c) => String(c.code)));
  if (flags.some((f) => ['AA', 'HH', 'LL'].includes(f))) return { urgency: 'CRITICAL', why: 'interpretation flag = critical abnormal' };
  const v: number | undefined = typeof obs?.valueQuantity?.value === 'number' ? obs.valueQuantity.value : undefined;
  if (pathwayId === 'CRC_FIT' && v !== undefined) return v >= 250 ? { urgency: 'CRITICAL', why: `FIT ${v} ≥ 250 µg Hb/g` } : v >= 150 ? { urgency: 'ELEVATED', why: `FIT ${v} ≥ 150 µg Hb/g` } : { urgency: 'ROUTINE', why: `FIT ${v} < 150 µg Hb/g` };
  if (pathwayId === 'DIABETES_HBA1C' && v !== undefined) return v >= 10 ? { urgency: 'CRITICAL', why: `HbA1c ${v}% ≥ 10%` } : v >= 8 ? { urgency: 'ELEVATED', why: `HbA1c ${v}% ≥ 8%` } : { urgency: 'ROUTINE', why: `HbA1c ${v}% < 8%` };
  if (pathwayId === 'BREAST_BIRADS') {
    const m = text.match(/bi-?rads\s*(?:category\s*)?(4[abc]?|5)/i)?.[1]?.toUpperCase();
    if (m === '5' || m === '4C') return { urgency: 'CRITICAL', why: `BI-RADS ${m}` };
    if (m) return { urgency: 'ELEVATED', why: `BI-RADS ${m}` };
  }
  if (pathwayId === 'CERVICAL_HPV' && /\bhsil\b|asc-h|hpv\s*1[68]/i.test(text)) return { urgency: 'ELEVATED', why: 'HPV 16/18 or high-grade cytology' };
  if (flags.some((f) => ['A', 'H', 'POS'].includes(f))) return { urgency: 'ELEVATED', why: 'interpretation flag = abnormal' };
  return { urgency: 'ELEVATED', why: 'no value or flag supplied — defaulted, review required' };
}

const LANGS: Lang[] = ['en', 'ar', 'hi', 'ur'];

function matchPerson(display: string | undefined, role: 'PCP' | 'NAVIGATOR'): Person | undefined {
  if (!display) return undefined;
  const norm = (x: string) => x.toLowerCase().replace(/^dr\.?\s*/, '').trim();
  return STAFF[role].find((p) => norm(p.name) === norm(display) || p.licence === display);
}

/**
 * Parse and validate an inbound bundle.
 * @param existing source refs already tracked (duplicate deliveries are rejected, never double-opened)
 */
export function fromFhirBundle(raw: string, now: number, existing: Map<string, string>, seq: number): IngestResult {
  let b: Json;
  try { b = JSON.parse(raw); } catch (e) { return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] }; }
  if (b?.resourceType !== 'Bundle' || !Array.isArray(b.entry)) return { ok: false, errors: ['Expected a FHIR Bundle with an entry[] array.'] };

  const res: Json[] = b.entry.map((e: Json) => e?.resource).filter(Boolean);
  const pat = res.find((r) => r.resourceType === 'Patient');
  const dr = res.find((r) => r.resourceType === 'DiagnosticReport');
  const obs = res.find((r) => r.resourceType === 'Observation');
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!pat) errors.push('Bundle has no Patient resource.');
  if (!dr) errors.push('Bundle has no DiagnosticReport resource.');
  if (errors.length || !pat || !dr) return { ok: false, errors };

  if (!['final', 'amended', 'corrected'].includes(dr.status)) errors.push(`DiagnosticReport.status is “${dr.status ?? 'missing'}” — only final / amended / corrected results open a case.`);

  const sourceRef: string = dr.identifier?.[0]?.value ?? (dr.id ? `DiagnosticReport/${dr.id}` : '');
  if (!sourceRef) errors.push('DiagnosticReport needs an identifier or id so duplicate deliveries can be detected.');
  else if (existing.has(sourceRef)) errors.push(`Duplicate delivery: ${sourceRef} is already tracked as case ${existing.get(sourceRef)}. No new case opened.`);

  const pw = detectPathway([dr.code, obs?.code].filter(Boolean));
  if (!pw) errors.push('Result code is not mapped to a screening pathway (checked DiagnosticReport.code and Observation.code against LOINC map and keywords).');

  const name: string = pat.name?.[0]?.text ?? [...(pat.name?.[0]?.given ?? []), pat.name?.[0]?.family].filter(Boolean).join(' ');
  if (!name) errors.push('Patient.name is missing.');
  if (errors.length || !pw) return { ok: false, errors };

  const text = [dr.conclusion, textOf(dr.conclusionCode?.[0]), obs?.valueString, textOf(obs?.valueCodeableConcept)].filter(Boolean).join(' ');
  const { urgency, why } = deriveUrgency(pw.id, obs, text);

  const q = obs?.valueQuantity;
  const finding: string = dr.conclusion ?? (q ? `${textOf(obs.code) || PATHWAYS[pw.id].short}: ${q.value} ${q.unit ?? ''}`.trim() : textOf(dr.code));
  const resultCode: string = textOf(dr.conclusionCode?.[0]) || (q ? `${pw.id === 'CRC_FIT' ? 'FIT' : pw.id === 'DIABETES_HBA1C' ? 'HbA1c' : ''} ${q.value}${q.unit === '%' ? '%' : ''}`.trim() : finding.slice(0, 24));

  const langCode = String(pat.communication?.find((c: Json) => c.preferred)?.language?.coding?.[0]?.code ?? pat.communication?.[0]?.language?.coding?.[0]?.code ?? 'en').slice(0, 2).toLowerCase();
  const lang = (LANGS as string[]).includes(langCode) ? (langCode as Lang) : 'en';
  if (!(LANGS as string[]).includes(langCode)) warnings.push(`Preferred language “${langCode}” has no patient content yet — defaulting to English and flagging an interpreter.`);

  const phoneRaw: string | undefined = pat.telecom?.find((t: Json) => t.system === 'phone' || t.system === 'sms')?.value;
  if (!phoneRaw) warnings.push('No phone number on the Patient — navigator must find a contact route.');
  const phone = phoneRaw ? phoneRaw.replace(/(\+?\d{3}\s?\d{2})[\s\d]*?(\d{4})$/, '$1 *** $2') : 'not on file';

  const birth = pat.birthDate ? Date.parse(pat.birthDate) : NaN;
  const age = Number.isFinite(birth) ? Math.floor((now - birth) / (365.25 * 86_400_000)) : 0;
  if (!Number.isFinite(birth)) warnings.push('Patient.birthDate missing — age unknown.');

  const pcp = matchPerson(pat.generalPractitioner?.[0]?.display, 'PCP');
  if (!pcp) warnings.push('No registered GP matched from Patient.generalPractitioner — case opens unassigned and the “no owner” rule will fire.');
  const navigator = STAFF.NAVIGATOR[seq % STAFF.NAVIGATOR.length];
  const lab: string = dr.performer?.[0]?.display ?? 'External laboratory';
  const channel: Channel = phoneRaw ? 'SMS' : 'PHONE';

  const c: Case = {
    id: '', // assigned by the store
    patient: {
      id: pat.identifier?.[0]?.value ?? `MRN-${pat.id ?? 'unknown'}`, name, age, sex: pat.gender === 'female' ? 'F' : 'M', phone,
      phoneReachable: !!phoneRaw, lang, preferredChannel: channel, needsInterpreter: !(LANGS as string[]).includes(langCode) || undefined,
    },
    pathwayId: pw.id, finding, resultCode, urgency, sourceLab: lab, sourceRef, issuedAt: now,
    team: { NAVIGATOR: navigator, PCP: pcp }, accountable: pcp,
    steps: {}, clockResets: {}, notifications: [], messages: [], escalations: [], delayReasons: [],
    audit: [
      { at: now, actor: lab, action: 'Actionable result received (FHIR DiagnosticReport)', detail: `${finding} · source ${sourceRef}${dr.issued ? ` · issued ${dr.issued}` : ''}`, system: true },
      { at: now + 60_000, actor: 'Halqa routing', action: `Case opened · pathway “${PATHWAYS[pw.id].short}” (${pw.matchedOn}) · urgency ${urgency} (${why})`, detail: pcp ? `Accountable clinician: ${pcp.name}` : 'No registered PCP found — flagged for assignment', system: true },
    ],
  };
  return { ok: true, case: c, warnings, preview: { pathwayId: pw.id, urgency, urgencyWhy: why, matchedOn: pw.matchedOn, sourceRef, pcpFound: !!pcp } };
}

// ── Sample inbound messages for the demo ──────────────────────
const bundle = (id: string, entries: Json[]) => JSON.stringify({ resourceType: 'Bundle', id, type: 'message', entry: entries.map((resource) => ({ fullUrl: `urn:uuid:${resource.resourceType.toLowerCase()}-${resource.id}`, resource })) }, null, 2);

export const SAMPLE_BUNDLES: { label: string; json: string }[] = [
  {
    label: 'Positive FIT — 318 µg Hb/g (critical)',
    json: bundle('lab-msg-88410', [
      { resourceType: 'Patient', id: 'p-88410', identifier: [{ system: 'urn:example:mrn', value: 'MRN-884107' }], name: [{ given: ['Hamad'], family: 'Al Ketbi' }], gender: 'male', birthDate: '1964-03-12', telecom: [{ system: 'phone', value: '+971 50 555 2291' }], communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'ar' }] }, preferred: true }], generalPractitioner: [{ display: PEOPLE.pcp_mariam.name }] },
      { resourceType: 'Observation', id: 'obs-88410', status: 'final', code: { coding: [{ system: LOINC, code: '58453-2', display: 'Hemoglobin.gastrointestinal.lower [Mass/volume] in Stool by Immunoassay' }] }, subject: { reference: 'Patient/p-88410' }, valueQuantity: { value: 318, unit: 'µg Hb/g' }, interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'POS' }] }] },
      { resourceType: 'DiagnosticReport', id: 'dr-88410', identifier: [{ system: 'urn:example:lab-accession', value: 'NRL-2026-088410' }], status: 'final', code: { coding: [{ system: LOINC, code: '58453-2' }], text: 'Faecal immunochemical test' }, subject: { reference: 'Patient/p-88410' }, issued: '2026-11-07T04:40:00Z', performer: [{ display: 'National Reference Lab' }], result: [{ reference: 'Observation/obs-88410' }], conclusion: 'Faecal immunochemical test positive: 318 µg Hb/g', conclusionCode: [{ text: 'FIT 318' }] },
    ]),
  },
  {
    label: 'HbA1c 8.4% — no registered GP',
    json: bundle('lab-msg-88522', [
      { resourceType: 'Patient', id: 'p-88522', identifier: [{ system: 'urn:example:mrn', value: 'MRN-885221' }], name: [{ text: 'Sunita Reddy' }], gender: 'female', birthDate: '1979-08-30', telecom: [{ system: 'phone', value: '+971 55 555 7730' }], communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'hi' }] }, preferred: true }] },
      { resourceType: 'Observation', id: 'obs-88522', status: 'final', code: { coding: [{ system: LOINC, code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood' }] }, subject: { reference: 'Patient/p-88522' }, valueQuantity: { value: 8.4, unit: '%' } },
      { resourceType: 'DiagnosticReport', id: 'dr-88522', identifier: [{ system: 'urn:example:lab-accession', value: 'NRL-2026-088522' }], status: 'final', code: { coding: [{ system: LOINC, code: '4548-4' }], text: 'HbA1c' }, subject: { reference: 'Patient/p-88522' }, issued: '2026-11-07T04:55:00Z', performer: [{ display: 'National Reference Lab' }], result: [{ reference: 'Observation/obs-88522' }], conclusion: 'HbA1c 8.4% — in diabetes range' },
    ]),
  },
  {
    label: 'Preliminary result (rejected: not final)',
    json: bundle('lab-msg-88601', [
      { resourceType: 'Patient', id: 'p-88601', name: [{ text: 'Test Patient' }], gender: 'female', birthDate: '1970-01-01' },
      { resourceType: 'DiagnosticReport', id: 'dr-88601', status: 'preliminary', code: { text: 'Screening mammogram' }, conclusion: 'BI-RADS 4B, awaiting second read' },
    ]),
  },
];
