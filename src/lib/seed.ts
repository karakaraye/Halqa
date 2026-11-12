// Records for trying the screens in local development and automated tests. Every person and
// result here is invented. Nothing in this file is loaded by `npm run setup`.
import { Case, Lang, PathwayId, Urgency, StepId, Channel, Person } from '@/types/halqa';
import { PATHWAYS, PEOPLE, HOUR, DAY, URGENCY_FACTOR, SPECIALIST_SERVICES } from './pathways';

// Reference time the seeded cases are written against (7 Nov 2026, 09:00 Gulf
// Standard Time). Loading them shifts every timestamp to the present.
export const SEED_START = Date.UTC(2026, 10, 7, 5, 0, 0);
const T = (hoursAgo: number) => SEED_START - hoursAgo * HOUR;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Base {
  id: string; name: string; age: number; sex: 'F' | 'M'; lang: Lang; channel: Channel; phone: string;
  reachable?: boolean; nationality?: string; interpreter?: boolean;
  pathwayId: PathwayId; finding: string; code: string; urgency: Urgency; lab: string; issuedHoursAgo: number;
  navigator?: Person; pcp?: Person; specialist?: Person;
}

function base(b: Base): Case {
  const issuedAt = T(b.issuedHoursAgo);
  return {
    id: b.id,
    patient: {
      id: `MRN-${b.id.slice(3)}7`, name: b.name, age: b.age, sex: b.sex, phone: b.phone, phoneReachable: b.reachable ?? true,
      lang: b.lang, preferredChannel: b.channel, needsInterpreter: b.interpreter, nationality: b.nationality,
    },
    pathwayId: b.pathwayId, finding: b.finding, resultCode: b.code, urgency: b.urgency, sourceLab: b.lab, issuedAt,
    team: { NAVIGATOR: b.navigator, PCP: b.pcp, SPECIALIST: b.specialist },
    accountable: b.pcp,
    steps: {}, clockResets: {}, notifications: [], messages: [], escalations: [], delayReasons: [],
    audit: [
      { at: issuedAt, actor: b.lab, action: 'Result received from the lab', detail: `${b.finding} · ${b.code}`, system: true },
      { at: issuedAt + 60_000, actor: 'Halqa', action: `Case opened: ${PATHWAYS[b.pathwayId].short}`, detail: b.pcp ? `Responsible doctor: ${b.pcp.name}` : 'No doctor on record. Someone must be assigned.', system: true },
    ],
  };
}

function done(c: Case, id: StepId, hoursAgo: number, by: string, note?: string, action?: string) {
  c.steps[id] = { completedAt: T(hoursAgo), by, note };
  c.audit.push({ at: T(hoursAgo), actor: by, action: action ?? `${PATHWAYS[c.pathwayId].steps.find((s) => s.id === id)?.label}`, detail: note });
}

