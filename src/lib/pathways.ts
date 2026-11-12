import { PathwayId, Role, StepId, Urgency, Person, Service } from '@/types/halqa';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface StepDef {
  id: StepId;
  label: string;
  ownerRole: Role;
  /** target hours from the previous milestone (ELEVATED baseline) */
  slaHours: number;
  hint: string;
}

export interface Pathway {
  id: PathwayId;
  name: string;
  short: string;
  program: string;
  specialty: string;
  diagnosticTest: string;
  /** clinical target from result to diagnostic test, days (ELEVATED) */
  targetDaysToDiagnosis: number;
  steps: StepDef[];
  color: string; // tailwind colour family
}

// SLA multipliers by urgency. CRITICAL cases get half the time, ROUTINE gets 1.5×.
export const URGENCY_FACTOR: Record<Urgency, number> = {
  CRITICAL: 0.5,
  ELEVATED: 1,
  ROUTINE: 1.5,
};

const S = (id: StepId, label: string, ownerRole: Role, slaHours: number, hint: string): StepDef => ({
  id, label, ownerRole, slaHours, hint,
});

// Default time targets. Each programme should replace them with its own
// agreed standards before use.
const referralSteps = (test: string, attendDays: number): StepDef[] => [
  S('NOTIFY', 'Patient notified', 'NAVIGATOR', 24, 'Result communicated in preferred language & channel'),
  S('ACK', 'Understanding confirmed', 'PATIENT', 48, 'Patient acknowledges + teach-back check'),
  S('CONSULT', 'Clinician consultation', 'PCP', 72, 'Tele / in-person consult to explain and agree plan'),
  S('REFER', 'Referral sent', 'PCP', 24, 'Structured referral packet sent to receiving service'),
  S('ACCEPT', 'Referral accepted', 'SPECIALIST', 48, 'Receiving service accepts custody (or rejects with reason)'),
  S('BOOK', 'Appointment booked', 'SPECIALIST', 72, 'Slot confirmed with patient (self-book or scheduler)'),
  S('ATTEND', `${test} performed`, 'PATIENT', attendDays * 24, 'Patient attends diagnostic appointment'),
  S('OUTCOME', 'Diagnostic result recorded', 'SPECIALIST', 7 * 24, 'Histology / diagnostic report filed'),
  S('CARE_PLAN', 'Treatment / surveillance started', 'SPECIALIST', 14 * 24, 'Treatment started or surveillance scheduled'),
  S('CLOSE', 'Loop closed & signed', 'PCP', 72, 'Accountable clinician signs closure with evidence'),
];

export const PATHWAYS: Record<PathwayId, Pathway> = {
  CRC_FIT: {
    id: 'CRC_FIT',
    name: 'Colorectal cancer screening — positive FIT',
    short: 'Bowel screening',
    program: 'Colorectal Screening Programme',
    specialty: 'Gastroenterology',
    diagnosticTest: 'Colonoscopy',
    targetDaysToDiagnosis: 30,
    steps: referralSteps('Colonoscopy', 14),
    color: 'amber',
  },
  BREAST_BIRADS: {
    id: 'BREAST_BIRADS',
    name: 'Breast cancer screening — BI-RADS 4/5 mammogram',
    short: 'Breast screening',
    program: 'Breast Screening Programme',
    specialty: 'Breast Imaging & Surgery',
    diagnosticTest: 'Core biopsy',
    targetDaysToDiagnosis: 14,
    steps: referralSteps('Core biopsy', 7),
    color: 'pink',
  },
  CERVICAL_HPV: {
    id: 'CERVICAL_HPV',
    name: 'Cervical screening — HPV 16/18 or high-grade cytology',
    short: 'Cervical screening',
    program: 'Cervical Screening Programme',
    specialty: 'Gynaecology (Colposcopy)',
    diagnosticTest: 'Colposcopy',
    targetDaysToDiagnosis: 28,
    steps: referralSteps('Colposcopy', 14),
    color: 'violet',
  },
  DIABETES_HBA1C: {
    id: 'DIABETES_HBA1C',
    name: 'Cardiometabolic screening — HbA1c in diabetes range',
    short: 'Diabetes check',
    program: 'Cardiometabolic Screening Programme',
    specialty: 'Endocrinology / Primary Care',
    diagnosticTest: 'Repeat HbA1c',
    targetDaysToDiagnosis: 14,
    steps: [
      S('NOTIFY', 'Patient notified', 'NAVIGATOR', 48, 'Result communicated in preferred language & channel'),
      S('ACK', 'Understanding confirmed', 'PATIENT', 72, 'Patient acknowledges + teach-back check'),
      S('CONFIRM_TEST', 'Confirmatory HbA1c done', 'PCP', 7 * 24, 'Repeat test to confirm diagnosis'),
      S('CONSULT', 'Clinician consultation', 'PCP', 5 * 24, 'Discuss confirmed result and plan'),
      S('CARE_PLAN', 'Treatment plan started', 'PCP', 7 * 24, 'Lifestyle / medication plan, education referral'),
      S('CLOSE', 'Loop closed & signed', 'PCP', 72, 'Accountable clinician signs closure with evidence'),
    ],
    color: 'sky',
  },
};

