// ─────────────────────────────────────────────────────────────
// Halqa domain model — one "Case" = one actionable screening result
// followed from issuance to documented closure.
// All times are epoch milliseconds on the simulation clock.
// ─────────────────────────────────────────────────────────────

export type Lang = 'en' | 'ar' | 'hi' | 'ur';

export type Role = 'NAVIGATOR' | 'PCP' | 'SPECIALIST' | 'LEAD' | 'PATIENT';

export type Urgency = 'CRITICAL' | 'ELEVATED' | 'ROUTINE';

export type PathwayId = 'CRC_FIT' | 'BREAST_BIRADS' | 'CERVICAL_HPV' | 'DIABETES_HBA1C';

export type StepId =
  | 'NOTIFY'        // patient informed of result
  | 'ACK'           // patient confirmed understanding (teach-back)
  | 'CONSULT'       // patient ↔ clinician consultation
  | 'CONFIRM_TEST'  // confirmatory test (e.g. repeat HbA1c)
  | 'REFER'         // referral sent to specialist service
  | 'ACCEPT'        // receiving service accepted the referral
  | 'BOOK'          // appointment booked
  | 'ATTEND'        // diagnostic appointment attended
  | 'OUTCOME'       // diagnostic / confirmatory result recorded
  | 'CARE_PLAN'     // treatment started or surveillance scheduled
  | 'CLOSE';        // documented, human-signed closure

export type Channel = 'SMS' | 'WHATSAPP' | 'APP' | 'PHONE' | 'PORTAL';

export interface Person {
  id: string;
  name: string;
  role: Role;
  org: string;
  licence?: string;
}

export interface StepRecord {
  completedAt?: number;
  by?: string;
  note?: string;
}

export interface Notification {
  at: number;
  channel: Channel;
  lang: Lang;
  status: 'DELIVERED' | 'READ' | 'FAILED' | 'NO_ANSWER' | 'REACHED';
  by: string;
}

export interface Referral {
  facility: string;
  specialty: string;
  priority: 'URGENT' | 'SOON' | 'ROUTINE';
  note: string;
  status: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'INFO_REQUESTED';
  sentAt: number;
  respondedAt?: number;
  rejectReason?: string;
  attempts: number;
}

export interface Appointment {
  at: number;
  location: string;
  bookedBy: string;
  dnaCount: number;
}

export interface Message {
  id: string;
  at: number;
  thread: 'ECONSULT' | 'PATIENT';
  from: string;
  fromRole: Role;
  text: string;
}

export interface Escalation {
  id: string;
  at: number;
  level: 1 | 2 | 3;
  ruleId: string;
  reason: string;
  to: string;
  stepId?: StepId;
  resolvedAt?: number;
  resolvedBy?: string;
  resolution?: string;
}

export interface PatientFeedback {
  at: number;
  understoodQ1: boolean;
  understoodQ2: boolean;
  confidence: number; // 1–5
  lang: Lang;
}

export type ClosureKind =
  | 'EVIDENCE'            // normal path: diagnostic evidence + plan documented
  | 'DECLINED_INFORMED'   // patient declined after documented informed discussion
  | 'CARE_ELSEWHERE'      // care completed at another provider with evidence
  | 'OUT_OF_SCOPE';       // moved out of jurisdiction / deceased, with handover

export interface Closure {
  kind: ClosureKind;
  outcome: string;            // e.g. "Benign", "Adenoma removed", "Cancer – treatment started"
  evidenceRef: string;        // e.g. histology report ID / FHIR DiagnosticReport id
  plan: string;               // treatment / surveillance / return to routine
  nextScreeningDue?: string;
  signedBy: string;           // clinician name
  signedLicence: string;
  signedAt: number;
  approvedBy?: string;        // second approver for exception closures
  approvedAt?: number;
  status: 'CLOSED' | 'PENDING_APPROVAL';
  justification?: string;
}

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
  detail?: string;
  system?: boolean;
}

export type DelayReason =
  | 'UNREACHABLE'
  | 'DNA'
  | 'REFERRAL_REJECTED'
  | 'CAPACITY'
  | 'PATIENT_DECLINED'
  | 'PATIENT_TRAVEL'
  | 'INFO_MISSING'
  | 'LOW_UNDERSTANDING';

export interface Case {
  id: string;
  patient: {
    id: string;
    name: string;
    age: number;
    sex: 'F' | 'M';
    phone: string;
    phoneReachable: boolean;
    lang: Lang;
    preferredChannel: Channel;
    needsInterpreter?: boolean;
    nationality?: string;
  };
  pathwayId: PathwayId;
  finding: string;
  resultCode: string;
  urgency: Urgency;
  sourceLab: string;
  issuedAt: number;

  team: Partial<Record<'NAVIGATOR' | 'PCP' | 'SPECIALIST', Person>>;
  accountable?: Person;           // one named clinician accountable end-to-end
  pendingTransfer?: { to: Person; requestedAt: number; requestedBy: string; reason: string };

  steps: Partial<Record<StepId, StepRecord>>;
  /** when the current step's clock last (re)started – set on DNA / referral rejection resets */
  clockResets: Partial<Record<StepId, number>>;

  notifications: Notification[];
  referral?: Referral;
  appointment?: Appointment;
  messages: Message[];
  escalations: Escalation[];
  feedback?: PatientFeedback;
  callbackRequestedAt?: number;
  callbackDoneAt?: number;
  delayReasons: { at: number; reason: DelayReason; note?: string }[];
  outcomeCategory?: 'NORMAL' | 'BENIGN' | 'PRECANCER' | 'DISEASE';
  closure?: Closure;
  audit: AuditEntry[];
  historical?: boolean; // generated background case for metrics
}

export interface Toast {
  id: string;
  at: number;
  tone: 'info' | 'warn' | 'danger' | 'success';
  text: string;
  caseId?: string;
}