function hand(): Case[] {
  const cases: Case[] = [];

  // 1. Urgent breast result; the patient has not answered the phone.
  {
    const c = base({
      id: 'HQ-1001', name: 'Aisha Al Mansoori', age: 52, sex: 'F', lang: 'ar', channel: 'PHONE', phone: '+971 50 *** 1182',
      reachable: false, pathwayId: 'BREAST_BIRADS', finding: 'Screening mammogram: BI-RADS 4C, right breast mass 14 mm', code: 'BI-RADS 4C',
      urgency: 'CRITICAL', lab: 'Preventive Screening Hub — Imaging', issuedHoursAgo: 9, navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_sara,
    });
    c.notifications.push({ at: T(7), channel: 'PHONE', lang: 'ar', status: 'NO_ANSWER', by: PEOPLE.nav_reem.name });
    c.audit.push({ at: T(7), actor: PEOPLE.nav_reem.name, action: 'Phone call not answered', detail: 'Urgent result: a person must phone before any message is sent' });
    c.delayReasons.push({ at: T(7), reason: 'UNREACHABLE' });
    cases.push(c);
  }

  // 2. Bowel referral waiting for the specialist to answer.
  {
    const c = base({
      id: 'HQ-1002', name: 'Sultan Al Mansoori', age: 58, sex: 'M', lang: 'ar', channel: 'WHATSAPP', phone: '+971 50 *** 4192',
      pathwayId: 'CRC_FIT', finding: 'Faecal immunochemical test positive: 212 µg Hb/g', code: 'FIT 212', urgency: 'ELEVATED',
      lab: 'National Reference Lab', issuedHoursAgo: 6 * 24, navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_mariam,
    });
    c.notifications.push({ at: T(6 * 24 - 2), channel: 'WHATSAPP', lang: 'ar', status: 'READ', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 6 * 24 - 2, 'Halqa messaging', 'WhatsApp (Arabic) delivered & read');
    c.feedback = { at: T(5 * 24), understoodQ1: true, understoodQ2: true, confidence: 4, lang: 'ar' };
    done(c, 'ACK', 5 * 24, 'Sultan Al Mansoori', '2 of 2 right, confidence 4 of 5', 'Patient confirmed understanding');
    done(c, 'CONSULT', 3 * 24, PEOPLE.pcp_mariam.name, 'Tele-consult 12 min. No alarm symptoms. Agreed colonoscopy.', 'Tele-consultation completed');
    c.referral = { facility: 'City Hospital — Gastroenterology', specialty: 'Gastroenterology', priority: 'SOON', note: 'FIT 212. No anticoagulants. Prefers Arabic-speaking team.', status: 'SENT', sentAt: T(30), attempts: 1 };
    done(c, 'REFER', 30, PEOPLE.pcp_mariam.name, 'Referral packet to City Hospital GI', 'Referral sent');
    cases.push(c);
  }

  // 3. Hindi-speaking patient who has been told and has not yet confirmed understanding.
  {
    const c = base({
      id: 'HQ-1003', name: 'Priya Nair', age: 41, sex: 'F', lang: 'hi', channel: 'WHATSAPP', phone: '+971 55 *** 3310', nationality: 'India',
      pathwayId: 'CERVICAL_HPV', finding: 'HPV 16 positive, cytology LSIL', code: 'HPV16+ / LSIL', urgency: 'ELEVATED',
      lab: 'National Reference Lab', issuedHoursAgo: 30, navigator: PEOPLE.nav_joseph, pcp: PEOPLE.pcp_arjun,
    });
    c.notifications.push({ at: T(28), channel: 'WHATSAPP', lang: 'hi', status: 'DELIVERED', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 28, 'Halqa messaging', 'WhatsApp (Hindi) delivered');
    cases.push(c);
  }

  // 4. Referral sent back to the referring doctor.
  {
    const c = base({
      id: 'HQ-1004', name: 'Muhammad Imran', age: 61, sex: 'M', lang: 'ur', channel: 'SMS', phone: '+971 52 *** 7781', nationality: 'Pakistan',
      pathwayId: 'CRC_FIT', finding: 'Faecal immunochemical test positive: 148 µg Hb/g', code: 'FIT 148', urgency: 'ROUTINE',
      lab: 'National Reference Lab', issuedHoursAgo: 9 * 24, navigator: PEOPLE.nav_joseph, pcp: PEOPLE.pcp_arjun,
    });
    c.notifications.push({ at: T(9 * 24 - 5), channel: 'SMS', lang: 'ur', status: 'DELIVERED', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 9 * 24 - 5, 'Halqa messaging', 'SMS (Urdu) delivered');
    c.feedback = { at: T(8 * 24), understoodQ1: true, understoodQ2: true, confidence: 4, lang: 'ur' };
    done(c, 'ACK', 8 * 24, 'Muhammad Imran', '2 of 2 right, confidence 4 of 5', 'Patient confirmed understanding');
    done(c, 'CONSULT', 6 * 24, PEOPLE.pcp_arjun.name, 'In-person consult with Urdu-speaking nurse.', 'Consultation completed');
    c.referral = { facility: 'City Hospital — Gastroenterology', specialty: 'Gastroenterology', priority: 'ROUTINE', note: 'FIT 148, lives in Al Dhafra.', status: 'REJECTED', sentAt: T(5 * 24), respondedAt: T(8), rejectReason: 'Outside catchment area', attempts: 1 };
    done(c, 'REFER', 5 * 24, PEOPLE.pcp_arjun.name, 'Referral to City Hospital GI', 'Referral sent');
    c.audit.push({ at: T(8), actor: PEOPLE.sp_tariq.name, action: 'Referral sent back', detail: 'Outside catchment area — suggest Regional Hospital Endoscopy Unit' });
    c.delayReasons.push({ at: T(8), reason: 'REFERRAL_REJECTED', note: 'Outside catchment area' });
    c.escalations.push({ id: 'esc_seed_4', at: T(8), level: 1, ruleId: 'R5_REJECTED', reason: 'Referral was sent back: Outside catchment area', to: PEOPLE.pcp_arjun.name, stepId: 'ACCEPT' });
    cases.push(c);
  }

  // 5. Diabetes result; the repeat test is late.
  {
    const c = base({
      id: 'HQ-1005', name: 'Omar Farooq', age: 49, sex: 'M', lang: 'en', channel: 'APP', phone: '+971 52 *** 1104',
      pathwayId: 'DIABETES_HBA1C', finding: 'HbA1c 8.9% (screening)', code: 'HbA1c 8.9%', urgency: 'ELEVATED',
      lab: 'Workplace Health Screening', issuedHoursAgo: 13 * 24, navigator: PEOPLE.nav_joseph, pcp: PEOPLE.pcp_sara,
    });
    c.notifications.push({ at: T(13 * 24 - 3), channel: 'APP', lang: 'en', status: 'READ', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 13 * 24 - 3, 'Halqa messaging', 'App push read');
    c.feedback = { at: T(12 * 24), understoodQ1: true, understoodQ2: true, confidence: 5, lang: 'en' };
    done(c, 'ACK', 12 * 24, 'Omar Farooq', '2 of 2 right, confidence 5 of 5', 'Patient confirmed understanding');
    c.delayReasons.push({ at: T(4 * 24), reason: 'PATIENT_TRAVEL', note: 'Travelling for work, back 9 Nov' });
    cases.push(c);
  }

  // 6. Breast result; the patient missed the biopsy and needs a new appointment.
  {
    const c = base({
      id: 'HQ-1006', name: 'Maria Santos', age: 55, sex: 'F', lang: 'en', channel: 'WHATSAPP', phone: '+971 56 *** 2209', nationality: 'Philippines',
      pathwayId: 'BREAST_BIRADS', finding: 'Screening mammogram: BI-RADS 4A, left breast calcifications', code: 'BI-RADS 4A', urgency: 'ELEVATED',
      lab: 'Preventive Screening Hub — Imaging', issuedHoursAgo: 12 * 24, navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_mariam, specialist: PEOPLE.sp_huda,
    });
    c.notifications.push({ at: T(12 * 24 - 4), channel: 'WHATSAPP', lang: 'en', status: 'READ', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 12 * 24 - 4, 'Halqa messaging', 'WhatsApp (English) read');
    c.feedback = { at: T(11 * 24), understoodQ1: true, understoodQ2: true, confidence: 3, lang: 'en' };
    done(c, 'ACK', 11 * 24, 'Maria Santos', '2 of 2 right, confidence 3 of 5', 'Patient confirmed understanding');
    done(c, 'CONSULT', 10 * 24, PEOPLE.pcp_mariam.name, 'Tele-consult. Anxious; reassured, written info sent.', 'Tele-consultation completed');
    c.referral = { facility: 'Women’s Health Centre — Breast Unit', specialty: 'Breast Imaging & Surgery', priority: 'SOON', note: 'BI-RADS 4A calcifications', status: 'ACCEPTED', sentAt: T(10 * 24 - 2), respondedAt: T(9 * 24), attempts: 1 };
    done(c, 'REFER', 10 * 24 - 2, PEOPLE.pcp_mariam.name, 'Referral to Breast Unit', 'Referral sent');
    done(c, 'ACCEPT', 9 * 24, PEOPLE.sp_huda.name, 'Accepted · stereotactic biopsy', 'Referral accepted');
    c.appointment = { at: T(2 * 24), location: 'Breast Unit, Room 4', bookedBy: 'Maria Santos', dnaCount: 1 };
    c.audit.push({ at: T(8 * 24), actor: 'Maria Santos', action: 'Patient booked the appointment', detail: 'Stereotactic biopsy' });
    c.audit.push({ at: T(2 * 24 - 2), actor: PEOPLE.sp_huda.name, action: 'Patient missed the appointment (1st time). A new appointment is needed.', detail: 'Patient reported a shift-work clash' });
    c.delayReasons.push({ at: T(2 * 24 - 2), reason: 'DNA', note: 'Shift-work clash' });
    c.clockResets.BOOK = T(2 * 24 - 2);
    c.escalations.push({ id: 'esc_seed_6', at: T(2 * 24 - 2), level: 1, ruleId: 'R7_DNA', reason: 'Patient missed the appointment (1st time)', to: PEOPLE.nav_reem.name, stepId: 'BOOK', resolvedAt: T(2 * 24 - 1), resolvedBy: PEOPLE.nav_reem.name, resolution: 'Called patient — prefers evening or Saturday slot' });
    cases.push(c);
  }

  // 7. Urgent bowel result with no doctor on record.
  {
    const c = base({
      id: 'HQ-1007', name: 'Khalid Al Dhaheri', age: 66, sex: 'M', lang: 'ar', channel: 'PHONE', phone: '+971 50 *** 6630',
      pathwayId: 'CRC_FIT', finding: 'FIT positive: 410 µg Hb/g with iron-deficiency anaemia (Hb 10.1)', code: 'FIT 410 + IDA', urgency: 'CRITICAL',
      lab: 'National Reference Lab', issuedHoursAgo: 40, navigator: PEOPLE.nav_reem,
    });
    c.notifications.push({ at: T(38), channel: 'PHONE', lang: 'ar', status: 'REACHED', by: PEOPLE.nav_reem.name });
    done(c, 'NOTIFY', 38, PEOPLE.nav_reem.name, 'Phone call in Arabic; result explained; SMS summary sent after call', 'Patient reached by phone');
    c.feedback = { at: T(37), understoodQ1: true, understoodQ2: true, confidence: 3, lang: 'ar' };
    done(c, 'ACK', 37, PEOPLE.nav_reem.name, 'Checked on the call, confidence 3 of 5', 'Understanding confirmed on a call');
    c.audit.push({ at: T(37), actor: 'Halqa', action: 'No doctor on record', detail: 'Recently moved from another emirate. Someone must be assigned.', system: true });
    cases.push(c);
  }

  // 8. Urgent breast result; biopsy done, histology awaited, question open between clinicians.
  {
    const c = base({
      id: 'HQ-1008', name: 'Noura Al Shamsi', age: 47, sex: 'F', lang: 'ar', channel: 'APP', phone: '+971 50 *** 9033',
      pathwayId: 'BREAST_BIRADS', finding: 'Screening mammogram: BI-RADS 5, left breast spiculated mass', code: 'BI-RADS 5', urgency: 'CRITICAL',
      lab: 'Preventive Screening Hub — Imaging', issuedHoursAgo: 8 * 24, navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_sara, specialist: PEOPLE.sp_huda,
    });
    c.notifications.push({ at: T(8 * 24 - 1), channel: 'PHONE', lang: 'ar', status: 'REACHED', by: PEOPLE.nav_reem.name });
    done(c, 'NOTIFY', 8 * 24 - 1, PEOPLE.nav_reem.name, 'Phone call in Arabic', 'Patient reached by phone');
    c.feedback = { at: T(8 * 24 - 1), understoodQ1: true, understoodQ2: true, confidence: 3, lang: 'ar' };
    done(c, 'ACK', 8 * 24 - 1, PEOPLE.nav_reem.name, 'Checked on the call, 2 of 2 right', 'Understanding confirmed on a call');
    done(c, 'CONSULT', 7 * 24, PEOPLE.pcp_sara.name, 'Same-day consult', 'Consultation completed');
    c.referral = { facility: 'Women’s Health Centre — Breast Unit', specialty: 'Breast Imaging & Surgery', priority: 'URGENT', note: 'BI-RADS 5 — 2-week pathway', status: 'ACCEPTED', sentAt: T(7 * 24 - 1), respondedAt: T(7 * 24 - 4 + 3), attempts: 1 };
    done(c, 'REFER', 7 * 24 - 1, PEOPLE.pcp_sara.name, 'Urgent referral to Breast Unit', 'Referral sent');
    done(c, 'ACCEPT', 7 * 24 - 4, PEOPLE.sp_huda.name, 'Accepted within 3h', 'Referral accepted');
    c.appointment = { at: T(3 * 24), location: 'Breast Unit, Room 2', bookedBy: 'Breast Unit scheduler', dnaCount: 0 };
    done(c, 'BOOK', 6 * 24, 'Breast Unit scheduler', 'Ultrasound-guided core biopsy', 'Appointment booked');
    done(c, 'ATTEND', 3 * 24, PEOPLE.sp_huda.name, 'US-guided core biopsy ×3 cores', 'Core biopsy performed');
    c.messages.push({ id: 'm8a', at: T(30), thread: 'ECONSULT', from: PEOPLE.pcp_sara.name, fromRole: 'PCP', text: 'Patient is anxious and asking when histology will be back. Any chance to expedite? She also asks if her sister should be screened.' });
    cases.push(c);
  }

  // 9. Cervical result; treatment done, ready to be signed off.
  {
    const c = base({
      id: 'HQ-1009', name: 'Lakshmi Iyer', age: 38, sex: 'F', lang: 'hi', channel: 'WHATSAPP', phone: '+971 55 *** 6402', nationality: 'India',
      pathwayId: 'CERVICAL_HPV', finding: 'HPV 18 positive, cytology HSIL', code: 'HPV18+ / HSIL', urgency: 'ELEVATED',
      lab: 'National Reference Lab', issuedHoursAgo: 34 * 24, navigator: PEOPLE.nav_joseph, pcp: PEOPLE.pcp_mariam, specialist: PEOPLE.sp_lina,
    });
    c.notifications.push({ at: T(34 * 24 - 3), channel: 'WHATSAPP', lang: 'hi', status: 'READ', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 34 * 24 - 3, 'Halqa messaging', 'WhatsApp (Hindi) read');
    c.feedback = { at: T(33 * 24), understoodQ1: true, understoodQ2: true, confidence: 4, lang: 'hi' };
    done(c, 'ACK', 33 * 24, 'Lakshmi Iyer', '2 of 2 right, confidence 4 of 5', 'Patient confirmed understanding');
    done(c, 'CONSULT', 31 * 24, PEOPLE.pcp_mariam.name, 'Tele-consult with Hindi interpreter', 'Tele-consultation completed');
    c.referral = { facility: 'Women’s Health Centre — Colposcopy', specialty: 'Gynaecology (Colposcopy)', priority: 'SOON', note: 'HSIL', status: 'ACCEPTED', sentAt: T(31 * 24 - 1), respondedAt: T(30 * 24), attempts: 1 };
    done(c, 'REFER', 31 * 24 - 1, PEOPLE.pcp_mariam.name, 'Referral to Colposcopy', 'Referral sent');
    done(c, 'ACCEPT', 30 * 24, PEOPLE.sp_lina.name, 'Accepted', 'Referral accepted');
    c.appointment = { at: T(20 * 24), location: 'Colposcopy Clinic', bookedBy: 'Lakshmi Iyer', dnaCount: 0 };
    done(c, 'BOOK', 29 * 24, 'Lakshmi Iyer', 'Self-booked in app', 'Appointment booked');
    done(c, 'ATTEND', 20 * 24, PEOPLE.sp_lina.name, 'Colposcopy + directed biopsy', 'Colposcopy performed');
    c.outcomeCategory = 'PRECANCER';
    done(c, 'OUTCOME', 15 * 24, PEOPLE.sp_lina.name, 'Histology CIN2 (report HIS-26-55120)', 'Diagnostic result recorded');
    done(c, 'CARE_PLAN', 6 * 24, PEOPLE.sp_lina.name, 'LLETZ performed; test-of-cure HPV at 6 months', 'Treatment completed / surveillance scheduled');
    c.messages.push({ id: 'm9a', at: T(5 * 24), thread: 'ECONSULT', from: PEOPLE.sp_lina.name, fromRole: 'SPECIALIST', text: 'LLETZ done, margins clear. Please arrange test-of-cure HPV in 6 months at primary care and close the loop.' });
    cases.push(c);
  }

  // 10. Diabetes result; the patient misunderstood and asked for a call.
  {
    const c = base({
      id: 'HQ-1010', name: 'Ahmed Hassan', age: 57, sex: 'M', lang: 'ar', channel: 'SMS', phone: '+971 50 *** 5521', nationality: 'Egypt',
      pathwayId: 'DIABETES_HBA1C', finding: 'HbA1c 10.2%, fasting glucose 212 mg/dL', code: 'HbA1c 10.2%', urgency: 'ELEVATED',
      lab: 'Workplace Health Screening', issuedHoursAgo: 50, navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_sara,
    });
    c.notifications.push({ at: T(49), channel: 'SMS', lang: 'ar', status: 'DELIVERED', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 49, 'Halqa messaging', 'SMS (Arabic) delivered');
    c.feedback = { at: T(5), understoodQ1: false, understoodQ2: true, confidence: 2, lang: 'ar' };
    c.callbackRequestedAt = T(5);
    c.audit.push({ at: T(5), actor: 'Ahmed Hassan', action: 'Patient answered the understanding check: 1 of 2 right, confidence 2 of 5', detail: 'Patient thought result meant he definitely has a serious disease' });
    c.escalations.push({ id: 'esc_seed_10', at: T(5), level: 1, ruleId: 'R6_LOW_UNDERSTANDING', reason: 'Patient may not have understood the result', to: PEOPLE.nav_reem.name, stepId: 'ACK' });
    c.delayReasons.push({ at: T(5), reason: 'LOW_UNDERSTANDING' });
    cases.push(c);
  }

  // 11. Bowel referral accepted; the patient can book.
  {
    const c = base({
      id: 'HQ-1011', name: 'John Peters', age: 63, sex: 'M', lang: 'en', channel: 'APP', phone: '+971 54 *** 8890', nationality: 'UK',
      pathwayId: 'CRC_FIT', finding: 'FIT positive: 130 µg Hb/g', code: 'FIT 130', urgency: 'ROUTINE',
      lab: 'National Reference Lab', issuedHoursAgo: 8 * 24, navigator: PEOPLE.nav_joseph, pcp: PEOPLE.pcp_arjun, specialist: PEOPLE.sp_tariq,
    });
    c.notifications.push({ at: T(8 * 24 - 1), channel: 'APP', lang: 'en', status: 'READ', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 8 * 24 - 1, 'Halqa messaging', 'App push read');
    c.feedback = { at: T(7 * 24 + 12), understoodQ1: true, understoodQ2: true, confidence: 5, lang: 'en' };
    done(c, 'ACK', 7 * 24 + 12, 'John Peters', '2 of 2 right, confidence 5 of 5', 'Patient confirmed understanding');
    done(c, 'CONSULT', 6 * 24, PEOPLE.pcp_arjun.name, 'E-consult questionnaire + phone review', 'Consultation completed');
    c.referral = { facility: 'City Hospital — Gastroenterology', specialty: 'Gastroenterology', priority: 'ROUTINE', note: 'FIT 130', status: 'ACCEPTED', sentAt: T(5 * 24), respondedAt: T(3 * 24), attempts: 1 };
    done(c, 'REFER', 5 * 24, PEOPLE.pcp_arjun.name, 'Referral to City Hospital GI', 'Referral sent');
    done(c, 'ACCEPT', 3 * 24, PEOPLE.sp_tariq.name, 'Accepted · bowel-prep pack posted', 'Referral accepted');
    cases.push(c);
  }

  // 12. Cervical result; the patient said no, early closure awaits a second approver.
  {
    const c = base({
      id: 'HQ-1012', name: 'Hessa Al Ameri', age: 44, sex: 'F', lang: 'ar', channel: 'APP', phone: '+971 50 *** 7740',
      pathwayId: 'CERVICAL_HPV', finding: 'HPV other high-risk positive, cytology ASC-US', code: 'hrHPV+ / ASC-US', urgency: 'ROUTINE',
      lab: 'National Reference Lab', issuedHoursAgo: 21 * 24, navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_mariam,
    });
    c.notifications.push({ at: T(21 * 24 - 2), channel: 'APP', lang: 'ar', status: 'READ', by: 'Halqa messaging' });
    done(c, 'NOTIFY', 21 * 24 - 2, 'Halqa messaging', 'App push (Arabic) read');
    c.feedback = { at: T(20 * 24), understoodQ1: true, understoodQ2: true, confidence: 4, lang: 'ar' };
    done(c, 'ACK', 20 * 24, 'Hessa Al Ameri', '2 of 2 right', 'Patient confirmed understanding');
    done(c, 'CONSULT', 17 * 24, PEOPLE.pcp_mariam.name, 'Two consults incl. female interpreter. Patient declines colposcopy for now; accepts repeat HPV in 12 months.', 'Consultation completed');
    c.delayReasons.push({ at: T(17 * 24), reason: 'PATIENT_DECLINED' });
    c.closure = {
      kind: 'DECLINED_INFORMED', outcome: 'Patient declined colposcopy after informed discussion', evidenceRef: 'Consent discussion note CN-26-1182',
      plan: 'Repeat HPV test in 12 months; navigator check-in at 3 months', nextScreeningDue: 'Nov 2027', signedBy: PEOPLE.pcp_mariam.name,
      signedLicence: PEOPLE.pcp_mariam.licence!, signedAt: T(20), status: 'PENDING_APPROVAL', justification: 'Capacity confirmed; risks explained in Arabic; written information given; patient may re-enter pathway any time.',
    };
    c.audit.push({ at: T(20), actor: PEOPLE.pcp_mariam.name, action: 'Asked to close early. A second person must approve.', detail: 'Declined after informed discussion' });
    cases.push(c);
  }

  return cases;
}

// Closed cases from earlier months, generated from a fixed seed so the
// measures have something to count.
const FIRST = ['Mohammed', 'Fatma', 'Ali', 'Mariam', 'Rashid', 'Shamma', 'Ravi', 'Anita', 'Imran', 'Sana', 'Jose', 'Grace', 'David', 'Layla', 'Yousef', 'Amna', 'Kiran', 'Bilal', 'Elena', 'Hamad'];
const LAST = ['Al Suwaidi', 'Al Marzouqi', 'Kumar', 'Qureshi', 'Reyes', 'Al Hammadi', 'Khan', 'Thomas', 'Al Falasi', 'Pillai', 'Haddad', 'Al Ketbi'];
const OUTCOMES: Record<PathwayId, { cat: Case['outcomeCategory']; outcome: string; plan: string; w: number }[]> = {
  CRC_FIT: [
    { cat: 'NORMAL', outcome: 'Normal colonoscopy', plan: 'Return to routine FIT screening in 2 years', w: 35 },
    { cat: 'BENIGN', outcome: 'Haemorrhoids / diverticulosis only', plan: 'Return to routine screening', w: 15 },
    { cat: 'PRECANCER', outcome: 'Adenomas removed (polypectomy)', plan: 'Surveillance colonoscopy in 3 years', w: 42 },
    { cat: 'DISEASE', outcome: 'Colorectal adenocarcinoma', plan: 'MDT review; surgery scheduled', w: 8 },
  ],
  BREAST_BIRADS: [
    { cat: 'BENIGN', outcome: 'Benign fibroadenoma', plan: 'Return to routine mammography', w: 60 },
    { cat: 'PRECANCER', outcome: 'Atypical ductal hyperplasia', plan: 'Surgical excision + annual imaging', w: 12 },
    { cat: 'DISEASE', outcome: 'Invasive ductal carcinoma', plan: 'MDT; neoadjuvant chemotherapy started', w: 28 },
  ],
  CERVICAL_HPV: [
    { cat: 'NORMAL', outcome: 'Normal colposcopy', plan: 'Repeat HPV in 12 months', w: 40 },
    { cat: 'PRECANCER', outcome: 'CIN2/3 treated by LLETZ', plan: 'Test of cure at 6 months', w: 52 },
    { cat: 'DISEASE', outcome: 'Early cervical carcinoma', plan: 'Gynae-oncology MDT; treatment started', w: 8 },
  ],
  DIABETES_HBA1C: [
    { cat: 'DISEASE', outcome: 'Type 2 diabetes confirmed', plan: 'Metformin + DSMES education; review 3 months', w: 78 },
    { cat: 'BENIGN', outcome: 'Prediabetes on repeat (HbA1c 6.1%)', plan: 'Lifestyle programme; repeat in 12 months', w: 22 },
  ],
};

function pick<T extends { w: number }>(r: () => number, xs: T[]): T {
  const tot = xs.reduce((s, x) => s + x.w, 0);
  let v = r() * tot;
  for (const x of xs) { v -= x.w; if (v <= 0) return x; }
  return xs[xs.length - 1];
}

function historical(n: number): Case[] {
  const r = mulberry32(20261107);
  const out: Case[] = [];
  const pathways: { id: PathwayId; w: number }[] = [
    { id: 'CRC_FIT', w: 38 }, { id: 'BREAST_BIRADS', w: 22 }, { id: 'CERVICAL_HPV', w: 18 }, { id: 'DIABETES_HBA1C', w: 22 },
  ];
  const langs: Lang[] = ['ar', 'ar', 'en', 'en', 'hi', 'ur', 'ar', 'en'];
  const navs = [PEOPLE.nav_reem, PEOPLE.nav_joseph];
  const pcps = [PEOPLE.pcp_mariam, PEOPLE.pcp_arjun, PEOPLE.pcp_sara];

  for (let i = 0; i < n; i++) {
    const pid = pick(r, pathways).id;
    const p = PATHWAYS[pid];
    const urgency: Urgency = r() < 0.2 ? 'CRITICAL' : r() < 0.65 ? 'ELEVATED' : 'ROUTINE';
    const sex: 'F' | 'M' = pid === 'BREAST_BIRADS' || pid === 'CERVICAL_HPV' ? 'F' : r() < 0.5 ? 'F' : 'M';
    const lang = langs[Math.floor(r() * langs.length)];
    const svc = SPECIALIST_SERVICES.find((s) => s.pathway === pid)!;
    const specialist = PEOPLE[svc.specialist];
    const pcp = pcps[Math.floor(r() * pcps.length)];
    const nav = navs[Math.floor(r() * navs.length)];
    const id = `HQ-0${(700 + i).toString()}`;
    const c: Case = {
      id,
      patient: { id: `MRN-0${700 + i}3`, name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`, age: 40 + Math.floor(r() * 30), sex, phone: '+971 5* *** ****', phoneReachable: true, lang, preferredChannel: r() < 0.5 ? 'WHATSAPP' : 'APP' },
      pathwayId: pid, finding: p.short, resultCode: p.short, urgency, sourceLab: 'National Reference Lab', issuedAt: 0,
      team: { NAVIGATOR: nav, PCP: pcp, SPECIALIST: pid === 'DIABETES_HBA1C' ? undefined : specialist },
      accountable: pcp, steps: {}, clockResets: {}, notifications: [], messages: [], escalations: [], delayReasons: [], audit: [], historical: true,
    };
    // Step durations as offsets from the issue time, mostly inside the target.
    let t = 0;
    const offsets: Partial<Record<StepId, number>> = {};
    const breaches: StepId[] = [];
    for (const s of p.steps) {
      const sla = s.slaHours * URGENCY_FACTOR[urgency] * HOUR;
      let dur = sla * (0.15 + r() * 0.8);
      if (r() < 0.12) { dur = sla * (1.1 + r() * 0.9); breaches.push(s.id); }
      if (s.id === 'ATTEND' && r() < 0.1) { dur += 7 * DAY; c.delayReasons.push({ at: 0, reason: 'DNA' }); }
      if (s.id === 'ACCEPT' && r() < 0.08) { dur += 2 * DAY; c.delayReasons.push({ at: 0, reason: 'REFERRAL_REJECTED' }); }
      if (s.id === 'NOTIFY' && r() < 0.08) c.delayReasons.push({ at: 0, reason: 'UNREACHABLE' });
      if (s.id === 'BOOK' && r() < 0.08) c.delayReasons.push({ at: 0, reason: 'CAPACITY' });
      t += dur;
      offsets[s.id] = t;
    }
    const issuedAt = SEED_START - t - (2 + r() * 110) * DAY;
    c.issuedAt = issuedAt;
    for (const s of p.steps) c.steps[s.id] = { completedAt: issuedAt + offsets[s.id]!, by: 'historical' };
    c.delayReasons = c.delayReasons.map((d) => ({ ...d, at: issuedAt }));
    if (c.delayReasons.some((d) => d.reason === 'DNA')) c.appointment = { at: issuedAt + offsets.ATTEND!, location: '—', bookedBy: '—', dnaCount: 1 };
    else if (pid !== 'DIABETES_HBA1C') c.appointment = { at: issuedAt + offsets.ATTEND!, location: '—', bookedBy: '—', dnaCount: 0 };
    if (pid !== 'DIABETES_HBA1C') c.referral = { facility: svc.facility, specialty: svc.specialty, priority: 'SOON', note: '', status: 'ACCEPTED', sentAt: issuedAt + offsets.REFER!, respondedAt: issuedAt + offsets.ACCEPT!, attempts: 1 };
    c.notifications.push({ at: issuedAt + offsets.NOTIFY!, channel: c.patient.preferredChannel, lang, status: 'READ', by: 'Halqa messaging' });
    const q1 = r() < 0.9, q2 = r() < 0.9;
    c.feedback = { at: issuedAt + offsets.ACK!, understoodQ1: q1, understoodQ2: q2, confidence: Math.min(5, Math.max(1, Math.round(3.4 + r() * 1.8 - (q1 && q2 ? 0 : 1.2)))), lang };
    for (const b of breaches) {
      const at = issuedAt + offsets[b]! - HOUR * 2;
      c.escalations.push({ id: `esc_h_${i}_${b}`, at, level: 1, ruleId: 'R1_OVERDUE', reason: 'A step was late', to: 'Care coordination lead', stepId: b, resolvedAt: at + (1 + r() * 18) * HOUR, resolvedBy: nav.name, resolution: 'Actioned' });
    }
    const o = pick(r, OUTCOMES[pid]);
    c.outcomeCategory = o.cat;
    const closedAt = issuedAt + offsets.CLOSE!;
    c.closure = { kind: 'EVIDENCE', outcome: o.outcome, evidenceRef: `RPT-${(55000 + i * 7).toString()}`, plan: o.plan, signedBy: pcp.name, signedLicence: pcp.licence!, signedAt: closedAt, status: 'CLOSED' };
    c.audit.push({ at: issuedAt, actor: 'Lab', action: 'Result received', system: true }, { at: closedAt, actor: pcp.name, action: 'Case closed and signed', detail: o.outcome });
    out.push(c);
  }
  return out;
}

export function seedCases(): Case[] {
  return [...hand(), ...historical(56)];
}

// Results fed in by the simulation control (INGEST).
export const INCOMING_TEMPLATES: Omit<Base, 'id' | 'issuedHoursAgo'>[] = [
  {
    name: 'Zayed Al Dhaheri', age: 59, sex: 'M', lang: 'ar', channel: 'PHONE', phone: '+971 50 *** 7721', pathwayId: 'CRC_FIT',
    finding: 'FIT positive: 296 µg Hb/g', code: 'FIT 296', urgency: 'CRITICAL', lab: 'National Reference Lab', navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_mariam,
  },
  {
    name: 'Grace Okafor', age: 48, sex: 'F', lang: 'en', channel: 'WHATSAPP', phone: '+971 56 *** 4410', nationality: 'Nigeria', pathwayId: 'BREAST_BIRADS',
    finding: 'Screening mammogram: BI-RADS 4B, right breast', code: 'BI-RADS 4B', urgency: 'ELEVATED', lab: 'Preventive Screening Hub — Imaging', navigator: PEOPLE.nav_joseph, pcp: PEOPLE.pcp_sara,
  },
  {
    name: 'Rajesh Kumar', age: 52, sex: 'M', lang: 'hi', channel: 'WHATSAPP', phone: '+971 55 *** 9902', nationality: 'India', pathwayId: 'DIABETES_HBA1C',
    finding: 'HbA1c 7.4% (workplace screening)', code: 'HbA1c 7.4%', urgency: 'ROUTINE', lab: 'Workplace Health Screening', navigator: PEOPLE.nav_joseph, pcp: PEOPLE.pcp_arjun,
  },
  {
    name: 'Ayesha Siddiqui', age: 36, sex: 'F', lang: 'ur', channel: 'SMS', phone: '+971 52 *** 3307', nationality: 'Pakistan', pathwayId: 'CERVICAL_HPV',
    finding: 'HPV 16 positive, cytology ASC-H', code: 'HPV16+ / ASC-H', urgency: 'ELEVATED', lab: 'National Reference Lab', navigator: PEOPLE.nav_reem, pcp: PEOPLE.pcp_arjun, interpreter: true,
  },
];

export function makeIncoming(templateIdx: number, now: number, seq: number): Case {
  const t = INCOMING_TEMPLATES[templateIdx % INCOMING_TEMPLATES.length];
  const c = base({ ...t, id: `HQ-${1100 + seq}`, issuedHoursAgo: 0 });
  // Move the timestamps to the workspace clock.
  const shift = now - c.issuedAt;
  c.issuedAt = now;
  c.audit = c.audit.map((a) => ({ ...a, at: a.at + shift }));
  return c;
}
