import { NextRequest } from 'next/server';
import { changePassword } from '@/server/accounts';
import { body, failure, privateJson, session, logged, setSessionCookie } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signed in, CSRF. Body {currentPassword, newPassword}. Ends every other session and returns a fresh one. */
export const POST = logged('/api/account/password', async (request: NextRequest) => {
  try {
    rateLimit(request, 'password');
    const s = session(request, true, { duringPasswordChange: true });
    const result = changePassword(s.user.id, await body(request));
    const response = privateJson({ ok: true, user: result.user, csrf: result.csrf });
    setSessionCookie(response, request, result.token);
    return response;
  } catch (e) {
    return failure(e);
  }
});
