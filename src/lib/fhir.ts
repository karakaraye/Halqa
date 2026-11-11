import { Case } from '@/types/halqa';
import { pathwayOf, stepStart, slaMs } from './engine';

const iso = (t?: number) => (t ? new Date(t).toISOString() : undefined);

/** Map a Halqa case to a FHIR R4 Bundle (Patient, DiagnosticReport, ServiceRequest, Task per step, Communication, Appointment, Provenance). */
export function toFhirBundle(c: Case) {
  const p = pathwayOf(c);
  const entries: unknown[] = [];
  entries.push({ resource: { resourceType: 'Patient', id: c.patient.id, name: [{ text: c.patient.name }], gender: c.patient.sex === 'F' ? 'female' : 'male', communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: c.patient.lang }] }, preferred: true }] } });
  entries.push({ resource: { resourceType: 'DiagnosticReport', id: `dr-${c.id}`, status: 'final', code: { text: p.name }, subject: { reference: `Patient/${c.patient.id}` }, issued: iso(c.issuedAt), performer: [{ display: c.sourceLab }], conclusion: c.finding, conclusionCode: [{ text: c.resultCode }] } });
  if (c.referral) entries.push({ resource: { resourceType: 'ServiceRequest', id: `sr-${c.id}`, status: c.referral.status === 'ACCEPTED' ? 'active' : c.referral.status === 'REJECTED' ? 'revoked' : 'active', intent: 'order', priority: c.referral.priority === 'URGENT' ? 'urgent' : 'routine', code: { text: p.diagnosticTest }, subject: { reference: `Patient/${c.patient.id}` }, authoredOn: iso(c.referral.sentAt), requester: { display: c.team.PCP?.name }, performer: [{ display: c.referral.facility }], reasonReference: [{ reference: `DiagnosticReport/dr-${c.id}` }], note: [{ text: c.referral.note }] } });
  for (const s of p.steps) {
    const rec = c.steps[s.id];
    const start = stepStart(c, s);
    entries.push({
      resource: {
        resourceType: 'Task', id: `task-${c.id}-${s.id.toLowerCase()}`, status: rec?.completedAt ? 'completed' : 'requested', intent: 'order',
        code: { coding: [{ system: 'https://halqa.health/fhir/CodeSystem/loop-step', code: s.id, display: s.label }] },
        focus: { reference: `DiagnosticReport/dr-${c.id}` }, for: { reference: `Patient/${c.patient.id}` },
        owner: { display: rec?.by ?? (s.ownerRole === 'PATIENT' ? c.patient.name : c.team[s.ownerRole as 'PCP']?.name ?? 'UNASSIGNED') },
        executionPeriod: { start: iso(start), end: iso(rec?.completedAt) },
        restriction: { period: { end: iso(start + slaMs(c, s)) } },
        note: rec?.note ? [{ text: rec.note }] : undefined,
      },
    });
  }
  for (const n of c.notifications) entries.push({ resource: { resourceType: 'Communication', status: n.status === 'FAILED' || n.status === 'NO_ANSWER' ? 'not-done' : 'completed', medium: [{ text: n.channel }], sent: iso(n.at), subject: { reference: `Patient/${c.patient.id}` }, language: n.lang } });
  if (c.appointment) entries.push({ resource: { resourceType: 'Appointment', id: `appt-${c.id}`, status: c.steps.ATTEND?.completedAt ? 'fulfilled' : c.appointment.dnaCount ? 'noshow' : 'booked', start: iso(c.appointment.at), description: p.diagnosticTest, participant: [{ actor: { display: c.patient.name }, status: 'accepted' }, { actor: { display: c.appointment.location }, status: 'accepted' }] } });
  if (c.closure) entries.push({ resource: { resourceType: 'Provenance', target: [{ reference: `DiagnosticReport/dr-${c.id}` }], recorded: iso(c.closure.signedAt), activity: { text: `Loop closure (${c.closure.kind}) — ${c.closure.status}` }, agent: [{ who: { display: `${c.closure.signedBy} (${c.closure.signedLicence})` } }, ...(c.closure.approvedBy ? [{ who: { display: `${c.closure.approvedBy} (2nd approver)` } }] : [])], entity: [{ role: 'source', what: { display: c.closure.evidenceRef } }] } });
  return { resourceType: 'Bundle', type: 'collection', id: `halqa-${c.id}`, timestamp: new Date().toISOString(), entry: entries };
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/fhir+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