export const PATHWAY_LIST = Object.values(PATHWAYS);

export const ROLE_LABEL: Record<Role, string> = {
  NAVIGATOR: 'Care Navigator',
  PCP: 'Primary Care Physician',
  SPECIALIST: 'Specialist Service',
  LEAD: 'Clinical Governance Lead',
  PATIENT: 'Patient',
};

// ── Escalation ladder (transparent, human-governed) ──────────
export const ESCALATION_RULES = [
  {
    id: 'R1_OVERDUE',
    level: 1 as const,
    name: 'Step overdue',
    when: 'Current step passes its SLA',
    to: 'Step owner + Care Coordination Lead',
    action: 'Alert on worklist, push notification to owner',
  },
  {
    id: 'R2_OVERDUE_2X',
    level: 2 as const,
    name: 'Step seriously overdue',
    when: 'Step at 2× SLA, or any CRITICAL case overdue',
    to: 'Clinical Governance Lead',
    action: 'Clinical lead must review and record a decision',
  },
  {
    id: 'R3_UNASSIGNED',
    level: 1 as const,
    name: 'No owner',
    when: 'Current step has no accountable person for > 4h',
    to: 'Care Coordination Lead',
    action: 'Lead must assign an owner',
  },
  {
    id: 'R4_UNREACHABLE',
    level: 2 as const,
    name: 'Patient unreachable',
    when: '3 failed contact attempts or message delivery failure on a CRITICAL case',
    to: 'Clinical Governance Lead',
    action: 'Alternate contact routes (GP, next of kin, home visit) decided by a human',
  },
  {
    id: 'R5_REJECTED',
    level: 1 as const,
    name: 'Referral rejected',
    when: 'Receiving service rejects or requests more info',
    to: 'Referring PCP',
    action: 'Re-route or complete referral – case cannot silently drop',
  },
  {
    id: 'R6_LOW_UNDERSTANDING',
    level: 1 as const,
    name: 'Patient may not understand',
    when: 'Teach-back answer wrong or confidence ≤ 2/5',
    to: 'Care Navigator',
    action: 'Navigator call in patient language (interpreter if needed)',
  },
  {
    id: 'R7_DNA',
    level: 1 as const,
    name: 'Did not attend',
    when: 'Patient misses diagnostic appointment',
    to: 'Care Navigator + Specialist scheduler',
    action: 'Contact patient, capture reason, rebook; 2nd DNA → Level 2',
  },
];

