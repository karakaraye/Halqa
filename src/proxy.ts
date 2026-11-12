import { NextRequest, NextResponse } from 'next/server';
import { newNonce, pagePolicy } from '@/server/csp';

/**
 * Gives every page response its own script nonce and the matching
 * Content-Security-Policy. Next.js reads the policy from the request headers
 * while rendering and puts the nonce on its scripts. JSON routes and built
 * files are skipped: next.config.js gives the JSON routes their own policy.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = pagePolicy(nonce, {
    development: process.env.NODE_ENV === 'development',
    https: /^https:/i.test(process.env.HALQA_ORIGIN ?? ''),
  });
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [{ source: '/((?!api/|_next/static/|_next/image|favicon.ico).*)' }],
};
