import { NextRequest } from 'next/server';
import { receiveResult } from '@/server/intake';
import { authenticateIntegration } from '@/server/integration';
import { body, failure, privateJson, logged } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Lab results. Bearer key only: no cookie and no CSRF token. 201 new case, 200 repeat of a known result. */
export const POST = logged('/api/intake/results', async (request: NextRequest) => {
  try {
    rateLimit(request, 'intake');
    authenticateIntegration(request.headers.get('authorization'), 'HALQA_INTAKE_KEY_SHA256');
    const result = receiveResult(await body(request));
    return privateJson({ caseId: result.id, created: result.created }, result.created ? 201 : 200);
  } catch (error) { return failure(error); }
});
