# Halqa — Pitch Kit

## One-liner
**Halqa makes it impossible for an actionable screening result to quietly drop.** Every result gets a named owner, a clock, a next step the patient understands in their own language, and a signed closure.

## The problem (say this in 20 seconds)
Screening only saves lives if the abnormal result turns into care. Today the hand-offs between lab, GP, specialist and patient are where people get lost. Results sit unread, referrals are never accepted, appointments are missed, and nobody can say who owns the case. Patients wait anxious and confused. Ask a programme director “how many positive FITs from March are still unresolved, and who owns each one?” and the honest answer is usually *“we don’t know.”*

## The solution: one loop, five guarantees
1. **Every result is visible.** One case per actionable result, tracked from issuance to closure across all providers.
2. **Every step has an owner and a clock.** No orphan cases. Accountability only transfers when the receiver accepts (digital handshake).
3. **Every patient understands.** Privacy-safe message → plain-language explanation in Arabic, English, Hindi or Urdu → read-aloud → **teach-back check**. If the patient answers wrong or feels unsure, a nurse calls.
4. **Every referral is acknowledged.** Specialists must accept or reject *with a reason*. Rejections bounce back to the GP automatically.
5. **Every closure is evidenced.** No auto-close. A closure needs a diagnostic result, a plan, an evidence ID and a licensed clinician’s signature. Exceptions (patient declined, care elsewhere) need a second approver.

## 3-minute live demo script
Click **Judge demo walkthrough** (bottom-left) and press **Show me** on each step.

| # | Click | Say | Criterion |
|---|---|---|---|
| 1 | Step 1 | “A positive FIT just arrived. In seconds Halqa routed it to a navigator and an accountable GP. It’s CRITICAL, so the text message is held until a human calls.” Click **Called — patient reached**. | 1, 2, 5 |
| 2 | Step 2 | “Priya speaks Hindi. She gets a WhatsApp with no diagnosis in it, reads or listens to the explanation, then answers two teach-back questions.” Answer them and confirm, then point to the live care-team feed on the right. | 3 |
| 3 | Step 3 | “The specialist must accept custody, or reject with a reason.” Click **Accept custody**. | 4 |
| 4 | Step 4 | “When a referral is rejected it can’t vanish. It comes back to the GP with the reason, and re-routing is one click.” | 2, 4 |
| 5 | Step 5 | “Let’s jump a day ahead.” Escalation toasts appear. “Overdue cases climb a published ladder, and a human resolves every alert.” | 2, 5 |
| 6 | Step 6 | “Closure gate: six requirements, and only a licensed clinician can sign.” Click **Sign & close loop**. | 5 |
| 7 | Step 7 | “Exceptions such as a patient declining need two people.” Click **Approve**. | 5 |
| 8 | Step 8 | “And every measure in your brief is computed live from the case data.” | 6 |

**Close:** *“Halqa doesn’t replace your EHR or Malaffi. It sits on top through FHIR and makes sure the loop actually closes. Every result, every owner, every patient, closed with evidence.”*

## How we meet each judging criterion
| Criterion | Where to show it |
|---|---|
| 1. End-to-end case visibility | Command Centre pipeline + case journey timeline (11 milestones, time vs target per step) + FHIR export |
| 2. Ownership & timely progression | “Owner right now” column, Unassigned/Overdue/Returned queues, accountability handshake, per-step SLAs scaled by urgency |
| 3. Patient-centred communication | Patient App: 4 languages + RTL, read-aloud, teach-back, confidence score, interpreter request, call back, self-booking, “delivery tracker” journey |
| 4. Cross-provider consultation | Specialist Inbox (accept / reject with reason / request info), clinician e-consult thread, patient↔team messaging, structured referral packet |
| 5. Safe, human-governed escalation | Escalation ladder L1/L2, CRITICAL = phone-first rule, closure gate, two-person rule, append-only audit, “engine alerts, never acts” |
| 6. Closure & impact measures | Impact tab: time to notification / diagnostic / care, referral & attendance rates, documented closure, delay reasons, understanding & confidence, before/after |

## Why we win (differentiators)
- **Teach-back as a data point.** Patient understanding becomes a measurable, actionable signal rather than an assumption.
- **Custody, not messages.** Referrals and accountability move only by explicit acceptance, so nothing is ever “sent and forgotten”.
- **Delay reasons are structured at the source**, so programme leads can see *why* people drop off (DNA, unreachable, capacity, rejection) and fix the system.
- **Safe by design.** Automation routes and alerts. Humans decide. That matches how regulators think about AI and automation in care.
- **Standards-native.** Built on the FHIR R4 Task / ServiceRequest / Communication / Provenance model, so it plugs into HIE and EHR infrastructure.

## Likely judge questions
- **“Is this real data?”** No. It’s a simulated cohort of 68 cases on a simulated clock, and every number on the Impact tab is computed from it live. Baseline numbers are placeholders we would replace with programme audit data in a pilot.
- **“How does it integrate?”** It consumes DiagnosticReport results from the lab or HIE, writes Task/ServiceRequest/Appointment back, and exports a FHIR bundle per case (click FHIR in any case).
- **“What about AI?”** Deliberately rules-based for safety and explainability. Next step: an AI-drafted, clinician-approved plain-language explanation for unusual results, and no-show risk prediction to target navigator outreach. Both stay human-approved.
- **“Who pays / who uses it?”** Screening programme owners and payers (fewer late-stage diagnoses), provider networks (SLA compliance, quality metrics), navigators and clinicians (one worklist instead of phone, fax and spreadsheets).
- **“What if the patient has no smartphone?”** Phone-first navigator workflow, SMS with a reply-for-call-back option, and teach-back recorded by phone. The app is optional.
- **“Privacy?”** No diagnosis in SMS/WhatsApp, secure link only. Role-based actions, append-only audit trail, Provenance on closure.

## Pilot roadmap (if asked)
1. **Month 0–3:** one programme (colorectal FIT), 2 primary care centres + 1 endoscopy unit. Measure baseline vs Halqa.
2. **Month 3–6:** add breast and cervical, live FHIR integration, SMS/WhatsApp gateway, certified translations.
3. **Month 6–12:** network-wide rollout, programme-level dashboards, predictive outreach.

## Honest limitations (say them before the judges do)
Prototype with no authentication or backend. SLA targets are illustrative. Translations need certified medical review. Clinical pathways need local guideline sign-off.
