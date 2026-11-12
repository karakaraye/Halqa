import { Case, Channel, Lang, PathwayId, Person, Urgency } from '@/types/halqa';
import { PATHWAYS } from '@/lib/pathways';
import { isClosed } from '@/lib/engine';

/** A screening result as the lab reports it. */
export interface NewResult {
  patient: {
    id: string; name: string; age: number; sex: 'F' | 'M'; phone: string; lang: Lang;
    preferredChannel: Channel; needsInterpreter?: boolean; nationality?: string;
  };
  pathwayId: PathwayId;
  finding: string;
  resultCode: string;
  urgency: Urgency;
  sourceLab: string;
  issuedAt: number;
}

export interface CaseOpening {
  id: string;
  result: NewResult;
  navigator?: Person;
  pcp?: Person;
}

/**
 * Opens the case for a newly received result. Nothing is assumed about the
 * patient: no step is complete and no message is recorded as sent, so the
 * patient view stays closed until someone tells the patient.
 */
export function openCase({ id, result, navigator, pcp }: CaseOpening, now: number): Case {
  const pathway = PATHWAYS[result.pathwayId];
  const routing = [
    pcp ? `Doctor: ${pcp.name}.` : 'No doctor named yet.',
    navigator ? `Navigator: ${navigator.name}.` : 'No navigator available yet.',
  ];
  return {
    id,
    // Case requires this flag. Delivery reports, not this value, decide whether a message arrived.
    patient: { ...result.patient, phoneReachable: true },
    pathwayId: result.pathwayId,
    finding: result.finding,
    resultCode: result.resultCode,
    urgency: result.urgency,
    sourceLab: result.sourceLab,
    issuedAt: result.issuedAt,
    team: { ...(navigator ? { NAVIGATOR: navigator } : {}), ...(pcp ? { PCP: pcp } : {}) },
    ...(pcp ? { accountable: pcp } : {}),
    steps: {},
    clockResets: {},
    notifications: [],
    messages: [],
    escalations: [],
    delayReasons: [],
    audit: [
      { at: now, actor: result.sourceLab, action: `New ${pathway.short.toLowerCase()} result received`, detail: `${result.finding} (${result.resultCode}). ${routing.join(' ')}`, system: true },
    ],
  };
}

/** Next unused identifier in the HQ-#### series. */
export function nextCaseId(existing: string[]): string {
  let highest = 1000;
  for (const id of existing) {
    const match = /^HQ-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `HQ-${String(highest + 1).padStart(4, '0')}`;
}

/** The navigator with the fewest open cases; ties go to the first by name. */
export function leastLoadedNavigator(navigators: Person[], cases: Case[]): Person | undefined {
  const open = (p: Person) => cases.filter((c) => !isClosed(c) && !c.historical && c.team.NAVIGATOR?.id === p.id).length;
  return [...navigators]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((person) => ({ person, load: open(person) }))
    .sort((a, b) => a.load - b.load)[0]?.person;
}
