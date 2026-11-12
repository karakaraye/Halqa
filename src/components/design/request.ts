/** Calls the server and turns every failure into a sentence a person can act on. */
import { ERROR_TEXT } from '@/context/HalqaStore';

/**
 * Sends a request and returns the answer. The server's own reason is shown only when it sent a written one
 * for a refusal; a lost connection, an unreadable answer or a server fault uses the shared plain wording.
 */
export async function callServer<T = Record<string, unknown>>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(ERROR_TEXT.network);
  }
  let data: (T & { error?: unknown }) | null = null;
  try { data = await response.json(); } catch { data = null; }
  if (response.status >= 500) throw new Error(ERROR_TEXT.save);
  if (!response.ok) {
    const written = typeof data?.error === 'string' && data.error.trim() ? data.error : '';
    throw new Error(written || fallback);
  }
  if (!data) throw new Error(ERROR_TEXT.unconfirmed);
  return data;
}
