import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {NextRequest} from 'next/server';
import {bootstrap} from '../src/server/bootstrap';
import {database,closeDatabases} from '../src/server/db';
import {login,logout,sessionFor,Session,User,HttpError} from '../src/server/auth';
import {getSnapshot,execute,refreshEscalations} from '../src/server/workspace';
import {createRequire} from 'node:module';
import {canRead} from '../src/server/permissions';
import {commandSchema} from '../src/server/schemas';
import {PEOPLE,SPECIALIST_SERVICES} from '../src/lib/pathways';
import {Case} from '../src/types/halqa';
import {GET as readWorkspace,POST as writeWorkspace} from '../src/app/api/workspace/route';
import {POST as signIn,DELETE as signOut} from '../src/app/api/session/route';

process.env.HALQA_DB_PATH=resolve('data',`test-${randomUUID()}`,'halqa.sqlite');
delete process.env.HALQA_TEST_CONTROLS;
const password='Synthetic-test-'+randomUUID();
bootstrap(password);
const account=(id:string)=>{const result=login(`${id}@halqa.test`,password);return {result,session:sessionFor(result.token)!};};
const nav=account('nav_reem');const pcp=account('pcp_mariam');const specialist=account('sp_tariq');const lead=account('lead_fatima');const patient=account('patient_hq-1003');
const command=(s:Session,action:unknown,revision=getSnapshot(s).revision,requestId=randomUUID())=>execute(s,{requestId,revision,action});
const request=(path:string,token?:string,csrf?:string,payload?:unknown,origin='http://localhost:3000')=>new NextRequest(`http://localhost:3000${path}`,{method:payload?'POST':'GET',headers:{...(token?{cookie:`halqa_session=${token}`}:{ }),...(csrf?{'x-halqa-csrf':csrf}:{}),'content-type':'application/json',origin},...(payload?{body:JSON.stringify(payload)}:{})});
after(()=>closeDatabases());

