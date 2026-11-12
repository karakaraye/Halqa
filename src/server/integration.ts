import { timingSafeEqual } from 'node:crypto';
import { HttpError, tokenHash } from './auth';

/** At most this many key hashes per variable: the current key and the ones being replaced. */
export const MAX_KEYS_PER_CONNECTION = 3;

/**
 * The SHA-256 hashes configured for a connection. The variable holds one hash,
 * or several separated by commas while a key is being replaced, so the old and
 * the new key both work during the change-over. Undefined when the value is
 * missing or not valid.
 */
export function configuredKeyHashes(value: string | undefined): Buffer[] | undefined {
  const parts = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > MAX_KEYS_PER_CONNECTION || parts.some((part) => !/^[a-f0-9]{64}$/i.test(part))) return undefined;
  return parts.map((part) => Buffer.from(part.toLowerCase(), 'hex'));
}

/**
 * Checks `Authorization: Bearer <key>` for a server-to-server route. The
 * environment variable holds the SHA-256 of the key in hex, never the key.
 * Unset: 503. Missing or wrong key: 401. The key is never logged or stored.
 */
export function authenticateIntegration(authorization: string | null, variable: 'HALQA_INTAKE_KEY_SHA256' | 'HALQA_DELIVERY_KEY_SHA256') {
  const configured = configuredKeyHashes(process.env[variable]);
  if (!configured) throw new HttpError(503, 'This connection is not set up on the server.');
  const match = /^Bearer ([^\s]{1,512})$/.exec(authorization ?? '');
  // Always hash and compare against every configured hash, so a missing key takes as long as a wrong one.
  const supplied = Buffer.from(tokenHash(match?.[1] ?? ''), 'hex');
  let equal = false;
  for (const expected of configured) equal = timingSafeEqual(supplied, expected) || equal;
  if (!match || !equal) throw new HttpError(401, 'The connection key is missing or not valid.');
}
