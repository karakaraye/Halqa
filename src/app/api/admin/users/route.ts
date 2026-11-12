import { NextRequest } from 'next/server';
import { createAccount, listAccounts, newAccountSchema } from '@/server/accounts';
import { HttpError } from '@/server/auth';
import { body, failure, privateJson, session, logged } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const leadOnly = (role: string) => { if (role !== 'LEAD') throw new HttpError(403, 'Only a lead can manage accounts.'); };

export const GET = logged('/api/admin/users', async (request: NextRequest) => {
  try {
    rateLimit(request, 'admin');
    const s = session(request);
    leadOnly(s.user.person.role);
    return privateJson({ accounts: listAccounts(s.user.network) });
  } catch (e) {
    return failure(e);
  }
});

export const POST = logged('/api/admin/users', async (request: NextRequest) => {
  try {
    rateLimit(request, 'admin');
    const s = session(request, true);
    leadOnly(s.user.person.role);
    const parsed = newAccountSchema.safeParse(await body(request));
    if (!parsed.success) throw new HttpError(422, 'Check the name, email, role and organisation.');
    return privateJson(createAccount(parsed.data, s.user.network, s.user.id), 201);
  } catch (e) {
    return failure(e);
  }
});
