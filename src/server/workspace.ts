import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { State, Action, initialState, reducer } from '@/domain/state';
import { Case } from '@/types/halqa';
import { caseStatus, runEngine, isClosed, pathwayOf } from '@/lib/engine';
import { Snapshot, PatientSummary } from '@/shared/protocol';
import { HttpError, Session } from './auth';
import { canRead, authorize } from './permissions';
import { database, transaction } from './db';
import { commandSchema } from './schemas';
import { testControlsEnabled } from './test-controls';
import { loadDirectory, EMPTY_DIRECTORY } from './directory';
import { enqueueMessages, settleInstantlyForBrowserTests, settlesMessagesInstantlyForBrowserTests } from './outbox';
import { clockBucket, etagMatches, workspaceEtag } from './etag';

type CaseRow = { id: string; network: string; version: number; data: string };
const meta = (db: DatabaseSync, key: string, fallback='0') => String((db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value ?? fallback);
const setMeta = (db: DatabaseSync, key: string, value: string|number) => db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,String(value));
/** The workspace clock: real time plus the offset that only test controls can change. */
export const workspaceNow = (db: DatabaseSync) => Date.now() + Number(meta(db, 'offset'));
/** The current revision of the shared record. Every saved change to a case raises it. */
export const currentRevision = (db: DatabaseSync) => Number(meta(db,'revision'));

/**
 * Parsed cases of one network, kept between reads. The key is the
 * `cases_version` counter, which database triggers raise on every insert,
 * update or delete of a case row, by any connection or process and by any
 * statement (schema step 5), so a changed case is never served from here.
 * Only snapshots use it, never inside a write transaction. Readers must not
 * change the objects; the domain only ever copies them. The stored JSON text of
 * each case is kept too, so a response can reuse it instead of encoding again.
 *
 * When the counter moves, only rows whose `version` changed are read and parsed
 * again (a trigger raises `version` on every update, schema step 5), so one saved
 * change costs one parse, not one per case in the network.
 */
type NetworkCases = { key: string; cases: Case[]; text: Map<Case, string>; versions: Map<string, { version: number; c: Case }> };
const parsedCases = new WeakMap<DatabaseSync, Map<string, NetworkCases>>();
function networkCases(db: DatabaseSync, network: string): NetworkCases {
  const key=meta(db,'cases_version','none');
  let byNetwork=parsedCases.get(db);
  if(!byNetwork) { byNetwork=new Map(); parsedCases.set(db,byNetwork); }
  const cached=byNetwork.get(network);
  if(cached?.key===key) return cached;
  const rows=db.prepare('SELECT id,version FROM cases WHERE network=? ORDER BY id').all(network) as {id:string;version:number}[];
  const readOne=db.prepare('SELECT data,version FROM cases WHERE id=?');
  const text=new Map<Case,string>(); const versions=new Map<string,{version:number;c:Case}>(); const cases:Case[]=[];
  for(const row of rows) {
    const known=cached?.versions.get(row.id);
    let entry=known&&known.version===row.version?{version:known.version,c:known.c,data:cached!.text.get(known.c)!}:undefined;
    if(!entry) { const r=readOne.get(row.id) as {data:string;version:number}; entry={version:r.version,c:JSON.parse(r.data) as Case,data:r.data}; }
    cases.push(entry.c); text.set(entry.c,entry.data); versions.set(row.id,{version:entry.version,c:entry.c});
  }
  const fresh={key,cases,text,versions};
  byNetwork.set(network,fresh);
  return fresh;
}