test('passwords and session tokens are hashed, invalid login is rejected, logout revokes',()=>{
  const row=database().prepare('SELECT password_hash FROM users WHERE id=?').get('nav_reem') as {password_hash:string};
  assert.notEqual(row.password_hash,password);assert.ok(row.password_hash.includes(':'));
  assert.throws(()=>login('nav_reem@halqa.test','wrong'),(e:unknown)=>e instanceof HttpError&&e.status===401);
  const temporary=login('nav_reem@halqa.test',password);
  assert.equal(database().prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(temporary.token),undefined);
  assert.ok(sessionFor(temporary.token));logout(temporary.token);assert.equal(sessionFor(temporary.token),undefined);
});
test('account lockout applies after repeated failed logins',()=>{
  for(let i=0;i<8;i++)assert.throws(()=>login('missing@halqa.test','wrong'));
  assert.throws(()=>login('missing@halqa.test','wrong'),(e:unknown)=>e instanceof HttpError&&e.status===429);
});
test('each role sees only permitted cases; patient DTO contains no clinical audit or other patients',()=>{
  const n=getSnapshot(nav.session);assert.ok(n.state.cases.length>0);
  const s=getSnapshot(specialist.session);assert.ok(s.state.cases.length>0);assert.ok(s.state.cases.length<n.state.cases.length);
  for(const c of s.state.cases)assert.ok(canRead(specialist.session.user,c,s.directory));
  const p=getSnapshot(patient.session);assert.deepEqual(p.state.cases,[]);assert.equal(p.patient?.id,'HQ-1003');
  const json=JSON.stringify(p.patient);assert.ok(!json.includes('audit'));assert.ok(!json.includes('ECONSULT'));assert.ok(!json.includes('signedLicence'));
  const outsider:User={...nav.session.user,id:'outsider',person:{id:'outsider',name:'Outside clinician',org:'Outside clinic',role:'PCP'}};
  assert.equal(getSnapshot({...nav.session,user:outsider}).state.cases.length,0);
  assert.equal(getSnapshot({...lead.session,user:{...lead.session.user,network:'another-network'}}).state.cases.length,0);
});
test('patient writes are shared with staff and durable after database reconnection',()=>{
  const before=getSnapshot(patient.session);assert.equal(before.patient?.id,'HQ-1003');
  command(patient.session,{type:'CALLBACK_REQUEST',id:'HQ-1003'},before.revision);
  assert.equal(getSnapshot(nav.session).state.cases.find(c=>c.id==='HQ-1003')?.callbackRequestedAt!==undefined,true);
  closeDatabases();assert.equal(getSnapshot(patient.session).patient?.callbackPending,true);
});
test('staff cannot impersonate patients and patients cannot mutate another case or close a case',()=>{
  assert.throws(()=>command(nav.session,{type:'MESSAGE',id:'HQ-1003',thread:'PATIENT',text:'Spoofed message',asPatient:true}),/impersonate/);
  assert.throws(()=>command(patient.session,{type:'CALLBACK_REQUEST',id:'HQ-1001'}),/not found/);
  assert.throws(()=>command(patient.session,{type:'CLOSE_CASE',id:'HQ-1003',closure:{kind:'EVIDENCE',outcome:'Done',evidenceRef:'RPT-X',plan:'Routine followup'}}),/account cannot/);
  assert.throws(()=>command(nav.session,{type:'TICK',hours:24}),/Test controls/);
  assert.throws(()=>command(lead.session,{type:'INGEST'}),/Test controls/);
});
test('strict commands reject client role changes, snapshot replacement, and forged signer fields',()=>{
  for(const action of [{type:'ROLE',role:'LEAD'},{type:'LOAD',state:{}},{type:'RESET'}])assert.equal(commandSchema.safeParse({requestId:randomUUID(),revision:1,action}).success,false);
  assert.equal(commandSchema.safeParse({requestId:randomUUID(),revision:1,action:{type:'CLOSE_CASE',id:'HQ-1003',closure:{kind:'EVIDENCE',outcome:'Done',evidenceRef:'RPT-X',plan:'Follow up',signedBy:'Fake clinician'}}}).success,false);
});
test('optimistic concurrency rejects stale saves and request IDs deduplicate retries',()=>{
  const revision=getSnapshot(patient.session).revision;const requestId=randomUUID();
  const action={type:'MESSAGE',id:'HQ-1003',thread:'PATIENT',text:'Idempotency test message',asPatient:true};
  command(patient.session,action,revision,requestId);command(patient.session,action,revision,requestId);
  assert.equal(getSnapshot(patient.session).patient?.messages.filter(m=>m.text==='Idempotency test message').length,1);
  assert.throws(()=>command(patient.session,{...action,text:'Another save'},revision),/record changed/);
  assert.throws(()=>command(patient.session,{...action,text:'Different payload'},revision,requestId),/different action/);
});
test('server rejects bypassed closure and unauthorized approval independently of screen',()=>{
  const c=getSnapshot(nav.session).state.cases.find(c=>c.id==='HQ-1003')!;
  assert.throws(()=>command(nav.session,{type:'CLOSE_CASE',id:c.id,closure:{kind:'EVIDENCE',outcome:'Complete',evidenceRef:'RPT-X',plan:'Follow up'}}),/account cannot/);
  assert.throws(()=>command(pcp.session,{type:'APPROVE_CLOSURE',id:c.id,approve:true,note:'Approve this case'}));
});
test('referral acceptance is a cross-account transition with authenticated actor attribution',()=>{
  const db=database();const c=JSON.parse((db.prepare('SELECT data FROM cases WHERE id=?').get('HQ-1003') as {data:string}).data) as Case;
  c.closure=undefined;c.referral={facility:'City Hospital — Gastroenterology',specialty:'Gastroenterology',priority:'SOON',note:'Synthetic referral',status:'SENT',sentAt:Date.now(),attempts:1};c.pathwayId='CRC_FIT';c.team.PCP=PEOPLE.pcp_mariam;delete c.team.SPECIALIST;
  db.prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify(c),c.id);
  command(specialist.session,{type:'REFERRAL_RESPOND',id:c.id,decision:'ACCEPT'});
  const accepted=getSnapshot(pcp.session).state.cases.find(x=>x.id===c.id)!;
  assert.equal(accepted.referral?.status,'ACCEPTED');assert.equal(accepted.team.SPECIALIST?.id,'sp_tariq');
  assert.ok(accepted.audit.some(e=>e.action==='The referral was accepted'&&e.actor===PEOPLE.sp_tariq.name));
  assert.throws(()=>command(specialist.session,{type:'REFERRAL_RESPOND',id:c.id,decision:'ACCEPT'}),/not assigned/);
});
test('the development setup fills the services table so the workspace directory comes from the database',()=>{
  const rows=database().prepare("SELECT facility,pathway,specialist_user_id FROM services WHERE network='halqa-network' AND disabled_at IS NULL").all() as {facility:string;pathway:string;specialist_user_id:string}[];
  assert.equal(rows.length,SPECIALIST_SERVICES.length);
  assert.deepEqual(getSnapshot(pcp.session).directory.services.map(s=>s.facility).sort(),SPECIALIST_SERVICES.map(s=>s.facility).sort());
  assert.equal(getSnapshot(pcp.session).directory.people.length,Object.keys(PEOPLE).length);
});
test('append-only audit rejects update/delete and records shared actions',()=>{
  const db=database();assert.ok((db.prepare('SELECT COUNT(*) AS count FROM events WHERE user_id=?').get(patient.session.user.id) as {count:number}).count>0);
  assert.throws(()=>db.prepare('DELETE FROM events').run(),/append-only/);
  assert.throws(()=>db.prepare("UPDATE events SET action='Forged'").run(),/append-only/);
});
test('HTTP routes enforce authentication, origin, CSRF, content validation and no-store',async()=>{
  assert.equal((await readWorkspace(request('/api/workspace'))).status,401);
  const authenticated=await readWorkspace(request('/api/workspace',patient.result.token));assert.equal(authenticated.status,200);assert.equal(authenticated.headers.get('cache-control'),'no-store');
  const rev=getSnapshot(patient.session).revision;const payload={requestId:randomUUID(),revision:rev,action:{type:'CALLBACK_REQUEST',id:'HQ-1003'}};
  assert.equal((await writeWorkspace(request('/api/workspace',patient.result.token,undefined,payload))).status,403);
  assert.equal((await writeWorkspace(request('/api/workspace',patient.result.token,patient.session.csrf,payload,'https://other.example'))).status,403);
  assert.equal((await writeWorkspace(request('/api/workspace',patient.result.token,patient.session.csrf,{...payload,action:{type:'ROLE',role:'LEAD'}}))).status,422);
  assert.equal((await writeWorkspace(request('/api/workspace',patient.result.token,patient.session.csrf,payload))).status,200);
});
test('HTTP login issues HttpOnly cookie and HTTP logout invalidates it',async()=>{
  const response=await signIn(request('/api/session',undefined,undefined,{email:'nav_reem@halqa.test',password}));
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie')??'',/HttpOnly/i);assert.match(response.headers.get('set-cookie')??'',/SameSite=strict/i);
  const body=await response.json();const token=response.cookies.get('halqa_session')!.value;
  const req=new NextRequest('http://localhost:3000/api/session',{method:'DELETE',headers:{origin:'http://localhost:3000',cookie:`halqa_session=${token}`,'x-halqa-csrf':body.csrf}});
  assert.equal((await signOut(req)).status,200);assert.equal(sessionFor(token),undefined);
});
test('unreleased patient results stay hidden and cannot be acknowledged early',()=>{
  const unreleased=account('patient_hq-1001').session;
  const snapshot=getSnapshot(unreleased);
  assert.equal(snapshot.patient?.released,false);assert.equal(snapshot.patient?.pathwayId,undefined);assert.deepEqual(snapshot.patient?.steps,[]);
  assert.throws(()=>command(unreleased,{type:'PATIENT_ACK',id:'HQ-1001',answers:{q1:'q1b',q2:'q2a'},confidence:5,lang:'en'}),/release the result/);
});
test('licensed exception request and governance approval preserve separate outcome',()=>{
  const id='HQ-1003';
  command(pcp.session,{type:'CLOSE_CASE',id,closure:{kind:'DECLINED_INFORMED',outcome:'Patient declined further investigation',evidenceRef:'NOTE-TEST-DECLINE',plan:'Recontact and safety-net plan recorded',justification:'Patient informed in preferred language and chose to decline further assessment.'}});
  assert.equal(getSnapshot(lead.session).state.cases.find(c=>c.id===id)?.closure?.status,'PENDING_APPROVAL');
  command(lead.session,{type:'APPROVE_CLOSURE',id,approve:true,note:'Reviewed discussion, preferences and safety-net plan.'});
  const c=getSnapshot(lead.session).state.cases.find(c=>c.id===id)!;
  assert.equal(c.closure?.kind,'DECLINED_INFORMED');assert.equal(c.closure?.signedById,'pcp_mariam');assert.equal(c.closure?.approvedById,'lead_fatima');
});
test('reading a snapshot does not write: revision and audit events are unchanged',()=>{
  const db=database();
  const revision=()=>(db.prepare("SELECT value FROM meta WHERE key='revision'").get() as {value:string}).value;
  const events=()=>(db.prepare('SELECT COUNT(*) AS n FROM events').get() as {n:number}).n;
  // Move the workspace clock 60 days on so escalations are due; a read must still not create them.
  const offset=Number((db.prepare("SELECT value FROM meta WHERE key='offset'").get() as {value:string}).value);
  db.prepare("UPDATE meta SET value=? WHERE key='offset'").run(String(offset+60*24*3600_000));
  const beforeRevision=revision();const beforeEvents=events();
  getSnapshot(nav.session);getSnapshot(lead.session);getSnapshot(patient.session);
  assert.equal(revision(),beforeRevision);assert.equal(events(),beforeEvents);
  // The worker path (refreshEscalations) is what writes them.
  refreshEscalations();
  assert.notEqual(revision(),beforeRevision);assert.ok(events()>beforeEvents);
  db.prepare("UPDATE meta SET value=? WHERE key='offset'").run(String(offset));
});
test('frame-blocking and content security headers on every route (next.config.js for JSON routes, src/proxy.ts for pages)',async()=>{
  const config=createRequire(import.meta.url)('../next.config.js') as {headers:()=>Promise<{source:string;headers:{key:string;value:string}[]}[]>};
  const rules=await config.headers();
  const all=rules.find(r=>r.source==='/:path*')!.headers;
  assert.equal(all.find(h=>h.key==='X-Frame-Options')?.value,'DENY');
  assert.equal(all.find(h=>h.key==='X-Content-Type-Options')?.value,'nosniff');
  assert.match(rules.find(r=>r.source==='/api/:path*')!.headers.find(h=>h.key==='Content-Security-Policy')?.value??'',/frame-ancestors 'none'/);
  // Every path that is not a JSON route or a built file passes through the proxy, which sets the page policy.
  const {proxy,config:proxyConfig}=await import('../src/proxy');
  const matcher=new RegExp(`^${proxyConfig.matcher[0].source}$`);
  for(const path of ['/','/anything','/case/HQ-1003']) assert.ok(matcher.test(path),path);
  for(const path of ['/api/session','/_next/static/chunks/x.js']) assert.ok(!matcher.test(path),path);
  assert.match(proxy(new NextRequest('http://localhost:3000/')).headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
});
