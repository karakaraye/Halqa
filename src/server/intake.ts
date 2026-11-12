import { z } from 'zod';
import { Case, Person } from '@/types/halqa';
import { leastLoadedNavigator, nextCaseId, openCase } from '@/domain/intake';
import { HttpError } from './auth';
import { transaction } from './db';

const text = z.string().trim().min(1).max(200);
export const intakeSchema = z.object({
  externalId: text,
  network: text,
  patient: z.object({
    id: text, name: text, age: z.number().int().min(0).max(130), sex: z.enum(['F', 'M']),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/), lang: z.enum(['en', 'ar', 'hi', 'ur']),
    preferredChannel: z.enum(['SMS', 'WHATSAPP', 'APP', 'PHONE', 'PORTAL']),
    needsInterpreter: z.boolean().optional(), nationality: text.optional(),
  }).strict(),
  pathwayId: z.enum(['CRC_FIT', 'BREAST_BIRADS', 'CERVICAL_HPV', 'DIABETES_HBA1C']),
  finding: z.string().trim().min(1).max(2000),
  resultCode: text,
  urgency: z.enum(['CRITICAL', 'ELEVATED', 'ROUTINE']),
  sourceLab: text,
  issuedAt: z.number().int().positive(),
  pcpId: text.optional(),
}).strict();
export type IntakeInput = z.infer<typeof intakeSchema>;

/** A result may be stamped at most five minutes ahead of the server clock. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const INTAKE_ACTOR = 'intake';

/**
 * Opens one case for a lab result. A repeat of the same (network, externalId)
 * returns the existing case and changes nothing. Patient accounts are not
 * created here: a lead links one to the case through account administration.
 */
export function receiveResult(body: unknown, now = Date.now()): { id: string; created: boolean } {
  const parsed = intakeSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(422, 'The result is missing information or has a value we cannot accept.');
  const input = parsed.data;
  if (input.issuedAt > now + MAX_CLOCK_SKEW_MS) throw new HttpError(422, 'The result is dated in the future.');
  return transaction(db => {
    const existing = db.prepare('SELECT id FROM cases WHERE network=? AND external_id=?').get(input.network, input.externalId) as { id: string } | undefined;
    if (existing) return { id: existing.id, created: false };
    const people = (db.prepare("SELECT person FROM users WHERE network=? AND disabled_at IS NULL AND patient_case IS NULL").all(input.network) as { person: string }[])
      .map(row => JSON.parse(row.person) as Person).filter(p => p.role !== 'PATIENT');
    if (!people.length) throw new HttpError(422, 'This network has no staff accounts.');
    const pcp = input.pcpId ? people.find(p => p.id === input.pcpId && p.role === 'PCP') : undefined;
    if (input.pcpId && !pcp) throw new HttpError(422, 'The doctor is not an active doctor in this network.');
    const open = (db.prepare('SELECT data FROM cases WHERE network=?').all(input.network) as { data: string }[]).map(row => JSON.parse(row.data) as Case);
    const navigator = leastLoadedNavigator(people.filter(p => p.role === 'NAVIGATOR'), open);
    const id = nextCaseId((db.prepare('SELECT id FROM cases').all() as { id: string }[]).map(row => row.id));
    const { patient, pathwayId, finding, resultCode, urgency, sourceLab, issuedAt } = input;
    const result = { patient, pathwayId, finding, resultCode, urgency, sourceLab, issuedAt };
    const c = openCase({ id, result, pcp, navigator }, now);
    db.prepare('INSERT INTO cases(id,network,data,external_id) VALUES(?,?,?,?)').run(id, input.network, JSON.stringify(c), input.externalId);
    for (const entry of c.audit) db.prepare('INSERT INTO events(case_id,user_id,at,action,detail) VALUES(?,?,?,?,?)').run(id, INTAKE_ACTOR, entry.at, entry.action, JSON.stringify(entry));
    db.prepare("INSERT INTO meta(key,value) VALUES('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    return { id, created: true };
  });
}
