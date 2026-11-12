import type { State } from '@/domain/state';
import type { Directory, Lang, Person, PathwayId, StepId } from '@/types/halqa';

export interface SessionUser { id: string; email: string; person: Person; network: string; patientCase?: string; mustChangePassword?: boolean }
export interface PatientSummary {
  id: string; name: string; lang: Lang; released: boolean; pathwayId?: PathwayId; reviewed: boolean;
  needsInterpreter: boolean; callbackPending: boolean; understood: boolean;
  next?: { label: string; owner: string; dueAt: number };
  steps: { id: StepId; label: string; completedAt?: number }[];
  appointment?: { at: number; location: string };
  canBook: boolean; facility?: string;
  team: { name: string; org: string }[];
  messages: { id: string; from: string; patient: boolean; text: string; at: number }[];
}
/**
 * Staff and receiving services of the signed-in user's network, read from the
 * database. `people` holds enabled staff accounts only (id, name, role, org,
 * licence; never emails). `services` holds enabled services whose specialist
 * is enabled. Empty for patient accounts.
 */
export type SnapshotDirectory = Directory;
export interface Snapshot { state: State; revision: number; directory: SnapshotDirectory; user: SessionUser; csrf: string; testControls: boolean; patient?: PatientSummary }
