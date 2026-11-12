import { z } from 'zod';
import { TEACH_BACK_KEYS } from '@/domain/teachback';
const id = z.string().min(1).max(100);
const note = z.string().trim().min(1).max(5000);
const role = z.enum(['NAVIGATOR', 'PCP', 'SPECIALIST']);
const step = z.enum(['NOTIFY','ACK','CONSULT','CONFIRM_TEST','REFER','ACCEPT','BOOK','ATTEND','OUTCOME','CARE_PLAN','CLOSE']);
const delay = z.enum(['UNREACHABLE','DNA','REFERRAL_REJECTED','CAPACITY','PATIENT_DECLINED','PATIENT_TRAVEL','INFO_MISSING','LOW_UNDERSTANDING']);
const action = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
export const actionSchema = z.discriminatedUnion('type', [
  action({type:z.literal('INGEST')}),
  action({type:z.literal('TICK'), hours:z.number().int().min(1).max(72)}),
  action({type:z.literal('NOTIFY'),id,channel:z.enum(['SMS','WHATSAPP','APP','PHONE','PORTAL']),phoneOutcome:z.enum(['REACHED','NO_ANSWER']).optional(),note:note.optional()}),
  // The keys of the answers the patient chose; the server scores them. Booleans are refused.
  action({type:z.literal('PATIENT_ACK'),id,answers:z.object({q1:z.enum(TEACH_BACK_KEYS.q1),q2:z.enum(TEACH_BACK_KEYS.q2)}).strict(),confidence:z.number().int().min(1).max(5),lang:z.enum(['en','ar','hi','ur'])}),
  action({type:z.literal('STAFF_ACK'),id,note}),
  action({type:z.literal('CALLBACK_REQUEST'),id}), action({type:z.literal('CALLBACK_DONE'),id,note}),
  action({type:z.literal('INTERPRETER'),id,on:z.boolean()}),
  action({type:z.literal('MESSAGE'),id,thread:z.enum(['ECONSULT','PATIENT']),text:note,asPatient:z.boolean().optional()}),
  action({type:z.literal('COMPLETE_STEP'),id,step,note,outcomeCategory:z.enum(['NORMAL','BENIGN','PRECANCER','DISEASE']).optional()}),
  action({type:z.literal('SEND_REFERRAL'),id,facility:id,priority:z.enum(['URGENT','SOON','ROUTINE']),note}),
  action({type:z.literal('REFERRAL_RESPOND'),id,decision:z.enum(['ACCEPT','REJECT','INFO']),reason:note.optional()}),
  action({type:z.literal('BOOK'),id,at:z.number().int().positive(),location:id,byPatient:z.boolean().optional()}),
  action({type:z.literal('DNA'),id,note}),
  action({type:z.literal('ASSIGN'),id,role,personId:id}),
  action({type:z.literal('REQUEST_TRANSFER'),id,personId:id,reason:note}),
  action({type:z.literal('TRANSFER_DECISION'),id,accept:z.boolean()}),
  action({type:z.literal('RESOLVE_ESC'),id,escId:id,note}),
  action({type:z.literal('CLOSE_CASE'),id,closure:z.object({kind:z.enum(['EVIDENCE','DECLINED_INFORMED','CARE_ELSEWHERE','OUT_OF_SCOPE']),outcome:note,evidenceRef:note,plan:note,nextScreeningDue:note.optional(),justification:note.optional()}).strict()}),
  action({type:z.literal('APPROVE_CLOSURE'),id,approve:z.boolean(),note}),
  action({type:z.literal('DELAY'),id,reason:delay,note:note.optional()}),
]);
export const commandSchema = z.object({ requestId:z.string().uuid(), revision:z.number().int().nonnegative(), action:actionSchema }).strict();
export const loginSchema = z.object({ email:z.string().email().max(254), password:z.string().min(1).max(200) }).strict();
