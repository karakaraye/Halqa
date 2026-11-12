import { createHash } from 'node:crypto';
import type { Directory } from '@/types/halqa';
import type { SessionUser } from '@/shared/protocol';

/** The tag changes at least this often, so derived times (the patient's next step) are never more than a minute old. */
export const ETAG_CLOCK_BUCKET_MS = 60_000;
export const clockBucket = (now = Date.now()) => Math.floor(now / ETAG_CLOCK_BUCKET_MS);

/**
 * What a workspace snapshot depends on, apart from the server clock: the
 * revision (raised by every saved change to a case), the user, the session's
 * form token, the network's staff and services, whether test controls are on,
 * and the clock bucket. All of it is cheap to read, so a poll can be answered
 * 304 before any case is read.
 */
export interface TagInputs { revision: number; user: SessionUser; csrf: string; directory: Directory; testControls: boolean; bucket: number }

export function workspaceEtag({ revision, user, csrf, directory, testControls, bucket }: TagInputs): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([user, csrf, directory, testControls, bucket]))
    .digest('base64url').slice(0, 27);
  return `"r${revision}-${digest}"`;
}

/** True when an If-None-Match header names this tag (weak or strong form) or is `*`. */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(',').map((part) => part.trim().replace(/^W\//, '')).some((tag) => tag === '*' || tag === etag);
}
