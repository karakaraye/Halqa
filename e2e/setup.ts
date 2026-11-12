import {bootstrap} from '../src/server/bootstrap';
import {database,closeDatabases} from '../src/server/db';
import {PEOPLE,PATHWAYS} from '../src/lib/pathways';
import {Case} from '../src/types/halqa';
export default function setup(){
  process.env.HALQA_TEST_CONTROLS='1';
  bootstrap(process.env.HALQA_E2E_PASSWORD!);
  const db=database();
  const c=JSON.parse((db.prepare('SELECT data FROM cases WHERE id=?').get('HQ-1003') as {data:string}).data) as Case;
  c.team.PCP=PEOPLE.pcp_mariam;c.team.NAVIGATOR=PEOPLE.nav_reem;c.accountable=PEOPLE.pcp_mariam;c.team.SPECIALIST=undefined;
  c.pathwayId='CRC_FIT';c.finding='Positive faecal immunochemical test';c.resultCode='FIT+';c.referral=undefined;c.appointment=undefined;c.closure=undefined;c.escalations=[];c.messages=[];c.feedback=undefined;c.callbackRequestedAt=undefined;c.callbackDoneAt=undefined;
  c.steps={NOTIFY:{completedAt:Date.now()-1000,by:PEOPLE.nav_reem.name,note:'Telephone call completed'}};c.clockResets={};
  db.prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify(c),c.id);
  // A second ready-to-close case exercises the actual closure screen.
  const ready=JSON.parse((db.prepare('SELECT data FROM cases WHERE id=?').get('HQ-1009') as {data:string}).data) as Case;
  ready.team.PCP=PEOPLE.pcp_mariam;ready.accountable=PEOPLE.pcp_mariam;ready.closure=undefined;ready.escalations=[];
  for(const step of PATHWAYS[ready.pathwayId].steps)if(step.id!=='CLOSE')ready.steps[step.id]={completedAt:Date.now()-1000,by:PEOPLE.pcp_mariam.name,note:step.id==='OUTCOME'?'Benign assessment (report RPT-BROWSER-09)':step.id==='CARE_PLAN'?'Surveillance visit arranged':'Evidence recorded'};
  db.prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify(ready),ready.id);
  closeDatabases();
}
