# Halqa (حَلْقَة) — Closing the Screening-to-Care Loop

Every actionable screening result is **communicated, understood, converted into timely care, owned at every step, and closed with evidence**, across labs, primary care, specialists and the patient.

> Prototype. All data is simulated; no real patient information.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Requires Node 18+.

For the smoothest live demo, use a production build (no compile delays):

```bash
npm run build
npm start
```

## What's in the demo

| Screen | What it shows |
|---|---|
| **Command Centre** | Every open actionable result, ranked by risk. Queues: *Needs action now, Overdue, Unassigned, Rejected/returned, Patient requests*. Pipeline shows where every result is. Click any row to open the case. |
| **Case drawer** | End-to-end journey (result → notify → understand → consult → refer → accept → book → diagnostic → result → care plan → closed) with time vs target per step, the current owner, the next action form, escalations, e-consult and patient messaging, closure gate, append-only audit trail, FHIR R4 export. |
| **Specialist Inbox** | Referrals must be **accepted** (custody confirmed) or **rejected with a reason**. Rejections bounce back to the GP automatically. Clinician-to-clinician e-consult questions. |
| **Patient App** | Phone mock-up in **English, Arabic, Hindi, Urdu** (RTL supported). Privacy-safe SMS, plain-language explanation, **read-aloud**, **teach-back** understanding check + confidence score, journey tracker, self-booking, call-back, interpreter request, messaging. |
| **Impact** | All measures from the brief computed live: time to notification / diagnostic / care, referral & appointment completion, documented closure, SLA compliance per step, delay & drop-off reasons, patient understanding & confidence. Before/after vs a (placeholder) baseline. CSV export. |
| **Governance** | Two-person approval for exception closures, network-wide open escalations, the published escalation ladder, configurable pathway SLAs. |

**Simulation bar** (dark strip): move the clock forward (+1h, +6h, +1d, +3d or Play) to watch SLAs expire and escalations fire. **Simulate incoming lab result** injects new results (first one is CRITICAL). **Reset** restores the starting state. State is saved in the browser's localStorage.

**Judge demo walkthrough** (bottom-left button): an 8-step guided script that drives the app for you.

## Code map

```
src/
  types/halqa.ts          Domain model (Case, steps, referral, escalation, closure…)
  lib/pathways.ts         4 screening pathways, SLA targets, escalation ladder, staff directory, baseline
  lib/engine.ts           State machine: current step, owner, SLA status, work items, rules engine, metrics
  lib/seed.ts             12 storytelling cases + 56 historical cases (seeded RNG) + incoming templates
  lib/i18n.ts             Patient content in EN / AR / HI / UR
  lib/fhir.ts             FHIR R4 Bundle export (Patient, DiagnosticReport, ServiceRequest, Task, Communication, Appointment, Provenance)
  context/HalqaStore.tsx  Reducer with every action, simulation clock, persistence
  components/…            Views (CommandCentre, SpecialistInbox, PatientApp, ImpactDashboard, Governance, case/*)
```

The original v1 source is saved in `halqa-v1-backup.zip`.

## Important caveats
- SLA targets, baseline figures and outcome mixes are **illustrative defaults**. Replace them with programme / DoH standards and audit data.
- Translations are for demonstration. Clinical use requires certified medical translation and patient testing.
- No authentication, backend or real integrations. The FHIR export shows the target data contract.