/** Empty defaults avoid creating fictional data on reads of an uninitialised service. */
function stateOf(db: DatabaseSync, cases: Case[]): State {
  return {version:4, now:Date.now()+Number(meta(db,'offset')),cases,role:'NAVIGATOR',view:'command',selectedId:null,patientCaseId:'',toasts:[],playing:false,ingestSeq:Number(meta(db,'ingestSeq'))};
}
/** The cases of one network, freshly parsed (for writes, inside their transaction). */
function load(db: DatabaseSync, network: string): { state: State; revision: number } {
  const cases=(db.prepare('SELECT data FROM cases WHERE network=? ORDER BY id').all(network) as {data:string}[]).map(r=>JSON.parse(r.data) as Case);
  return {state:stateOf(db,cases),revision:currentRevision(db)};
}
export function persist(db: DatabaseSync, before: State, after: State, network: string, userId: string) {
  let changed=false;
  const previous=new Map(before.cases.map(c=>[c.id,c]));
  for(const c of after.cases) {
    const old=previous.get(c.id);
    // The domain returns the same object for an unchanged case, so most cases need no comparison.
    if(old===c||JSON.stringify(old)===JSON.stringify(c)) continue;
    changed=true;
    db.prepare('INSERT INTO cases(id,network,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=cases.version+1').run(c.id,network,JSON.stringify(c));
    for(const event of c.audit.slice(old?.audit.length??0)) db.prepare('INSERT INTO events(case_id,user_id,at,action,detail) VALUES(?,?,?,?,?)').run(c.id,userId,event.at,event.action,JSON.stringify(event));
  }
  if(changed) setMeta(db,'revision',Number(meta(db,'revision'))+1);
}
function patientView(c:Case,now:number):PatientSummary {
  const released=!!c.steps.NOTIFY?.completedAt;
  const status=caseStatus(c,now);
  return {
    id:c.id,name:c.patient.name,lang:c.patient.lang,released,pathwayId:released?c.pathwayId:undefined,reviewed:isClosed(c),
    needsInterpreter:!!c.patient.needsInterpreter,callbackPending:!!c.callbackRequestedAt&&!c.callbackDoneAt,understood:!!c.steps.ACK?.completedAt,
    next:released&&status.step?{label:status.step.label,owner:status.ownerName,dueAt:status.dueAt}:undefined,
    steps:released?pathwayOf(c).steps.map(s=>({id:s.id,label:s.label,completedAt:c.steps[s.id]?.completedAt})):[],
    appointment:released&&c.appointment&&c.steps.BOOK?.completedAt?{at:c.appointment.at,location:c.appointment.location}:undefined,
    canBook:released&&status.step?.id==='BOOK'&&c.referral?.status==='ACCEPTED',facility:released?c.referral?.facility:undefined,
    team:[c.team.NAVIGATOR,c.accountable,c.team.SPECIALIST].filter((p):p is NonNullable<typeof p>=>!!p).map(p=>({name:p.name,org:p.org})),
    messages:c.messages.filter(m=>m.thread==='PATIENT').map(m=>({id:m.id,from:m.from,patient:m.fromRole==='PATIENT',text:m.text,at:m.at})),
  };
}
function snapshotInside(db: DatabaseSync, session:Session, directory=loadDirectory(db,session.user.network)):Snapshot {
  const revision=currentRevision(db);
  const state=stateOf(db,networkCases(db,session.user.network).cases);
  const visible=state.cases.filter(c=>canRead(session.user,c,directory));
  const patient=session.user.person.role==='PATIENT';
  const role=session.user.person.role;
  return {state:{...state,cases:patient?[]:visible,actor:session.user.person,role,view:patient?'patient':role==='SPECIALIST'?'specialist':role==='LEAD'?'impact':'command',patientCaseId:visible[0]?.id??''},revision,directory:patient?EMPTY_DIRECTORY:directory,user:session.user,csrf:session.csrf,testControls:testControlsEnabled()&&role==='LEAD',patient:patient&&visible[0]?patientView(visible[0],state.now):undefined};
}
/**
 * Applies a change reported by a connected service (for example a delivery
 * report) to one case, inside the caller's transaction: runs the escalation
 * rules, writes audit events and bumps the revision so screens refresh.
 */
export function updateCaseFromService(db: DatabaseSync, caseId: string, userId: string, update: (c: Case, now: number) => Case) {
  const row=db.prepare('SELECT * FROM cases WHERE id=?').get(caseId) as CaseRow|undefined;
  if(!row) throw new HttpError(404,'Case not found.');
  const now=workspaceNow(db);
  const previous=JSON.parse(row.data) as Case;
  const changed=update(previous,now);
  if(changed===previous) return previous;
  const next=runEngine(changed,now,loadDirectory(db,row.network)).next;
  const base=emptyState(now);
  persist(db,{...base,cases:[previous]},{...base,cases:[next]},row.network,userId);
  return next;
}
function emptyState(now:number):State {
  return {version:4,now,cases:[],role:'NAVIGATOR',view:'command',selectedId:null,patientCaseId:'',toasts:[],playing:false,ingestSeq:0};
}
/**
 * Raises alerts that have come due. A first pass reads without holding the write
 * lock and finds the cases whose alerts would change; only those are re-read and
 * saved, in one short transaction, so screens and saves are not held up while
 * every case is checked. Each case is checked under its own network's directory.
 */
