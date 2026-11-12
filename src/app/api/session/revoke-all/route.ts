import { NextRequest } from 'next/server';
import { revokeAllSessions } from '@/server/auth';
import { clearSessionCookie, failure, logged, privateJson, session } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Signed in, CSRF. Ends every session of the signed-in account on every device,
 * this one included, and clears this device's cookie. 200 {ok:true,sessions:n}.
 * Allowed while the password is temporary, so a person can always sign out everywhere.
 */
export const POST = logged('/api/session/revoke-all', async (request: NextRequest) => {
  try {
    const s = session(request, true, { duringPasswordChange: true });
    const ended = revokeAllSessions(s.user.id);
    const response = privateJson({ ok: true, sessions: ended });
    clearSessionCookie(response, request);
    return response;
  } catch (e) {
    return failure(e);
  }
});
