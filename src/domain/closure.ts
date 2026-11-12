import { Case, Closure, Person } from '@/types/halqa';
import { PATHWAYS } from '@/lib/pathways';

export type ClosureInput = Omit<Closure, 'signedAt' | 'status' | 'signedBy' | 'signedLicence'>;
export const validLicence = (value?: string) => !!value && value.trim().length >= 4 && !['none', 'unknown', 'n/a'].includes(value.toLowerCase());
export function closureChecks(c: Case, actor: Person, input: ClosureInput) {
  const clinician = ['PCP', 'SPECIALIST'].includes(actor.role) && validLicence(actor.licence);
  const missing = PATHWAYS[c.pathwayId].steps.filter(s => s.id !== 'CLOSE' && !c.steps[s.id]?.completedAt);
  const common = [
    { ok: !c.closure, text: 'The case is not already closed or waiting for a check' },
    { ok: clinician, text: 'You are a doctor with a licence on file' },
    { ok: input.outcome.trim().length >= 3, text: 'Test result written below' },
    { ok: input.evidenceRef.trim().length >= 4, text: 'Report reference written below' },
    { ok: input.plan.trim().length >= 5, text: 'Plan written down' },
  ];
  if (input.kind === 'EVIDENCE') return [...common,
    { ok: missing.length === 0, text: missing.length ? `Steps still to do: ${missing.map(s => s.label).join(', ')}` : 'All steps are done' },
    { ok: !!(c.steps.OUTCOME?.completedAt || c.steps.CONFIRM_TEST?.completedAt), text: 'Test result saved in the case' },
    { ok: !!c.steps.CARE_PLAN?.completedAt, text: 'Care plan saved in the case' },
    { ok: !c.callbackRequestedAt || !!c.callbackDoneAt, text: 'Call back to the patient is done' },
    { ok: !c.escalations.some(e => !e.resolvedAt && e.level >= 2), text: 'No serious problem is still waiting for a decision' },
  ];
  return [...common, { ok: (input.justification?.trim().length ?? 0) >= 30, text: 'Reason written down (at least 30 characters)' }];
}
export function assertClosure(c: Case, actor: Person, input: ClosureInput) {
  if (!['EVIDENCE', 'DECLINED_INFORMED', 'CARE_ELSEWHERE', 'OUT_OF_SCOPE'].includes(input.kind)) throw new Error('Choose how this case is being closed.');
  const errors = closureChecks(c, actor, input).filter(x => !x.ok);
  if (errors.length) throw new Error(errors.map(x => x.text).join('; '));
}
export function assertApproval(c: Case, actor: Person, note: string) {
  if (actor.role !== 'LEAD' || !validLicence(actor.licence)) throw new Error('Only the clinic lead, with a licence on file, can check a case closed without a test result.');
  if (!c.closure || c.closure.status !== 'PENDING_APPROVAL' || c.closure.kind === 'EVIDENCE') throw new Error('No closure is waiting for a check.');
  if (c.closure.signedById === actor.id || c.closure.signedBy === actor.name) throw new Error('The second person must be someone other than the one who closed the case.');
  if (note.trim().length < 5) throw new Error('Write the reason for your decision.');
}
/** Reference-backed standard disposition, never a proxy for verified treatment. */
export function isEvidenceClosure(c: Case) {
  return c.closure?.status === 'CLOSED' && c.closure.kind === 'EVIDENCE' &&
    validLicence(c.closure.signedLicence) && c.closure.evidenceRef.trim().length >= 4 &&
    c.closure.plan.trim().length >= 5 && !!c.steps.CARE_PLAN?.completedAt &&
    !!(c.steps.OUTCOME?.completedAt || c.steps.CONFIRM_TEST?.completedAt) &&
    PATHWAYS[c.pathwayId].steps.every(s => !!c.steps[s.id]?.completedAt);
}
