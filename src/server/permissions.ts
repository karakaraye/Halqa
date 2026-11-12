import { Case, Directory } from '@/types/halqa';
import { Action } from '@/domain/state';
import { answersFor, servicesAt, servicesFor, staffMember } from '@/domain/directory';
import { currentStep, isClosed } from '@/lib/engine';
import { HttpError, User } from './auth';

/** `directory` is always the database directory of the user's network (src/server/directory.ts). */
export function canRead(user: User, c: Case, directory: Directory) {
  const p = user.person;
  if (p.role === 'PATIENT') return user.patientCase === c.id;
  if (p.role === 'LEAD') return true;
  if (c.pendingTransfer?.to.id === p.id) return true;
  // Navigators of one hub share its queue so they can cover for each other.
  if (p.role === 'NAVIGATOR') return c.team.NAVIGATOR?.org === p.org;
  if (p.role === 'PCP') return c.team.PCP?.org === p.org || c.accountable?.id === p.id;
  return c.team.SPECIALIST?.id === p.id || answersFor(directory, c.referral?.facility, p.id);
}
export function authorize(user: User, c: Case, a: Action, now: number, directory: Directory) {
  if (!canRead(user,c,directory)) throw new HttpError(404, 'Case not found.');
  const p=user.person; const staff=p.role!=='PATIENT';
  const allow=(roles:string[]) => { if(!roles.includes(p.role)) throw new HttpError(403,'Your account cannot perform this action.'); };
  if(isClosed(c)) throw new HttpError(409,'This case is already closed.');
  switch(a.type) {
    case 'CLOSE_CASE': allow(['PCP','SPECIALIST']); break;
    case 'APPROVE_CLOSURE': allow(['LEAD']); break;
    case 'NOTIFY':
      allow(['NAVIGATOR','PCP']);
      if(a.channel!=='PHONE' && c.notifications.some(n=>n.status==='QUEUED'||n.status==='SENT')) throw new HttpError(409,'A message to this patient is already on its way. Wait for the delivery report or phone the patient.');
      break;
    case 'STAFF_ACK': case 'CALLBACK_DONE': allow(['NAVIGATOR','PCP']); break;
    case 'CALLBACK_REQUEST': allow(['PATIENT']); break;
    case 'PATIENT_ACK': allow(['PATIENT']); if(!c.steps.NOTIFY?.completedAt) throw new HttpError(409,'Your care team must release the result first.'); break;
    case 'INTERPRETER': allow(['PATIENT','NAVIGATOR','PCP']); break;
    case 'MESSAGE':
      if (!staff && (a.thread!=='PATIENT' || !a.asPatient)) throw new HttpError(403,'Patients can only message their care team.');
      if (staff && a.asPatient) throw new HttpError(403,'Staff cannot impersonate a patient.');
      if (a.thread==='ECONSULT') allow(['PCP','SPECIALIST','LEAD']);
      break;
    case 'COMPLETE_STEP':
      if(!['CONSULT','CONFIRM_TEST','ATTEND','OUTCOME','CARE_PLAN'].includes(a.step)) throw new HttpError(403,'Use the dedicated milestone action.');
      allow(a.step==='ATTEND'?['PCP','SPECIALIST','NAVIGATOR']:['PCP','SPECIALIST']);
      if(currentStep(c)?.id!==a.step) throw new HttpError(409,'Complete the prerequisite pathway steps first.');
      if(a.step==='ATTEND' && (!c.appointment || c.appointment.at>now)) throw new HttpError(409,'The appointment is not yet due.');
      if(a.note.trim().length<5) throw new HttpError(422,'Record supporting clinical details.');
      break;
    case 'SEND_REFERRAL':
      allow(['PCP']);
      if(currentStep(c)?.id!=='REFER' && !['REJECTED','INFO_REQUESTED'].includes(c.referral?.status??'')) throw new HttpError(409,'Referral is not ready to send.');
      if(!servicesFor(directory,c.pathwayId).some(s=>s.facility===a.facility)) throw new HttpError(422,'Choose a receiving service for this programme.');
      break;
    case 'REFERRAL_RESPOND':
      allow(['SPECIALIST']);
      if(c.referral?.status!=='SENT') throw new HttpError(403,'This referral is not assigned to your receiving service.');
      if(!servicesAt(directory,c.referral.facility).length) throw new HttpError(422,'This receiving service is no longer available.');
      if(!answersFor(directory,c.referral.facility,p.id)) throw new HttpError(403,'This referral is not assigned to your receiving service.');
      if(a.decision!=='ACCEPT' && !a.reason?.trim()) throw new HttpError(422,'Record a response reason.');
      break;
    case 'BOOK':
      allow(['NAVIGATOR','PCP','SPECIALIST','PATIENT']);
      if(a.byPatient !== (p.role==='PATIENT') && (a.byPatient || p.role==='PATIENT')) throw new HttpError(403,'Invalid booking identity.');
      if(c.referral?.status!=='ACCEPTED'||currentStep(c)?.id!=='BOOK'||a.at<=now||a.location!==c.referral.facility) throw new HttpError(409,'Book a future appointment at the accepted service.');
      break;
    case 'DNA': allow(['NAVIGATOR','PCP','SPECIALIST']); if(!c.steps.BOOK?.completedAt||!c.appointment||c.appointment.at>now) throw new HttpError(409,'The appointment is not yet due.'); break;
    case 'ASSIGN':
      allow(['NAVIGATOR','PCP','LEAD']);
      if(!staffMember(directory,a.personId,[a.role])) throw new HttpError(422,'That person is not in the staff list for this role.');
      if(a.role==='SPECIALIST') throw new HttpError(403,'Specialist responsibility requires referral acceptance.');
      if(a.role==='PCP' && c.accountable && c.accountable.id!==a.personId) throw new HttpError(409,'Use an accepted accountability transfer.');
      break;
    case 'REQUEST_TRANSFER':
      allow(['PCP','SPECIALIST','LEAD']);
      if(!staffMember(directory,a.personId,['PCP','SPECIALIST'])) throw new HttpError(422,'Choose a doctor or specialist from the staff list.');
      if(c.pendingTransfer) throw new HttpError(409,'Only one hand-over can wait for an answer at a time.');
      break;
    case 'TRANSFER_DECISION': if(c.pendingTransfer?.to.id!==p.id) throw new HttpError(403,'Only the requested recipient can decide the transfer.'); break;
    case 'RESOLVE_ESC': allow(['NAVIGATOR','PCP','SPECIALIST','LEAD']); if(!c.escalations.some(e=>e.id===a.escId&&!e.resolvedAt)) throw new HttpError(409,'No open escalation with that identifier.'); break;
    case 'DELAY': allow(['NAVIGATOR','PCP','SPECIALIST','LEAD']); break;
    default: throw new HttpError(403,'Unsupported action.');
  }
}
