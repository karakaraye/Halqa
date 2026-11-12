import { NextRequest, NextResponse } from 'next/server';
import { readWorkspace, execute } from '@/server/workspace';
import { session, privateJson, failure, body, logged } from '@/server/http';
import { etagMatches } from '@/server/etag';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/**
 * Conditional read: a matching If-None-Match gets 304 with no body, decided before
 * the snapshot is built. Both answers stay private and uncached.
 */
export const GET = logged('/api/workspace', async (request:NextRequest) => {
  try {
    const ifNoneMatch=request.headers.get('if-none-match');
    const {etag,body:text}=readWorkspace(session(request,false,{duringPasswordChange:true}),ifNoneMatch);
    if(text===undefined||etagMatches(ifNoneMatch,etag)) {
      return new NextResponse(null,{status:304,headers:{'ETag':etag,'Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
    }
    return new NextResponse(text,{status:200,headers:{'Content-Type':'application/json','ETag':etag,'Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
  } catch(e) {return failure(e);}
});
export const POST = logged('/api/workspace', async (request:NextRequest) => {try { const actor=session(request,true);return privateJson(execute(actor,await body(request)));} catch(e) {return failure(e);}});
