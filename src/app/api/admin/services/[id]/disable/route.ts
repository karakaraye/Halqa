import { NextRequest } from 'next/server';
import { disableService } from '@/server/directory';
import { HttpError } from '@/server/auth';
import { failure, privateJson, session, logged } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lead only, CSRF. 200 {ok:true}; 404 when the service is not in the lead's network. New referrals to it are refused. */
export const POST = logged('/api/admin/services/[id]/disable', async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    rateLimit(request, 'admin');
    const s = session(request, true);
    if (s.user.person.role !== 'LEAD') throw new HttpError(403, 'Only a lead can manage receiving services.');
    const { id } = await context.params;
    if (!id || id.length > 100) throw new HttpError(422, 'Choose a service.');
    disableService(id, s.user.network, s.user.id);
    return privateJson({ ok: true });
  } catch (e) {
    return failure(e);
  }
});
