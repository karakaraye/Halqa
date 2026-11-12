# Halqa security: threat model, controls and review findings

This describes the code in this repository. What was run, and when, is stated where it matters. Anything an operator must decide or do is marked as an operator responsibility.

## 1. What Halqa holds and why it matters (assets)

| Asset | Where | Why it matters |
|---|---|---|
| Screening results and care records (finding, result code, steps, notes, messages, referrals, appointments, closures) | `cases.data` in the SQLite file | Health information about named people |
| Patient contact details (name, age, sex, phone, language, nationality) | `cases.data`, `outbox.to_phone` | Personal data; the phone number reaches the message service |
| Audit trail | `events` (append-only, triggers refuse update and delete) | Proves who did what and when; needed for clinical and legal review |
| Staff and patient accounts | `users` (scrypt password hashes, email, role, network) | Taking over an account gives that account's view and powers |
| Sessions | `sessions` (SHA-256 of the token, CSRF token, expiry, last activity) | A stolen token is a signed-in session until it ends |
| Integration keys | Environment only: `HALQA_INTAKE_KEY_SHA256`, `HALQA_DELIVERY_KEY_SHA256` (hashes), `HALQA_MESSAGE_WEBHOOK_TOKEN` (the one secret) | The intake key can open cases; the delivery key can mark messages delivered; the webhook token lets anyone send through the message service |
| Backups | Files written by `npm run backup` | A full copy of all of the above |

## 2. Who interacts with it (actors)

- **Staff**: navigators, doctors (PCP), specialists, clinic leads. Each sees only cases of their own network that their role and organisation allow (`src/server/permissions.ts`).
- **Patients**: one account per case, created by a lead; sees only its own released journey (`PatientSummary`), never staff notes, alerts or other cases.
- **Lab or record system**: calls `POST /api/intake/results` with the intake key.
- **Message service**: receives queued messages from the worker; calls `POST /api/intake/delivery` with the delivery key.
- **Operator**: runs the server, holds the keys, makes backups.
- **Attackers**: anyone on the internet (no account), a signed-in user trying to reach more than they may (another role, another network, another patient), someone holding a stolen cookie or a leaked key, a malicious page open in the same browser.

## 3. Entry points

| Entry point | Who may call | Protection |
|---|---|---|
| `GET /` (the screens) | Anyone | Per-response script nonce in the Content-Security-Policy, frame blocking, no data in the page itself |
| `POST /api/session` | Anyone | Origin check; 8 wrong passwords per email and client lock that pair for 15 minutes; 100 attempts of any kind per client per 15 minutes; same answer for unknown, wrong and disabled |
| `GET /api/session`, `GET /api/workspace` | Signed in | Session cookie; role, organisation and network filtering on the server |
| `POST /api/workspace`, `DELETE /api/session`, `POST /api/session/revoke-all`, `POST /api/account/password`, `/api/admin/*` writes | Signed in | Session cookie + `Origin` equal to `HALQA_ORIGIN` + `x-halqa-csrf` token (constant-time compare); strict schemas; per-action role and case checks; admin routes lead-only and network-scoped |
| `POST /api/intake/results`, `POST /api/intake/delivery` | Integration callers | Bearer key compared by SHA-256 in constant time; 503 when not configured; per-client limits; no cookie, so no CSRF exposure |
| `GET /api/health` | Anyone | Reads one row; returns only `{"ok":true}` or `{"ok":false}`; 600 per minute per client |
| Worker → `HALQA_MESSAGE_WEBHOOK_URL` | Outbound | Only the configured address; https required (plain http only for localhost); no redirects followed; 5-second timeout; body has no diagnosis |
| Command-line scripts (`setup`, `user:create`, `backup`, `export-case`, `seed:local`, `load-check`) | Operator with shell access | Not reachable from the network; `seed:local` refuses production |

## 4. Trust boundaries

