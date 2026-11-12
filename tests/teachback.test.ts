import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { closeDatabases, database } from '../src/server/db';
import { createAccount } from '../src/server/accounts';
import { HttpError, login, Session, sessionFor } from '../src/server/auth';
import { execute, getSnapshot } from '../src/server/workspace';
import { receiveResult } from '../src/server/intake';
import { commandSchema } from '../src/server/schemas';
import { CORRECT_ANSWERS, scoreTeachBack, TEACH_BACK_KEYS } from '../src/domain/teachback';
import { Case } from '../src/types/halqa';

process.env.HALQA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'halqa-teachback-')), 'workspace.sqlite');
after(closeDatabases);

createAccount({ email: 'navigator@example.test', name: 'Navigator', role: 'NAVIGATOR', org: 'Hub' }, 'clinic', 'setup');
let seq = 0;
const caseOf = (id: string) => JSON.parse((database().prepare('SELECT data FROM cases WHERE id=?').get(id) as { data: string }).data) as Case;
/** A released case (the patient has been told) and a signed-in patient for it. */
function releasedCase(): { id: string; patient: Session } {
  seq++;
  const id = receiveResult({
    externalId: `teach-${seq}`, network: 'clinic',
    patient: { id: `person-${seq}`, name: `Person ${seq}`, age: 45, sex: 'F', phone: '+2348000000004', lang: 'en', preferredChannel: 'PHONE' },
    pathwayId: 'CRC_FIT', finding: 'Positive stool test', resultCode: 'FIT+', urgency: 'ROUTINE', sourceLab: 'Test lab', issuedAt: Date.now(),
  }).id;
  const c = caseOf(id);
  c.steps.NOTIFY = { completedAt: Date.now() - 1000, by: 'Navigator', note: 'Phoned' };
  database().prepare('UPDATE cases SET data=? WHERE id=?').run(JSON.stringify(c), id);
  const account = createAccount({ email: `patient-${seq}@example.test`, name: `Person ${seq}`, role: 'PATIENT', org: 'Patient portal', patientCase: id }, 'clinic', 'setup');
  return { id, patient: sessionFor(login(account.account.email, account.temporaryPassword).token)! };
}
const ack = (s: Session, action: Record<string, unknown>) => execute(s, { requestId: randomUUID(), revision: getSnapshot(s).revision, action: { type: 'PATIENT_ACK', lang: 'en', ...action } });
const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : 500; } };
const lowUnderstanding = (c: Case) => c.escalations.filter((e) => e.ruleId === 'R6_LOW_UNDERSTANDING' && !e.resolvedAt);

test('the correct answers are q1b and q2a and only shown keys can be scored', () => {
  assert.deepEqual(CORRECT_ANSWERS, { q1: 'q1b', q2: 'q2a' });
  assert.deepEqual(TEACH_BACK_KEYS, { q1: ['q1a', 'q1b', 'q1c'], q2: ['q2a', 'q2b', 'q2c'] });
  assert.deepEqual(scoreTeachBack({ q1: 'q1b', q2: 'q2a' }), { understoodQ1: true, understoodQ2: true });
  assert.deepEqual(scoreTeachBack({ q1: 'q1a', q2: 'q2a' }), { understoodQ1: false, understoodQ2: true });
  assert.deepEqual(scoreTeachBack({ q1: 'q1b', q2: 'q2c' }), { understoodQ1: true, understoodQ2: false });
  assert.throws(() => scoreTeachBack({ q1: 'q1d', q2: 'q2a' }));
  assert.throws(() => scoreTeachBack({ q1: 'q2a', q2: 'q1b' }));
});

test('all correct answers with enough confidence complete the check, scored on the server', () => {
  const { id, patient } = releasedCase();
  ack(patient, { id, answers: { q1: 'q1b', q2: 'q2a' }, confidence: 4 });
  const c = caseOf(id);
  assert.ok(c.steps.ACK?.completedAt);
  assert.equal(c.feedback?.understoodQ1, true);
  assert.equal(c.feedback?.understoodQ2, true);
  assert.equal(c.feedback?.confidence, 4);
  assert.deepEqual(lowUnderstanding(c), []);
  assert.equal(getSnapshot(patient).patient?.understood, true);
});

test('a wrong answer raises the low-understanding alert and leaves the step open', () => {
  const { id, patient } = releasedCase();
  ack(patient, { id, answers: { q1: 'q1a', q2: 'q2a' }, confidence: 5 });
  const c = caseOf(id);
  assert.equal(c.steps.ACK, undefined);
  assert.equal(c.feedback?.understoodQ1, false);
  assert.equal(c.feedback?.understoodQ2, true);
  assert.equal(lowUnderstanding(c).length, 1);
  assert.ok(c.delayReasons.some((d) => d.reason === 'LOW_UNDERSTANDING'));
});

test('low confidence with correct answers still raises the alert, as before', () => {
  const { id, patient } = releasedCase();
  ack(patient, { id, answers: { q1: 'q1b', q2: 'q2a' }, confidence: 2 });
  const c = caseOf(id);
  assert.equal(c.steps.ACK, undefined);
  assert.equal(lowUnderstanding(c).length, 1);
});

test('fabricated booleans, unknown keys and out-of-range confidence are refused', () => {
  const { id, patient } = releasedCase();
  const shape = (action: Record<string, unknown>) => commandSchema.safeParse({ requestId: randomUUID(), revision: 1, action: { type: 'PATIENT_ACK', id, lang: 'en', ...action } }).success;
  assert.equal(shape({ answers: { q1: 'q1b', q2: 'q2a' }, confidence: 3 }), true);
  for (const bad of [
    { q1: true, q2: true, confidence: 5 },
    { answers: { q1: 'q1b', q2: 'q2a' }, q1: true, q2: true, confidence: 5 },
    { answers: { q1: true, q2: true }, confidence: 5 },
    { answers: { q1: 'q1d', q2: 'q2a' }, confidence: 5 },
    { answers: { q1: 'q1b', q2: 'q1b' }, confidence: 5 },
    { answers: { q1: 'q1b' }, confidence: 5 },
    { answers: { q1: 'q1b', q2: 'q2a', q3: 'q3a' }, confidence: 5 },
    { answers: { q1: 'q1b', q2: 'q2a' }, confidence: 0 },
    { answers: { q1: 'q1b', q2: 'q2a' }, confidence: 6 },
    { answers: { q1: 'q1b', q2: 'q2a' }, confidence: 2.5 },
  ]) {
    assert.equal(shape(bad), false, JSON.stringify(bad));
    assert.equal(status(() => ack(patient, { id, ...bad })), 422, JSON.stringify(bad));
  }
  const c = caseOf(id);
  assert.equal(c.feedback, undefined, 'nothing was recorded');
  assert.equal(c.steps.ACK, undefined);
});