export function refreshEscalations() {
  const db=database();
  const now=workspaceNow(db);
  const directories=new Map<string,ReturnType<typeof loadDirectory>>();
  const directoryOf=(network:string)=>{ let d=directories.get(network); if(!d){ d=loadDirectory(db,network); directories.set(network,d); } return d; };
  const due=(db.prepare('SELECT id,network,data FROM cases').all() as {id:string;network:string;data:string}[])
    .filter(row=>{ const c=JSON.parse(row.data) as Case; return runEngine(c,now,directoryOf(row.network)).next!==c; })
    .map(row=>row.id);
  // Saved in small batches, each its own short transaction, so the write lock is never held for long
  // even when many alerts come due at once (for example after the worker was stopped for a while).
  for(let i=0;i<due.length;i+=ESCALATION_BATCH) saveEscalations(due.slice(i,i+ESCALATION_BATCH),directoryOf);
}
export const ESCALATION_BATCH=50;
function saveEscalations(ids:string[],directoryOf:(network:string)=>ReturnType<typeof loadDirectory>) {
  transaction(tx=>{
    const at=workspaceNow(tx);
    const base=emptyState(at);
    const byNetwork=new Map<string,{before:Case[];after:Case[]}>();
    for(const id of ids) {
      const row=tx.prepare('SELECT network,data FROM cases WHERE id=?').get(id) as {network:string;data:string}|undefined;
      if(!row) continue;
      const c=JSON.parse(row.data) as Case;
      const next=runEngine(c,at,directoryOf(row.network)).next;
      if(next===c) continue;
      const group=byNetwork.get(row.network)??{before:[],after:[]};
      group.before.push(c); group.after.push(next); byNetwork.set(row.network,group);
    }
    for(const [network,group] of byNetwork) persist(tx,{...base,cases:group.before},{...base,cases:group.after},network,'system');
  });
}
// Reads never write. Escalations are refreshed by the worker
// (scripts/worker.ts, every 15 seconds) and by every write through reducer -> runEngine.
export function getSnapshot(session:Session) { return snapshotInside(database(),session); }

/**
 * A conditional read of the workspace. The entity tag is worked out first from
 * the revision, the user, the network directory and the clock bucket; when it
 * matches If-None-Match the answer is "not modified" and no case is read at all.
 * Otherwise the snapshot is built and tagged with the revision it was built from.
 */
export function readWorkspace(session:Session, ifNoneMatch:string|null, now=Date.now()):{etag:string;snapshot?:Snapshot;body?:string} {
  const db=database();
  const directory=loadDirectory(db,session.user.network);
  const tag=(revision:number)=>workspaceEtag({revision,user:session.user,csrf:session.csrf,directory,testControls:testControlsEnabled()&&session.user.person.role==='LEAD',bucket:clockBucket(now)});
  const early=tag(currentRevision(db));
  if(etagMatches(ifNoneMatch,early)) return {etag:early};
  const snapshot=snapshotInside(db,session,directory);
  return {etag:tag(snapshot.revision),snapshot,body:snapshotText(db,session.user.network,snapshot)};
}

const CASES_SLOT='\u0000halqa-cases\u0000';
/**
 * The snapshot as JSON text. The cases are the exact JSON stored in the
 * database (the same text JSON.stringify would give for them), joined rather
 * than encoded again, so a large list costs a string join instead of an encode.
 */
export function snapshotText(db:DatabaseSync, network:string, snapshot:Snapshot):string {
  const {text}=networkCases(db,network);
  const stored=snapshot.state.cases.map(c=>text.get(c));
  if(!snapshot.state.cases.length||stored.some(t=>t===undefined)) return JSON.stringify(snapshot);
  const shell=JSON.stringify({...snapshot,state:{...snapshot.state,cases:CASES_SLOT}});
  return shell.replace(JSON.stringify(CASES_SLOT),()=>`[${stored.join(',')}]`);
}