1. **Browser ↔ reverse proxy**: the internet. HTTPS is the proxy's job (operator).
2. **Reverse proxy ↔ Halqa web server**: the web server (`scripts/web.mjs`) ignores `X-Forwarded-For` unless `HALQA_TRUST_PROXY` says how many proxies to trust. The app port must not be reachable except through the proxy when that is set.
3. **Web server and worker ↔ SQLite file**: same machine, same user, same disk. Anyone who can read the file or the backups can read everything (encryption at rest is the operator's job).
4. **Halqa ↔ lab system and message service**: authenticated by separate keys; the message service also receives patient phone numbers.

## 5. Threats and mitigations (STRIDE)

| Threat | Mitigation in the code | Residual risk |
|---|---|---|
| **Spoofing** a staff member by guessing a password | scrypt (N=16384, r=8, p=1, 16-byte salt), 12-character minimum, per email-and-client lock, per-client sign-in limit, client address not chosen by the caller | Weak but long passwords; no second factor (see residual risks) |
| Spoofing by stolen session cookie | HttpOnly, SameSite=Strict, Secure when the origin is https; only the token hash is stored; idle limit (30 min default), 8-hour absolute limit; sign out everywhere; a password change ends all sessions; a new sign-in ends the session the browser held | A token stolen from a running device works until one of those ends it |
| Spoofing an integration caller | Bearer keys stored only as SHA-256 hashes, constant-time compare, separate key per direction | A leaked key works until rotated (up to three hashes may overlap during rotation) |
| **Tampering** with cases from another role, network or patient | Every action is checked on the server: role, organisation, network, current step, directory membership (`authorize`, domain rules); a case of another network is "not found" | None found in this review |
| Tampering by cross-site request | Origin check + CSRF token on every cookie-authenticated write; SameSite=Strict | — |
| Tampering with the audit trail | `events` has triggers that abort any UPDATE or DELETE; every case change writes its events in the same transaction | Someone with direct write access to the file can drop the triggers |
| Replay or double submission | Request ids with payload hashes (receipts kept 30 days); revision check refuses stale saves | — |
| **Repudiation** | Audit events for sign-in, sign-out, lock-out, sessions revoked, password change, account and service create/disable, every case change, intake and delivery reports | Reading a record is not audited |
| **Information disclosure** across roles or to patients | Snapshots built per user on the server; patients get only `PatientSummary` (released steps, team names, patient-thread messages) | — |
| Disclosure through errors or logs | Users see fixed sentences; internal faults become one generic sentence; logs hold time, route pattern, method, status, error name and SQLite's fixed result text only; never bodies, emails, tokens or phone numbers | — |
| Disclosure through script injection | Content-Security-Policy with a fresh nonce per page and `'strict-dynamic'`; no inline script without the nonce, no eval, no objects, no framing; React escapes text | `style-src 'unsafe-inline'` remains (styles cannot run code) |
| Disclosure in transit to the message service | https required for the webhook (plain http only to localhost), token never in the URL | The service necessarily receives phone numbers |
| **Denial of service** | Request limits per client in the database; 32,000-byte body limit; the alert scan holds the write lock only for cases that change; unchanged polls answered before any case is read | One server and one SQLite file; scrypt runs on the main thread (about 90 ms per sign-in on the test machine) |
| **Elevation of privilege** | Lead-only admin routes; patients cannot act as staff or impersonate (`asPatient` checks); test clock controls refused when `NODE_ENV=production`; temporary passwords must be changed before any write | — |
| Server-side request forgery | The worker posts only to the configured address; `redirect: 'error'` so redirects are never followed; no address comes from a request | — |

## 6. Review findings (12 November 2026)

Independent review of every route, server module, domain rule and script. Each fixed finding has a test that covers it, named in the table; the tests exercise behaviour the old code did not have (for example the old code read the left-most address and had no per-client sign-in limit).

| # | Severity | Finding | Status | Evidence |
|---|---|---|---|---|
| 1 | High | Request limits and the sign-in lock keyed on the first `X-Forwarded-For` entry, which the caller chooses: changing it per request gave unlimited password guesses for one email | Fixed: `scripts/web.mjs` replaces the header with the connection address unless `HALQA_TRUST_PROXY=n`; the app takes the entry its n trusted proxies added (right-most) | `tests/security.test.ts` (client address, lock not reset by a new spoofed entry); against the built server on port 3056, ten wrong passwords with ten different `X-Forwarded-For` values gave `401` ×8 then `429` ×2 |
| 2 | Medium | No per-client limit across emails: one address could try one password against every account | Fixed: 100 sign-in attempts per client per 15 minutes | `tests/security.test.ts` (one client limited across many emails) |
| 3 | Medium | Content-Security-Policy allowed `'unsafe-inline'` scripts, so an injected inline script would run | Fixed: `src/proxy.ts` sets a policy with a fresh nonce per page and `'strict-dynamic'`; the layout renders per request (one-line front-end change in `src/app/layout.tsx`); JSON routes get `default-src 'none'` | `tests/security.test.ts`, `tests/backend.test.ts`; browser check in section 7 |
| 4 | Medium | The message webhook could be plain http to any host, sending phone numbers and the bearer token in clear | Fixed: https required, plain http only to localhost/127.0.0.1/::1, no credentials in the address; nothing is sent and messages stay queued otherwise | `tests/security.test.ts` (address rules; row stays QUEUED with 0 attempts) |
| 5 | Low | Integration key rotation forced an outage window (one hash per variable) | Fixed: up to three comma-separated hashes accepted, all compared in constant time | `tests/security.test.ts` (rotation) |
| 6 | Low | CSRF token compared with `!==` | Fixed: constant-time compare of hashes | `tests/security.test.ts` (CSRF) |
| 7 | Low | Any error thrown while applying an action, including internal faults, was returned to the user as 422 with its raw message | Fixed: only the domain's plain refusals become 422; anything else is the generic 500 sentence | `tests/security.test.ts` (internal faults) |
| 8 | Low | A new sign-in left the session the browser already held valid until expiry | Fixed: the presented session ends on sign-in | `tests/security.test.ts` (sign-in ends the old session) |
| 9 | Low | Sign-out, sign-in lock-out and session revocation were not audited | Fixed: `SIGN_OUT`, `SIGN_IN_LOCKED` (once, no address), `SESSIONS_REVOKED` | `tests/security.test.ts`, `tests/session-hardening.test.ts` |
| 10 | Low | No idle timeout; no way to sign out everywhere except changing the password | Fixed: `HALQA_SESSION_IDLE_MINUTES` (default 30), `POST /api/session/revoke-all` | `tests/session-hardening.test.ts` |
| 11 | Low | Database lock errors could not be told apart from other faults in the logs | Fixed: log lines carry SQLite's fixed result text (`"database":"database is locked"`) | `tests/security.test.ts` |
| 12 | Low | Password hashing uses scrypt N=16384, r=8, p=1, below current OWASP guidance (N=2^17) | Accepted: the recommended cost measured about 1 s per hash on the test machine and runs on the main thread, blocking every other request during each sign-in; with the 12-character minimum and the sign-in limits the present cost is kept. Revisit with an asynchronous hash | Measured: 91 ms (current) against 732 to 1,032 ms for the OWASP sets |
| 13 | Low | `npm audit`: 7 moderate findings, all in development tooling (minimatch under typescript-eslint); none at high or critical | Open and not reachable in production: see section 6a | `npm audit` and `npm audit --omit=dev` (0 vulnerabilities), 12 November 2026 |
| 14 | Info | npm warns that `esbuild` (pulled in by `tsx`) has an install script not covered by `allowScripts` | Decided: denied explicitly (`"allowScripts": {"esbuild": false}` in `package.json`). esbuild's binary comes from its platform package, so `tsx` works without the script; every script and test in this repository ran with it denied | `npm install-scripts deny esbuild` |
| 15 | Info | An account email is unique across the whole file, so a lead creating an account learns that an email exists in another network (409) | Accepted: leads are trusted staff; one network per installation is the expected use | — |
| 16 | Info | HSTS is decided when the app is built (`next.config.js` headers are fixed at build time) | Documented: set `HALQA_ORIGIN` when running `npm run build` (`docs/operations.md`) | — |

Checked and found sound: session tokens (32 random bytes, only SHA-256 stored), temporary passwords (18 random bytes, shown once, change forced before any write), every SQL statement uses bound parameters (the only interpolations are migration step numbers from code), body size limit (32,000 bytes, streamed), strict schemas on every body, the patient projection (no staff notes, alerts, other patients or emails), lead-only and network-scoped admin routes, no case reachable across networks (case lookups load only the user's network), outbox ids and delivery reports (a settled message cannot be flipped), no secret in logs or in the database (keys are hashes in the environment only).

### 6a. Dependency audit

`npm audit --omit=dev` (what the built app ships) reports 0 vulnerabilities. `npm audit` reports 7 moderate findings: one advisory and six packages that depend on the affected one. `npm audit fix` (without `--force`) changes nothing: the newest release of `typescript-eslint` (8.72.2) is itself inside the affected range, so there is no patched version to move to.

| Package | Severity | Advisory | Why it is not reachable in production |
|---|---|---|---|
| `minimatch` 10.2.6 (nested under `@typescript-eslint/typescript-estree`) | Moderate | GHSA-g3hv-75wg-m249: denial of service through glob-pattern amplification | A development dependency used by the linter; it is not part of the built app or the server |
| `@typescript-eslint/typescript-estree`, `parser`, `utils`, `type-utils`, `eslint-plugin` and `typescript-eslint` (all 8.72.2, pulled in by `eslint-config-next`) | Moderate (they only depend on the package above) | Same advisory | Linting tools run by developers and CI; no input from a user or from the network reaches them |

The weekly CI job runs `npm audit --audit-level=high`. Run `npm audit fix` again when `typescript-eslint` publishes a release outside the affected range.

### 6b. Secrets scan

`npm run secrets-scan` (`scripts/secrets-scan.mjs`, no dependencies, also a CI step) reads every file tracked by git except `package-lock.json` and binary files. It looks for private key blocks, AWS access keys, GitHub, Slack and Google API tokens, long `Bearer` values, secret-named variables (names containing SECRET, TOKEN, PASSWORD, API_KEY and similar) assigned a real-looking value, and tracked files that must never be committed (`.env` files other than `.env.example`, `data/*.sqlite`, `*.pem`, `*.key`). It prints `file:line` and the name of the pattern, never the value, and exits 1 on a finding. `tests/secrets-scan.test.ts` proves that it flags planted test secrets and passes a clean tree. It finds known token shapes and obvious assignments only; it is a safety net, not a guarantee. Result on the release tree: no findings.

## 7. Security headers, verified

Run on 12 November 2026 against the built app (`npm run build`, then `node scripts/serve.mjs start` on port 3056 with its own database under `data/`, `NODE_ENV=production`, no `HALQA_ORIGIN`).

`curl -I http://localhost:3056/`:

```
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
content-security-policy: default-src 'self'; script-src 'self' 'nonce-<fresh per response>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

`curl -I http://localhost:3056/api/health`: the same first six headers, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` and `cache-control: no-store`. No `X-Powered-By`.

Every `<script>` tag in the served page carried the response's nonce. With `HALQA_ORIGIN` set to an https address, `Strict-Transport-Security: max-age=31536000` is added (from the build) and the page policy adds `upgrade-insecure-requests`; that combination was checked by tests, not over a real TLS connection.

**Browser check** (same day, final build, fresh database filled by `npm run seed:local` plus one account made with `npm run user:create`): a throwaway Playwright script outside the repository drove Chromium at 1440 and 390 pixels wide through every screen of every role, listening for `securitypolicyviolation` events and console messages:

- Clinic lead: sign-in, Overview, Approvals, Accounts, the create-account dialog, the change-password dialog.
- Navigator: My work, a case page, the delay-reason dialog, Overview, change password.
- Doctor: My work, a case page, the hand-over, close-case and delay-reason dialogs, Overview, change password.
- Specialist: Referrals, a referral, Overview, change password.
- Four patients (Arabic, Hindi and Urdu portals among them): every tab of the patient portal (result, steps, help), the language switch.
- A new account: the forced "Set a new password" screen, then its screens.
- A page that does not exist.

Result: 135 screen visits, **0 Content-Security-Policy violations**, 0 page errors. The only console messages were the browser's own notes for two expected answers: 401 from `GET /api/workspace` while the sign-in screen checks for a session (18, one per sign-in), and 404 for the page that does not exist (18, plus one more 404 notice). 18 workspace polls were cancelled by the browser when the script navigated away. The policy did not need loosening.

## 8. Residual risks

- No second factor for staff sign-in.
- Reading a patient record is not audited (only changes are).
- One server and one SQLite file: no high availability; anyone with the file or a backup has all the data unless the disk is encrypted.
- scrypt cost below current guidance and synchronous (finding 12).
- `style-src 'unsafe-inline'` (CSS injection is possible in principle; it cannot run script).
- The message service receives phone numbers and the sign-in link, by design.
- Patient translations other than English have not had certified review (`docs/go-live-checklist.md`); a misleading translation is a safety risk, not a security one.
- Not tested: an independent penetration test (`docs/go-live-checklist.md`), a real TLS deployment, behaviour behind a real reverse proxy.

## 9. Operator responsibilities

- Serve only over HTTPS through a reverse proxy; set `HALQA_ORIGIN` to the exact public origin, both when building and when running.
- Bind the app to the proxy only (`HALQA_LISTEN_HOST=127.0.0.1` when on the same machine) and set `HALQA_TRUST_PROXY` to the number of proxies, or leave it unset when nothing is in front.
- Always start the app with `npm start` or `node scripts/web.mjs`, never `next start` directly (that skips the client-address protection).
- Generate long random integration keys, give each caller only its own key, store only hashes, rotate as in `docs/operations.md`.
- Keep `.env.local` readable only by the service user; never commit it.
- Encrypt the disk holding the database and the backups; restrict who can log in to the server.
- Keep Node.js and the dependencies patched; run `npm audit --audit-level=high` (the CI job does weekly) and `npm run secrets-scan` before every release.
- Watch the logs as described in `docs/operations.md`; disable accounts of people who leave the same day.

## 10. Incident response

Fill these in before going live. Keep a copy off the server.

| Role | Name | Phone | Email |
|---|---|---|---|
| Incident lead | | | |
| Data protection officer | | | |
| Clinical safety lead | | | |
| Hosting / IT contact | | | |
| Message service provider contact | | | |
| Lab or record system contact | | | |
| Supervisory authority for breaches | | | |

Steps:

1. **Record** the time, who noticed, and what was seen. Do not delete anything.
2. **Contain**:
   - Stolen or suspected account: a lead disables the account (Accounts screen or `POST /api/admin/users/{id}/disable`), which ends its sessions. A person can end their own sessions with sign out everywhere.
   - Leaked intake or delivery key: replace its hash as in `docs/operations.md` (key rotation) and restart; the old key stops at once.
   - Leaked webhook token: ask the message service to revoke it, set the new one, restart the worker.
   - Server compromise: take it off the network; keep the disk for investigation; restore a known-good backup onto a clean server.
3. **Preserve evidence**: copy the application logs (standard output and error) and make a backup (`npm run backup`) before changing anything else. The `events` table cannot be changed through the app.
4. **Assess**: which records and which people are affected. `npm run export-case -- <caseId>` gives one case's full record and history; the `events` table shows who did what and when (sign-ins, lock-outs, changes).
5. **Notify** as the law and the operator's procedure require (the data protection officer decides; many regimes set 72 hours from awareness). Record the decision and its reasons.
6. **Recover**: fix the cause, rotate any key that could have been seen, check `GET /api/health`, have a lead sign in and check the expected cases.
7. **Review** within two weeks: what happened, what changes, who does them. Record it.
