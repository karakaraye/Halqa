import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Directory, PathwayId, Person } from '@/types/halqa';
import { database, transaction } from './db';
import { HttpError, recordEvent } from './auth';

/**
 * The staff directory and receiving services of one network, read from the
 * database. Every server request path uses this; the domain's fallback
 * directory is for pure unit tests only.
 */

type ServiceRow = { id: string; network: string; facility: string; specialty: string; pathway: string; specialist_user_id: string; disabled_at: number | null };

/** Only the public fields of a person: never the email, password hash or patient link. */
const publicPerson = (p: Person): Person => ({ id: p.id, name: p.name, role: p.role, org: p.org, ...(p.licence ? { licence: p.licence } : {}) });

/** Enabled staff accounts (not patients) of the network. */
function staff(db: DatabaseSync, network: string): Person[] {
  return (db.prepare('SELECT person FROM users WHERE network=? AND disabled_at IS NULL AND patient_case IS NULL ORDER BY id').all(network) as { person: string }[])
    .map((row) => JSON.parse(row.person) as Person)
    .filter((p) => p.role !== 'PATIENT')
    .map(publicPerson);
}

/**
 * The directory for a network. A service is listed only while it is enabled
 * and its specialist's account is enabled, so referrals never go to a service
 * no one can answer.
 */
export function loadDirectory(db: DatabaseSync, network: string): Directory {
  const people = staff(db, network);
  const rows = db.prepare('SELECT * FROM services WHERE network=? AND disabled_at IS NULL ORDER BY facility, pathway').all(network) as ServiceRow[];
  const services = rows
    .filter((row) => people.some((p) => p.id === row.specialist_user_id && p.role === 'SPECIALIST'))
    .map((row) => ({ facility: row.facility, specialty: row.specialty, pathway: row.pathway as PathwayId, specialist: row.specialist_user_id }));
  return { people, services };
}

export const EMPTY_DIRECTORY: Directory = { people: [], services: [] };

export const newServiceSchema = z.object({
  facility: z.string().trim().min(2).max(160),
  specialty: z.string().trim().min(2).max(120),
  pathway: z.enum(['CRC_FIT', 'BREAST_BIRADS', 'CERVICAL_HPV', 'DIABETES_HBA1C']),
  specialistUserId: z.string().trim().min(1).max(100),
}).strict();
export type NewService = z.infer<typeof newServiceSchema>;

/** What a lead sees about a receiving service. */
export interface ServiceSummary {
  id: string; facility: string; specialty: string; pathway: PathwayId;
  specialistUserId: string; specialistName: string; disabled: boolean;
}

function summary(row: ServiceRow, names: Map<string, string>): ServiceSummary {
  return {
    id: row.id, facility: row.facility, specialty: row.specialty, pathway: row.pathway as PathwayId,
    specialistUserId: row.specialist_user_id, specialistName: names.get(row.specialist_user_id) ?? '', disabled: row.disabled_at != null,
  };
}

function names(db: DatabaseSync, network: string) {
  return new Map((db.prepare('SELECT id, person FROM users WHERE network=?').all(network) as { id: string; person: string }[])
    .map((row) => [row.id, (JSON.parse(row.person) as Person).name]));
}

/** Every service of the network, enabled or not. */
export function listServices(network: string): ServiceSummary[] {
  const db = database();
  const rows = db.prepare('SELECT * FROM services WHERE network=? ORDER BY facility, pathway').all(network) as ServiceRow[];
  const known = names(db, network);
  return rows.map((row) => summary(row, known));
}

/** Inserts one service inside the caller's transaction after checking the specialist. */
export function insertService(db: DatabaseSync, input: NewService, network: string, id = `svc_${randomUUID().replaceAll('-', '').slice(0, 16)}`): ServiceRow {
  const user = db.prepare('SELECT person, disabled_at FROM users WHERE id=? AND network=? AND patient_case IS NULL').get(input.specialistUserId, network) as { person: string; disabled_at: number | null } | undefined;
  if (!user || user.disabled_at != null || (JSON.parse(user.person) as Person).role !== 'SPECIALIST') {
    throw new HttpError(422, 'Choose an active specialist in this network.');
  }
  if (db.prepare('SELECT id FROM services WHERE network=? AND facility=? AND pathway=?').get(network, input.facility, input.pathway)) {
    throw new HttpError(409, 'This service already exists for that programme.');
  }
  const row: ServiceRow = { id, network, facility: input.facility, specialty: input.specialty, pathway: input.pathway, specialist_user_id: input.specialistUserId, disabled_at: null };
  db.prepare('INSERT INTO services(id,network,facility,specialty,pathway,specialist_user_id) VALUES (?,?,?,?,?,?)')
    .run(row.id, network, row.facility, row.specialty, row.pathway, row.specialist_user_id);
  return row;
}

export function createService(input: unknown, network: string, createdBy: string): ServiceSummary {
  const parsed = newServiceSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, 'Check the service name, specialty, programme and specialist.');
  return transaction((db) => {
    const row = insertService(db, parsed.data, network);
    recordEvent(db, createdBy, 'SERVICE_CREATED', { service: row.id, facility: row.facility, pathway: row.pathway, specialist: row.specialist_user_id, network });
    return summary(row, names(db, network));
  });
}

/** Stops new referrals to a service. The record is kept so past referrals still read correctly. */
export function disableService(id: string, network: string, disabledBy: string) {
  transaction((db) => {
    const row = db.prepare('SELECT * FROM services WHERE id=? AND network=?').get(id, network) as ServiceRow | undefined;
    if (!row) throw new HttpError(404, 'Service not found.');
    if (row.disabled_at == null) {
      db.prepare('UPDATE services SET disabled_at=? WHERE id=?').run(Date.now(), id);
      recordEvent(db, disabledBy, 'SERVICE_DISABLED', { service: id, facility: row.facility, pathway: row.pathway, network });
    }
  });
}
