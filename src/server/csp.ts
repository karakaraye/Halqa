/**
 * Content-Security-Policy for the screens. Scripts run only when they carry the
 * nonce of this response (Next.js adds it to its own scripts and chunks) or are
 * loaded by such a script ('strict-dynamic'). No inline script without the nonce,
 * no eval outside development, no plug-ins, no framing, no other origins.
 *
 * style-src keeps 'unsafe-inline' because React writes style attributes into the
 * server-rendered page, and a nonce cannot cover attributes. Styles cannot run code.
 */
export function pagePolicy(nonce: string, { development = false, https = false }: { development?: boolean; https?: boolean } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** Policy for JSON routes: they never render anything, so nothing may load. */
export const API_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** A fresh nonce for one response: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