/**
 * The domain refuses an action by throwing a plain Error with a sentence for the
 * user; that becomes 422. Anything else (a TypeError from a fault, for example)
 * is passed on unchanged so the user sees only the generic 500 sentence and no
 * internal detail.
 */
export function domainRefusal(error:unknown):unknown {
  return error instanceof Error&&error.constructor===Error?new HttpError(422,error.message):error;
}

export function execute(session:Session, payload:unknown):Snapshot {
  const parsed=commandSchema.safeParse(payload);
  if(!parsed.success) throw new HttpError(422,'Invalid action payload.');
  const command=parsed.data; const actor=session.user.person;
  const digest=createHash('sha256').update(JSON.stringify({revision:command.revision,action:command.action})).digest('hex');
  const key=`${session.user.id}:${command.requestId}`;
  transaction(db=>{
    const receipt=db.prepare('SELECT payload_hash FROM receipts WHERE id=?').get(key) as {payload_hash:string}|undefined;
    if(receipt) { if(receipt.payload_hash!==digest) throw new HttpError(409,'Request identifier was already used for a different action.'); return; }
    // Only the user's own network is loaded: a case of another network is simply not found.
    const {state,revision}=load(db,session.user.network);
    if(command.revision!==revision) throw new HttpError(409,'The shared record changed. Refresh and review before saving again.');
    const a=command.action as Action;
    // The directory always comes from the database; the domain's fallback is never used here.
    const directory=loadDirectory(db,session.user.network);
    const before:State={...state,actor,role:actor.role,directory};
    if(a.type==='TICK'||a.type==='INGEST') {
      if(actor.role!=='LEAD'||!testControlsEnabled()) throw new HttpError(403,'Test controls are disabled for this account.');
      if(a.type==='TICK') setMeta(db,'offset',Number(meta(db,'offset'))+a.hours*3600_000);
    } else {
      const c=state.cases.find(c=>c.id===(a as {id:string}).id);
      if(!c) throw new HttpError(404,'Case not found.');
      authorize(session.user,c,a,state.now,directory);
    }
    let after:State;
    try { after=reducer(before,a); } catch(error) { throw domainRefusal(error); }
    // Written messages wait in the outbox, inserted in this same transaction.
    const previous=new Map(before.cases.map(c=>[c.id,c]));
    after={...after,cases:after.cases.map(c=>{
      const old=previous.get(c.id);
      if(old===c) return c;
      const queued=enqueueMessages(db,old,c);
      return queued.length&&settlesMessagesInstantlyForBrowserTests()?settleInstantlyForBrowserTests(db,c,queued,state.now):c;
    })};
    // The test clock offset is workspace-global: it applies to every network in the file.
    persist(db,before,after,session.user.network,session.user.id);
    setMeta(db,'ingestSeq',after.ingestSeq);
    if(a.type==='TICK') setMeta(db,'revision',Number(meta(db,'revision'))+1);
    db.prepare('INSERT INTO receipts(id,user_id,payload_hash,created_at) VALUES (?,?,?,?)').run(key,session.user.id,digest,Date.now());
  });
  return getSnapshot(session);
}

export function seedWorkspace(db:DatabaseSync, network:string) {
  if(db.prepare('SELECT id FROM cases LIMIT 1').get()) throw new Error('Workspace already contains cases.');
  const seeded=initialState(); const delta=Date.now()-seeded.now;
  function shift(value:unknown):unknown {
    if(typeof value==='number'&&value>1_000_000_000_000) return value+delta;
    if(Array.isArray(value)) return value.map(shift);
    if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shift(v)]));
    return value;
  }
  for(const raw of seeded.cases) { const c=shift(raw) as Case; db.prepare('INSERT INTO cases(id,network,data) VALUES(?,?,?)').run(c.id,network,JSON.stringify(c)); }
  setMeta(db,'revision',1); setMeta(db,'offset',0); setMeta(db,'ingestSeq',0);
  db.prepare('INSERT INTO events(case_id,user_id,at,action,detail) VALUES(NULL,?,?,?,?)').run('bootstrap',Date.now(),'WORKSPACE_SEEDED',JSON.stringify({network,cases:seeded.cases.length}));
}
