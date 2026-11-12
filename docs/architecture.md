# Halqa — architecture and requirement map

## What the system does

Halqa coordinates screening follow-up across navigator, primary-care, specialist, clinic-lead and patient accounts. Staff are limited to the cases of their team, organisation or receiving service; the clinic lead sees the whole network. A patient sees only their own released journey, help requests and patient messages.

## Requirements and where each is met

| Requirement | How it is met |
|---|---|
| See every result from issue to closure | A lab or record system posts results to `POST /api/intake/results`; each actionable result opens one case. My work ranks open cases; the case page shows every care step, owner and history. |
| Clear ownership and timely progress | A named team, accepted hand-overs, receiving-service acceptance, overdue monitoring by the worker. |
| Patients understand and can ask for help | Results are released only after the patient is told; plain-language explanation; understanding check scored on the server; call-back, interpreter and messages. Messages wait in an outbox and a step completes only when the message service reports delivery (`POST /api/intake/delivery`). |
| Referrals are acknowledged across providers | Specialists accept, ask for information, or send back with a reason; the referring doctor sees the outcome. The staff directory and receiving services are rows in the database: staff are managed on the Accounts screen, receiving services on the same screen, in its Receiving services tab (the routes are `/api/admin/services`). |
| Humans decide, the system alerts | Closure rules in the domain; actual signed-in identity; a different licensed lead approves exceptions; clinical monitoring continues during approval. |
| Measure the outcome | The Overview computes measured figures from the cases; standard documented closure is separated from exceptions. No comparison figure is shown without real baseline data. |

## Architecture

Browser screens → authenticated Next.js route handlers → schema and permission checks → shared domain transition → SQLite transaction → case record, audit events and retry receipt.

Tables: users (staff and patient accounts), sessions, cases (typed JSON per case), append-only events, command receipts, login limits, rate limits, outbox (queued messages and delivery reports), services (receiving services of the directory), workspace metadata. Schema changes are numbered steps applied once, inside a transaction, tracked by `PRAGMA user_version`. Writes use WAL, a shared revision that refuses stale updates, and request ids that deduplicate retries. Case changes and their audit events commit together.

Browsers poll the workspace every three seconds and on focus, sending `If-None-Match`; an unchanged workspace is answered with 304 before any case is read. A separate worker checks the clock every 15 seconds, raises alerts for overdue steps, sends queued messages to the configured message address and cleans up expired sessions, receipts and limits.

Sign-in: passwords use salted scrypt; a temporary password (created by setup or by a lead) must be changed before any write. Session tokens are random and stored hashed; cookies are HttpOnly and SameSite Strict, and Secure over HTTPS. A session ends after an idle period (default 30 minutes), after eight hours, on sign-out, on "sign out everywhere" and when the password changes. Mutations need the session's CSRF token and an allowed origin. Sign-in attempts are limited per email and client address, and per client across emails.

Page policy: `src/proxy.ts` gives each page response its own script nonce in the Content-Security-Policy (`'strict-dynamic'`, no inline script without the nonce, no eval, no framing); JSON routes get a policy that allows nothing. Other security headers are set on every response (`next.config.js`).

The web server (`scripts/web.mjs`) serves the built app and replaces `X-Forwarded-For` with the connection address unless `HALQA_TRUST_PROXY` says how many proxies to trust. `scripts/serve.mjs` starts it with the worker.

The system targets one durable server with a local disk. It must not run on ephemeral storage, an edge runtime, or as unsynchronised copies. Growing past one server means moving persistence and coordination to a shared database.

## Operations

Health route (`GET /api/health`), consistent backups (`npm run backup`), one-case export for subject-access requests (`npm run export-case`), one JSON log line per failed or write request with no bodies or personal data, and a load check (`npm run load-check`) that drives 50 signed-in clients against 2,000 open cases. See `docs/operations.md`.

## Checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run secrets-scan`, `npm run build`, `npm run test:e2e`. Results and dates are in `VERIFICATION.md`. Passing tests cover only the scenarios they exercise; they do not establish medical validity or complete security coverage.

## Work that needs people

Clinical approval of pathways and timings, certified translations, a message provider, a lab or record-system agreement, privacy and legal review, hosting, an independent security test and accessibility audit, usability testing, and a pilot partner. Each is a line with an owner and a date in `docs/go-live-checklist.md`.
