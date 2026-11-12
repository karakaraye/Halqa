import { NextRequest } from 'next/server';
import { authenticateIntegration } from '@/server/integration';
import { receiveDelivery } from '@/server/delivery';
import { body, failure, privateJson, logged } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Delivery reports from the message service. Bearer key only: no cookie and no CSRF token. */
export const POST = logged('/api/intake/delivery', async (request: NextRequest) => {
  try {
    rateLimit(request, 'delivery');
    authenticateIntegration(request.headers.get('authorization'), 'HALQA_DELIVERY_KEY_SHA256');
    const status = receiveDelivery(await body(request));
    return privateJson({ ok: true, status });
  } catch (error) { return failure(error); }
});
