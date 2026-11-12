# Halqa (حَلْقَة) — closing the screening-to-care loop

Halqa makes sure a screening result turns into care. Every actionable result becomes one case with a named owner, a clock, a next step the patient understands in their own language, and a closure that a licensed clinician signs with evidence.

## Project status

The software is complete for a first release and verified. What remains before real patients are served is the list of people-and-contract tasks in **`docs/go-live-checklist.md`**: clinical approval of the care pathways, certified translations, a message provider, a result-intake agreement with the laboratory, privacy and legal review, hosting and backups, independent security and accessibility checks, usability testing and a pilot agreement.

Verification on the release tree (13 November 2026, from a clean `npm ci`; dated records and the design comparison are in `VERIFICATION.md`):

| Check | Result |
|---|---|
| `npm run typecheck` | passes, no errors |
| `npm run lint` | passes, no errors or warnings |
| `npm test` | 117 of 117 unit, security and operations tests pass |
| `npm run secrets-scan` | no findings |
| `npm run build` | passes |
| `npm run test:e2e` | 32 of 32 browser tests pass, in two runs |
| `npm audit --omit=dev` | 0 vulnerabilities; the 7 moderate findings in development tooling are explained in `docs/security.md` |
| Load check (`npm run load-check`, 5 minutes, 50 clients, 2,000 open cases) | p95 140 ms, 0 errors (development machine) |

Passing tests prove only what they exercise. Nothing here is a clinical validation, a penetration test or an accessibility audit.

## What it does

- **My work** (navigator, doctor): every open case ranked by what needs attention, with one clear next step.
- **Case page**: the next step and who owns it, patient summary, interpreter requests, delay tracking ("Something is slowing this down"), history of the case, messages with the patient and between clinicians, decisions that need a person, hand-over of a patient, and closing a case against real clinical rules.
- **Referrals** (specialist): accept, ask for more information, or send back with guidance. Sent-back referrals return to the referring doctor.
- **Overview**: measured figures: time to tell patients, tests on time, cases fully finished, understanding, and where patients get stuck.
- **Approvals** (clinic lead): a second person must approve any exception case closed without a test result.
- **Accounts** (clinic lead): manage staff accounts, create users with one-time temporary passwords, enforce password change on first sign-in, and disable accounts.
- **Patient portal** (phone): the patient's own result in plain language (English, Arabic, Hindi, Urdu; right-to-left supported), quick understanding check with confidence rating, care steps, booking, `.ics` calendar generation, call-back and interpreter requests, and messages.

The system alerts people and never completes a clinical step or closes a case by itself.

## Requirements

