import { Directory, PathwayId, Person, Service } from '@/types/halqa';
import { PEOPLE, SPECIALIST_SERVICES } from '@/lib/pathways';

/**
 * Fallback directory for pure domain unit tests that run the reducer without a
 * database. The server never uses it: every request reads the directory of the
 * signed-in user's network from the database and passes it in State.directory
 * (tests/directory.test.ts proves the server never reads this object).
 */
export const FALLBACK_DIRECTORY: Directory = { people: Object.values(PEOPLE), services: SPECIALIST_SERVICES };

const resolve = (directory?: Directory) => directory ?? FALLBACK_DIRECTORY;

export function findPerson(directory: Directory | undefined, id: string): Person | undefined {
  return resolve(directory).people.find((p) => p.id === id);
}

/** A staff member whose role is one of `roles`, or undefined. */
export function staffMember(directory: Directory | undefined, id: string, roles: Person['role'][]): Person | undefined {
  const person = findPerson(directory, id);
  return person && roles.includes(person.role) ? person : undefined;
}

export function servicesFor(directory: Directory | undefined, pathway: PathwayId): Service[] {
  return resolve(directory).services.filter((s) => s.pathway === pathway);
}

export function servicesAt(directory: Directory | undefined, facility: string | undefined): Service[] {
  return facility ? resolve(directory).services.filter((s) => s.facility === facility) : [];
}

/** True when this person answers referrals for the facility. */
export function answersFor(directory: Directory | undefined, facility: string | undefined, personId: string) {
  return servicesAt(directory, facility).some((s) => s.specialist === personId);
}

/** The network's clinical lead, who receives the serious alerts. */
export function leadOf(directory: Directory | undefined): Person | undefined {
  return resolve(directory).people.find((p) => p.role === 'LEAD');
}
