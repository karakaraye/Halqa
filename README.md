# Halqa (حَلْقَة) — Closing the Screening-to-Care Loop

Every actionable screening result is **communicated, understood, converted into timely care, owned at every step, and closed with evidence**, across labs, primary care, specialists and the patient.

> Prototype. All data is simulated; no real patient information.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Requires Node 18+.

### Optional: AI-drafted explanations

The case drawer can draft a result-specific patient explanation with Claude, which a licensed clinician must edit and approve before the patient sees it. To enable it, set an Anthropic API key on the server before starting:

```bash
export ANTHROPIC_API_KEY=your-key
```

On Vercel, add `ANTHROPIC_API_KEY` under Project Settings → Environment Variables. Step-by-step test instructions for teammates: [`docs/TEST-AI-DRAFT.md`](docs/TEST-AI-DRAFT.md). Without a key everything else works and the standard explanations stay in use. Only the result, pathway, language, age and sex are sent; no name, MRN or phone number.

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
| **AI-drafted explanation** (in the case drawer) | Claude drafts a plain-language explanation of *this* result in the patient's language, with an English back-translation and review notes for the clinician. A navigator can request a draft; only a licensed clinician can edit, approve and publish it. Every step is in the audit trail, and the patient app shows who reviewed it. Needs `ANTHROPIC_API_KEY`. |
| **Specialist Inbox** | Referrals must be **accepted** (custody confirmed) or **rejected with a reason**. Rejections bounce back to the GP automatically. Clinician-to-clinician e-consult questions. |
| **Patient App** | Phone mock-up in **English, Arabic, Hindi, Urdu** (RTL supported). Privacy-safe SMS, plain-language explanation, **read-aloud**, **teach-back** understanding check + confidence score, journey tracker, self-booking, call-back, interpreter request, messaging. |
| **Impact** | All measures from the brief computed live: time to notification / diagnostic / care, referral & appointment completion, documented closure, SLA compliance per step, delay & drop-off reasons, patient understanding & confidence. Compared against published usual-care figures, with sources cited on screen. CSV export. |
| **Governance** | Two-person approval for exception closures, network-wide open escalations, the published escalation ladder, configurable pathway SLAs. |

**Simulation bar** (dark strip): move the clock forward (+1h, +6h, +1d, +3d or Play) to watch SLAs expire and escalations fire. **Simulate incoming lab result** injects new results (first one is CRITICAL). **Import FHIR result** opens a case from a pasted or uploaded FHIR R4 Bundle (Patient + DiagnosticReport + optional Observation): it maps the LOINC code to a pathway, derives urgency, routes to a navigator and the patient's registered GP, and rejects non-final results and duplicate deliveries. Three sample bundles are built in. **Reset** restores the starting state. State is saved in the browser's localStorage.

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
  app/api/draft-explanation/route.ts   Server route: calls Claude for a draft explanation (structured output, no patient identifiers)
  lib/fhirIngest.ts       FHIR R4 Bundle import: validation, LOINC → pathway map, urgency rules, duplicate detection, sample bundles
  context/HalqaStore.tsx  Reducer with every action, simulation clock, persistence
  components/…            Views (CommandCentre, SpecialistInbox, PatientApp, ImpactDashboard, Governance, case/*)
```

The original v1 source is saved in `halqa-v1-backup.zip`.

## Important caveats
- SLA targets, urgency thresholds, the LOINC code map and outcome mixes are **illustrative defaults**. Replace them with programme / DoH standards.
- Baseline figures come from published studies of usual care in US health systems (Issaka 2017, Casalino 2009, Atlas 2023; cited on the Impact tab). They are not local programme data, and the Halqa side of the comparison is simulated.
- Translations are for demonstration. Clinical use requires certified medical translation and patient testing.
- The AI draft route has no authentication or rate limiting. On a public deployment anyone who finds it can spend your API credit; set a spend limit on the key or remove the key after judging.
- No authentication, and no backend beyond that one route. FHIR import and export run in the browser and show the target data contract; there is no live lab or HIE connection.
