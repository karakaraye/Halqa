import { NextRequest } from 'next/server';
import { createService, listServices } from '@/server/directory';
import { HttpError } from '@/server/auth';
import { body, failure, privateJson, session, logged } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const leadOnly = (role: string) => { if (role !== 'LEAD') throw new HttpError(403, 'Only a lead can manage receiving services.'); };

/** Lead only. 200 {services: ServiceSummary[]} for the lead's network, enabled and disabled. */
export const GET = logged('/api/admin/services', async (request: NextRequest) => {
  try {
    rateLimit(request, 'admin');
    const s = session(request);
    leadOnly(s.user.person.role);
    return privateJson({ services: listServices(s.user.network) });
  } catch (e) {
    return failure(e);
  }
});

/** Lead only, CSRF. Body {facility, specialty, pathway, specialistUserId}. 201 {service}; 422 invalid; 409 already exists. */
export const POST = logged('/api/admin/services', async (request: NextRequest) => {
  try {
    rateLimit(request, 'admin');
    const s = session(request, true);
    leadOnly(s.user.person.role);
    return privateJson({ service: createService(await body(request), s.user.network, s.user.id) }, 201);
  } catch (e) {
    return failure(e);
  }
});
