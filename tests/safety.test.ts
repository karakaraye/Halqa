import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer } from '../src/domain/state';
import { computeMetrics, isClosed, runEngine } from '../src/lib/engine';
import { PATHWAYS, PEOPLE, DAY } from '../src/lib/pathways';
import { assertApproval, closureChecks } from '../src/domain/closure';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { bootstrap } from '../src/server/bootstrap';
import { closeDatabases } from '../src/server/db';
import { login, HttpError } from '../src/server/auth';

function fixture() {
  const state = initialState();
  const c = structuredClone(state.cases.find(c => !c.historical && !isClosed(c))!);
  c.closure = undefined; c.escalations = [];
  return { state: { ...state, cases: [c] }, c };
}
const evidence = { kind: 'EVIDENCE' as const, outcome: 'Assessment completed', evidenceRef: 'RPT-TEST-01', plan: 'Surveillance review arranged' };
const exception = { ...evidence, kind: 'DECLINED_INFORMED' as const, justification: 'Informed discussion completed and patient declined follow-up.' };

test('incomplete or unlicensed closure is rejected in the domain, independent of UI', () => {
  const { state, c } = fixture();
  assert.throws(() => reducer({ ...state, role: 'NAVIGATOR' }, { type: 'CLOSE_CASE', id: c.id, closure: { ...evidence, evidenceRef: '', plan: '' } }), /licence on file/);
  assert.throws(() => reducer({ ...state, role: 'PCP' }, { type: 'CLOSE_CASE', id: c.id, closure: evidence }), /Steps still to do/);
  assert.equal(c.closure, undefined);
});
test('complete clinician-signed pathway closes and UI uses the same validation', () => {
  const { state, c } = fixture();
  for (const step of PATHWAYS[c.pathwayId].steps) if (step.id !== 'CLOSE') c.steps[step.id] = { completedAt: state.now - 1000, by: PEOPLE.pcp_mariam.name, note: 'Test evidence' };
  assert.ok(closureChecks(c, PEOPLE.pcp_mariam, evidence).every(x => x.ok));
  const result = reducer({ ...state, actor: PEOPLE.pcp_mariam, role: 'PCP' }, { type: 'CLOSE_CASE', id: c.id, closure: evidence });
  assert.equal(isClosed(result.cases[0]), true);
  assert.equal(result.cases[0].closure?.signedById, PEOPLE.pcp_mariam.id);
  assert.equal(computeMetrics(result.cases, state.now).closedWithEvidencePct, 100);
});
test('generic step completion cannot bypass closure authorization', () => {
  const { state, c } = fixture();
  assert.throws(() => reducer(state, { type: 'COMPLETE_STEP', id: c.id, step: 'CLOSE', note: 'Bypass' }), /authorized closure/);
});
test('exception requires a qualified distinct approver and cannot be replayed', () => {
  const { state, c } = fixture();
  const pending = reducer({ ...state, actor: PEOPLE.pcp_mariam, role: 'PCP' }, { type: 'CLOSE_CASE', id: c.id, closure: exception });
  const approve = { type: 'APPROVE_CLOSURE' as const, id: c.id, approve: true, note: 'Reviewed informed discussion and follow-up plan' };
  assert.throws(() => reducer({ ...pending, actor: PEOPLE.nav_reem, role: 'NAVIGATOR' }, approve), /clinic lead/);
  assert.throws(() => assertApproval(pending.cases[0], { ...PEOPLE.pcp_mariam, role: 'LEAD' }, approve.note), /someone other than/);
  const result = reducer({ ...pending, actor: PEOPLE.lead_fatima, role: 'LEAD' }, approve);
  assert.equal(result.cases[0].closure?.status, 'CLOSED');
  assert.throws(() => reducer(result, approve), /No closure is waiting/);
});
test('rejecting a pending exception restores an open case', () => {
  const { state, c } = fixture();
  const pending = reducer({ ...state, actor: PEOPLE.pcp_mariam, role: 'PCP' }, { type: 'CLOSE_CASE', id: c.id, closure: exception });
  const result = reducer({ ...pending, actor: PEOPLE.lead_fatima, role: 'LEAD' }, { type: 'APPROVE_CLOSURE', id: c.id, approve: false, note: 'Please supply missing evidence' });
  assert.equal(result.cases[0].closure, undefined);
  assert.equal(isClosed(result.cases[0]), false);
});
test('pending closure approval continues clinical overdue escalation', () => {
  const { state, c } = fixture();
  const pending = reducer({ ...state, actor: PEOPLE.pcp_mariam, role: 'PCP' }, { type: 'CLOSE_CASE', id: c.id, closure: exception });
  const overdue = { ...pending.cases[0], steps: {}, escalations: [], issuedAt: state.now - 365 * DAY, clockResets: {} };
  assert.ok(runEngine(overdue, state.now).created.length > 0);
  assert.equal(runEngine({ ...overdue, closure: { ...overdue.closure!, status: 'CLOSED' } }, state.now).created.length, 0);
});
test('informed decline and placeholder licences never count as standard evidence closure', () => {
  const { state, c } = fixture();
  const pending = reducer({ ...state, actor: PEOPLE.pcp_mariam, role: 'PCP' }, { type: 'CLOSE_CASE', id: c.id, closure: exception });
  const result = reducer({ ...pending, actor: PEOPLE.lead_fatima, role: 'LEAD' }, { type: 'APPROVE_CLOSURE', id: c.id, approve: true, note: 'Informed decision reviewed' });
  assert.equal(computeMetrics(result.cases, state.now).closedWithEvidencePct, 0);
  result.cases[0].closure = { ...result.cases[0].closure!, kind: 'EVIDENCE', signedLicence: '—' };
  assert.equal(computeMetrics(result.cases, state.now).closedWithEvidencePct, 0);
});
test('pending approval has a separate visible deadline',()=>{
  const {state,c}=fixture();
  const pending=reducer({...state,actor:PEOPLE.pcp_mariam,role:'PCP'},{type:'CLOSE_CASE',id:c.id,closure:exception}).cases[0];
  const alerts=runEngine(pending,state.now+4*DAY).created;
  assert.ok(alerts.some(e=>e.ruleId==='R8_APPROVAL_OVERDUE'));
});

test('login lockout is per email and client address, so one client cannot lock out another', () => {
  process.env.HALQA_DB_PATH = resolve('data', `test-${randomUUID()}`, 'halqa.sqlite');
  const password = 'Synthetic-test-' + randomUUID();
  bootstrap(password);
  after(() => closeDatabases());
  const email = 'nav_reem@halqa.test';
  for (let i = 0; i < 8; i++) assert.throws(() => login(email, 'wrong', 'client-a'), (e: unknown) => e instanceof HttpError && e.status === 401);
  assert.throws(() => login(email, password, 'client-a'), (e: unknown) => e instanceof HttpError && e.status === 429);
  assert.ok(login(email, password, 'client-b').token);
});
