import { NextRequest } from 'next/server';
import { login, logout, HttpError } from '@/server/auth';
import { COOKIE, privateJson, sameOrigin, session, body, failure, logged, setSessionCookie, clearSessionCookie } from '@/server/http';
import { loginSchema } from '@/server/schemas';
import { clientAddress, rateLimit } from '@/server/rate-limit';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET = logged('/api/session', async (request:NextRequest) => {
  try { const s=session(request,false,{duringPasswordChange:true}); return privateJson({user:s.user,csrf:s.csrf}); } catch(e) { return failure(e); }
});
export const POST = logged('/api/session', async (request:NextRequest) => {
  try {
    sameOrigin(request);
    rateLimit(request,'signin');
    const input=loginSchema.safeParse(await body(request));
    if(!input.success) throw new HttpError(422,'Enter a valid email and password.');
    const result=login(input.data.email,input.data.password,clientAddress(request));
    // A session this browser already held ends now, so an old cookie cannot be reused after a new sign-in.
    logout(request.cookies.get(COOKIE)?.value,false);
    const response=privateJson({user:result.user,csrf:result.csrf});
    setSessionCookie(response,request,result.token);
    return response;
  } catch(e) {return failure(e);}
});
export const DELETE = logged('/api/session', async (request:NextRequest) => {
  try {
    session(request,true,{duringPasswordChange:true}); logout(request.cookies.get(COOKIE)?.value);
    const response=privateJson({ok:true}); clearSessionCookie(response,request); return response;
  } catch(e) { return failure(e); }
});