// Staff and services of the local development workspace (npm run setup) and
// the fallback directory for domain unit tests. The server reads the real
// directory from the database.
export const PEOPLE: Record<string, Person> = {
  nav_reem: { id: 'nav_reem', name: 'Reem Al Hosani', role: 'NAVIGATOR', org: 'Preventive Screening Hub' },
  nav_joseph: { id: 'nav_joseph', name: 'Joseph Mathew', role: 'NAVIGATOR', org: 'Preventive Screening Hub' },
  pcp_mariam: { id: 'pcp_mariam', name: 'Dr. Mariam Al Zaabi', role: 'PCP', org: 'Al Bateen Healthcare Centre', licence: 'DOH-GP-20411' },
  pcp_arjun: { id: 'pcp_arjun', name: 'Dr. Arjun Menon', role: 'PCP', org: 'Mussafah Family Clinic', licence: 'DOH-GP-31877' },
  pcp_sara: { id: 'pcp_sara', name: 'Dr. Sara Haddad', role: 'PCP', org: 'Khalifa City Primary Care', licence: 'DOH-GP-27560' },
  sp_tariq: { id: 'sp_tariq', name: 'Dr. Tariq Al Nuaimi', role: 'SPECIALIST', org: 'City Hospital — Gastroenterology', licence: 'DOH-SP-90210' },
  sp_huda: { id: 'sp_huda', name: 'Dr. Huda Al Shamsi', role: 'SPECIALIST', org: 'Women’s Health Centre — Breast Unit', licence: 'DOH-SP-59210' },
  sp_lina: { id: 'sp_lina', name: 'Dr. Lina Farouk', role: 'SPECIALIST', org: 'Women’s Health Centre — Colposcopy', licence: 'DOH-SP-61733' },
  sp_khaled: { id: 'sp_khaled', name: 'Dr. Khaled Tammam', role: 'SPECIALIST', org: 'Diabetes & Endocrine Centre', licence: 'DOH-SP-44120' },
  lead_fatima: { id: 'lead_fatima', name: 'Dr. Fatima Al Kaabi', role: 'LEAD', org: 'Screening Programme Governance', licence: 'DOH-SP-10021' },
};

export const SPECIALIST_SERVICES: Service[] = [
  { facility: 'City Hospital — Gastroenterology', specialty: 'Gastroenterology', pathway: 'CRC_FIT', specialist: 'sp_tariq' },
  { facility: 'Regional Hospital — Endoscopy Unit', specialty: 'Gastroenterology', pathway: 'CRC_FIT', specialist: 'sp_tariq' },
  { facility: 'Women’s Health Centre — Breast Unit', specialty: 'Breast Imaging & Surgery', pathway: 'BREAST_BIRADS', specialist: 'sp_huda' },
  { facility: 'Women’s Health Centre — Colposcopy', specialty: 'Gynaecology (Colposcopy)', pathway: 'CERVICAL_HPV', specialist: 'sp_lina' },
  { facility: 'Diabetes & Endocrine Centre', specialty: 'Endocrinology', pathway: 'DIABETES_HBA1C', specialist: 'sp_khaled' },
];

export const REJECT_REASONS = [
  'Wrong service — redirect to another unit',
  'Insufficient clinical information',
  'Outside catchment area',
  'No capacity within target — suggest alternative site',
];

export const STAFF_BY_ROLE: Record<Exclude<Role, 'PATIENT'>, Person[]> = {
  NAVIGATOR: [PEOPLE.nav_reem, PEOPLE.nav_joseph],
  PCP: [PEOPLE.pcp_mariam, PEOPLE.pcp_arjun, PEOPLE.pcp_sara],
  SPECIALIST: [PEOPLE.sp_tariq, PEOPLE.sp_huda, PEOPLE.sp_lina, PEOPLE.sp_khaled],
  LEAD: [PEOPLE.lead_fatima],
};

/** Default person per role when the domain runs without a signed-in user. */
export const ACTING_AS: Record<Role, Person> = {
  NAVIGATOR: PEOPLE.nav_reem,
  PCP: PEOPLE.pcp_mariam,
  SPECIALIST: PEOPLE.sp_tariq,
  LEAD: PEOPLE.lead_fatima,
  PATIENT: { id: 'patient', name: 'Patient', role: 'PATIENT', org: 'Patient app' },
};
