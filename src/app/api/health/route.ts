import { NextRequest } from 'next/server';
import { HttpError } from '@/server/auth';
import { database } from '@/server/db';
import { failure, logged, privateJson } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * No sign-in, no cookie. 200 {ok:true} after a trivial database read; 503 {ok:false}
 * when the read fails. Says nothing about versions, paths or settings.
 */
export const GET = logged('/api/health', (request: NextRequest) => {
  try {
    rateLimit(request, 'health');
    database().prepare('SELECT 1').get();
    return privateJson({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) return failure(error);
    const response = privateJson({ ok: false }, 503);
    response.headers.set('x-halqa-error-name', error instanceof Error ? error.name : 'UnknownError');
    return response;
  }
});