- Node.js 24 or later (the backend uses Node's built-in SQLite module).
- One server with a writable, durable disk. The database is a single SQLite file.

## First-time setup and running

```sh
npm ci
npm run setup -- --email you@yourclinic.org --name "Your Name" --org "Your Organisation"
npm run dev        # development server and worker on http://localhost:3000
```

`setup` creates the database and the first clinic lead only: no cases and no other accounts. It prints a temporary password once (nothing is written to disk but the database) and refuses to run if any account exists. The lead chooses a new password at first sign-in and adds everyone else from the Accounts screen or with `npm run user:create`.

To try the screens with local development records, use a throwaway database: `npm run seed:local`. It prints the accounts and their temporary password once, and refuses to run when `NODE_ENV=production` or `HALQA_ORIGIN` is an https address.

Production build:

```sh
npm run build
npm start
```

On Windows, **Start Halqa.cmd** starts the app and worker when `data\halqa.sqlite` exists, and otherwise shows the setup command. Hosting, HTTPS, backups, restore, monitoring and key rotation are in `docs/operations.md`; the HTTP routes are in `docs/api.md`.

## Configuration

Copy `.env.example` to `.env.local`. Every variable is described there and in `docs/operations.md`.

| Variable | Meaning |
|---|---|
| `HALQA_DB_PATH` | Path of the SQLite file (default `data/halqa.sqlite`) |
| `HALQA_ORIGIN` | Exact public origin (for example `https://halqa.example.org`). Required when hosted: secure cookies, strict transport security, the only origin accepted on writes |
| `HALQA_INTAKE_KEY_SHA256` | SHA-256 of the lab system's key for `POST /api/intake/results` (unset: 503) |
| `HALQA_DELIVERY_KEY_SHA256` | SHA-256 of the message service's key for `POST /api/intake/delivery` (unset: 503) |
| `HALQA_MESSAGE_WEBHOOK_URL`, `HALQA_MESSAGE_WEBHOOK_TOKEN` | Where the worker sends queued patient messages, and its bearer token (unset: messages stay queued) |
| `PORT` | HTTP port (default 3000) |
| `HALQA_LISTEN_HOST` | Address the web server listens on, for example `127.0.0.1` behind a proxy on the same machine (default: every address) |
| `HALQA_TRUST_PROXY` | How many reverse proxies (1 to 5) add the caller's address to `X-Forwarded-For`. Unset: the header is ignored |
| `HALQA_SESSION_IDLE_MINUTES` | Minutes without a request before a session ends (1 to 480, default 30) |
| `NEXT_PUBLIC_HALQA_TIME_ZONE` | Time zone of every date on screen (IANA name), read at build time. Unset: each browser's own |
| `NEXT_TELEMETRY_DISABLED` | `1` stops Next.js usage reports (the launcher sets it) |
| `NODE_ENV` | `production` on a live service; always refuses test controls and `seed:local` |
| `HALQA_TEST_CONTROLS` | Test-only switch that lets test suites move the clock. Never set in production |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `npm start` | App and worker (`scripts/serve.mjs`); `dev` runs the development server, `start` the built app |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint (Next.js rules) over the project |
| `npm test` | Domain, security, permission, persistence, operations and secrets-scan tests |
| `npm run secrets-scan` | Scan every git-tracked file for keys, tokens and files that must not be committed; exit 1 on a finding |
| `npm run test:e2e` | Browser tests with their own database, on port 3001 or the port in `HALQA_E2E_PORT` (`npx playwright install chromium` once) |
| `npm run setup -- --email --name --org [--licence]` | Create the database and the first clinic lead |
| `npm run user:create -- --email --name --role --org [...]` | Create one account with a temporary password shown once |
| `npm run seed:local` | Local development records on a throwaway database; refuses production |
| `npm run backup -- <directory>` | Copy the database to `halqa-<UTC timestamp>.sqlite` |
| `npm run export-case -- <caseId> --out <file>` | One case, its history and queued messages as JSON, for a subject-access request |
| `npm run load-check -- [--duration <s>]` | Drive 50 signed-in clients against 2,000 open cases and report latency (run `npm run build` first) |

## Code map

```text
src/domain/              Closure rules, intake, delivery, directory and workflow transitions (no framework code)
src/server/              Database, sign-in, permissions, command schemas, outbox, intake, snapshots, page policy
src/proxy.ts             Per-response script nonce and Content-Security-Policy
src/app/api/             HTTP routes: health, session, workspace, intake (results, delivery), admin, account password
src/shared/protocol.ts   Shapes shared by server and screens
src/context/             Browser-side sync with the server
src/components/design/   Buttons, cards, dialogs, top bar, sign-in, password change
src/components/staff/    My work, case page, referrals, overview, approvals, accounts
src/components/patient/  Patient portal screens
src/lib/                 Care steps and timing, rules engine, copy for patients, time zone, FHIR export, local development records
scripts/                 Setup, seed, backup, user creation, export, load check, secrets scan, launcher, web server, worker
tests/  e2e/             Unit and browser tests
docs/                    API, operations, security, data protection, architecture, design reference, user guide, go-live checklist
```

## How it is protected

Passwords use salted scrypt. Session tokens are random and stored hashed. Cookies are HttpOnly and SameSite Strict. Every write needs a valid session, a CSRF token and an allowed origin, passes a strict schema and a per-role permission check, and runs in one transaction that also writes an append-only audit record. Repeated requests with the same id do not duplicate work, and stale edits are refused. Patients receive only their own released journey. Security headers are set on every response, and the page policy uses a fresh script nonce per response. Sessions end after 30 idle minutes (configurable), after 8 hours, and on sign-out everywhere. Login attempts are limited per email and client address; intake, delivery, password and admin routes have their own per-client limits. Failed and write requests are logged as one JSON line with no bodies or personal data.

## Known limits

- One server and one SQLite file. Do not run it on ephemeral storage or as several copies.
- The time targets and urgency rules in `src/lib/pathways.ts` need clinical approval before use with patients.
- Arabic, Hindi and Urdu copy needs certified medical translation and patient testing before use.
- No lab or hospital system and no message provider is connected until the operator contracts them (`docs/go-live-checklist.md`). There is no self-service password reset and no two-step sign-in: a clinic lead issues a new temporary password.
- The load check was run on a development machine, not on production hardware.
- The FHIR export is an unvalidated outline, not a live integration.

## Documents

| Document | Purpose |
|---|---|
| `docs/go-live-checklist.md` | What people and contracts must provide before real patients are served |
| `docs/user-guide.md` | Role-by-role user guide with screenshots |
| `docs/operations.md` | Hosting, backups, restore, monitoring, key rotation |
| `docs/api.md` | HTTP routes with examples |
| `docs/security.md` | Threat model, controls, review findings, dependency audit, secrets scan, incident steps |
| `docs/data-protection.md` | Personal data held, retention, subject-access requests |
| `docs/architecture.md` | Architecture and requirement map |
| `docs/product-overview.md` | Product overview |
| `docs/design-handoff.md` | Design reference: tokens, screen-to-file map, content rules |
| `VERIFICATION.md` | Dated test and build evidence |
