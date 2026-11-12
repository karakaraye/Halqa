import { NextRequest, NextResponse } from 'next/server';
import { HttpError, SESSION_HOURS, sameSecret, sessionFor } from './auth';
export const COOKIE='halqa_session';
/**
 * Cookies are Secure whenever HALQA_ORIGIN is an https address (the proxy may
 * reach the app over plain http, so the request's own scheme does not decide),
 * or when the request itself arrived over https.
 */
export function secureCookies(request:NextRequest) {
  const origin=process.env.HALQA_ORIGIN?.trim();
  return origin ? /^https:/i.test(origin) : request.nextUrl.protocol==='https:';
}
const cookieBase=(request:NextRequest)=>({httpOnly:true,sameSite:'strict' as const,path:'/',secure:secureCookies(request)});
export function setSessionCookie(response:NextResponse,request:NextRequest,token:string) {
  response.cookies.set(COOKIE,token,{...cookieBase(request),maxAge:SESSION_HOURS*3600});
}
export function clearSessionCookie(response:NextResponse,request:NextRequest) {
  response.cookies.set(COOKIE,'',{...cookieBase(request),maxAge:0});
}
export const privateJson=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export const PASSWORD_CHANGE_REQUIRED='Set a new password to continue.';
/**
 * The signed-in session of a request. `write` adds the origin and CSRF checks.
 *
 * While an account must change its temporary password, every route is refused
 * with 403 unless it passes `duringPasswordChange: true`. Only reading the
 * workspace and the session, changing the password and signing out do; new
 * routes are refused by default.
 */
export function session(request:NextRequest,write=false,{duringPasswordChange=false}:{duringPasswordChange?:boolean}={}) {
  const found=sessionFor(request.cookies.get(COOKIE)?.value);
  if(!found) throw new HttpError(401,'Please sign in.');
  if(write) {
    sameOrigin(request);
    if(!sameSecret(request.headers.get('x-halqa-csrf'),found.csrf)) throw new HttpError(403,'Session verification failed. Refresh and try again.');
  }
  if(found.user.mustChangePassword&&!duringPasswordChange) throw new HttpError(403,PASSWORD_CHANGE_REQUIRED);
  return found;
}
export function sameOrigin(request:NextRequest) {
  const expected=process.env.HALQA_ORIGIN||request.nextUrl.origin;
  if(request.headers.get('origin')!==expected) throw new HttpError(403,'Request origin is not permitted.');
}
export async function body(request:NextRequest) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415,'Use JSON.');
  if(Number(request.headers.get('content-length')||0)>32000) throw new HttpError(413,'Request is too large.');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'A JSON body is required.');
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>32000){await reader.cancel();throw new HttpError(413,'Request is too large.');}chunks.push(value);}
  const raw=Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw new HttpError(400,'Invalid JSON.'); }
}
/** Header that carries the error name from failure() to logged(); logged() removes it before the response leaves. */
const ERROR_HEADER = 'x-halqa-error-name';
/**
 * The fixed SQLite result text of a database error (for example "database is
 * locked"), so operators can tell lock contention from other faults. It never
 * contains data: SQLite fills it from a fixed list.
 */
const DATABASE_HEADER = 'x-halqa-database-error';
export function databaseErrorText(error:unknown):string|undefined {
  const e=error as {code?:unknown;errstr?:unknown};
  return e&&e.code==='ERR_SQLITE_ERROR'&&typeof e.errstr==='string'?e.errstr.slice(0,60):undefined;
}
export function failure(error:unknown) {
  const name=error instanceof Error?error.name:'UnknownError';
  const response=error instanceof HttpError
    ? privateJson({error:error.message},error.status)
    : privateJson({error:'The service could not complete the request.'},500);
  response.headers.set(ERROR_HEADER,name);
  const database=databaseErrorText(error);
  if(database) response.headers.set(DATABASE_HEADER,database);
  return response;
}
/**
 * One JSON line on standard output with only: time, route (the pattern, never ids),
 * method, status, error name and, for database faults, SQLite's fixed result text.
 * Never request bodies, emails, tokens or phone numbers.
 */
export function logLine(route:string,method:string,status:number,error?:string,database?:string) {
  console.log(JSON.stringify({time:new Date().toISOString(),route,method,status,...(error?{error}:{}),...(database?{database}:{})}));
}
/** Wraps a route handler: logs every failed request and every write request, and turns a thrown error into a 500. */
export function logged<A extends unknown[]>(route:string,handler:(request:NextRequest,...rest:A)=>Promise<NextResponse>|NextResponse) {
  return async (request:NextRequest,...rest:A):Promise<NextResponse> => {
    let response:NextResponse;
    try { response=await handler(request,...rest); } catch(error) { response=failure(error); }
    const error=response.headers.get(ERROR_HEADER)??undefined;
    const database=response.headers.get(DATABASE_HEADER)??undefined;
    response.headers.delete(ERROR_HEADER);
    response.headers.delete(DATABASE_HEADER);
    const read=request.method==='GET'||request.method==='HEAD';
    if(!read||response.status>=400) logLine(route,request.method,response.status,error,database);
    return response;
  };
}
