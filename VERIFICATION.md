# Halqa verification record

This file records what was actually run, when, and what happened. Never edit a result without re-running it. The latest run is the last "Run" section; the design comparison is near the end.

## Run 1 — 11 November 2026, before the interface rebuild

Node 24, Next.js 16.4.6.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 22 of 22 pass |
| `npm run build` | pass |
| `npm run test:e2e` (4 browser journeys) | 4 of 4 pass |

## Run 2 — 11 November 2026, after server safety fixes (reported, not re-run)

Changes: login lockout per email and client, snapshot reads no longer write, security headers, `lint` script renamed.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 25 of 25 pass |
| `npm run build` | pass |

## Run 3 — 11 November 2026, front-end rebuild (reported separately; not reproduced, see Run 4)

| Check | Result |
|---|---|
| `npm run typecheck` | pass (clean zero errors) |
| `npm test` | 25 of 25 pass |
| `npm run build` | pass (Next.js 16.4.6, webpack, static + dynamic routes clean) |
| `npm run test:e2e` | 5 of 5 journeys pass (1.7m, 1440, 768, 390, 320 px) |
| Accessibility checks (@axe-core/playwright) | pass on all staff and patient screens (zero critical/serious violations) |
| Visual comparison screenshots saved to `docs/design/compare/` | 21 frames saved and compared |

## Run 4 — 11 November 2026, after joining the back-end and front-end work

Node 24, Next.js 16.4.6. The back-end and front-end changes were joined and the conflicts resolved.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass, no errors |
| `npm run lint` | pass (exit 0); this is `tsc --noEmit` only, not ESLint |
| `npm test` | 51 of 51 pass (48 existing, 3 new for the clock-control switch) |
| `npm run build` | pass |
| `npm run test:e2e` | 5 of 5 pass (1.6 min) |

The first browser run failed journey 01: a disabled account now gets the same answer as a wrong password, and the test expected the older "account is disabled" message. The test was updated. One later run failed journey 05 with a refused connection because another process took port 3001 during the run; the next run on a free port passed 5 of 5. Accessibility and screenshot comparison were not checked beyond the axe calls inside the browser journeys.

Run 3 above is the front-end work's own report; its 25-test and accessibility figures were not reproduced here.

## What the passing runs established

### First rebuilt tree — 11 November 2026

On the rebuilt tree: typecheck passed; the existing lint command passed but is not ESLint; all 26 tests passed; production webpack build passed. The new account regression test covers a version-zero database upgrade, first-sign-in flag, network-scoped listing, password non-disclosure, self-disable rejection, session revocation and blocked login after disable. All four browser journeys failed on obsolete labels: Impact, translated Sign out (two journeys), and All open. These tests were rewritten afterwards (see Run 9). The earlier passing browser results do not apply to the rebuilt screens.

- Closure is validated in the domain and by the server, not only by a disabled button. Incomplete, unlicensed and generic-step bypass attempts are rejected.
- Exception approval needs a licensed lead who is a different person from the submitter, a pending request, and cannot be replayed. A rejected exception reopens the case.
- Pending approval keeps clinical monitoring and has its own deadline.
- Passwords and session tokens are hashed; login failures lock out per email and client; logout revokes access.
- Roles, cases and networks are enforced on the server. Patient responses contain only that patient's released journey.
- Stale revisions fail; identical retries do not duplicate actions; audit rows cannot be changed or deleted.
- Routes require sign-in, a matching origin and a CSRF token and return no-store responses.
- Reading a snapshot does not write: revision and audit events are unchanged.
- Patient mobile portal runs cleanly at 390px and 320px with zero horizontal scroll, multi-language support (English, Arabic, Hindi, Urdu) with RTL, interactive Quick Check, confidence rating, help/callback requests, and `.ics` calendar appointment generation.
- Full shared clinical pathway verified from screening result acknowledgment, doctor consult, specialist referral and acceptance, procedure attendance, specialist outcome, care plan, navigator callback, and evidence-verified closure.
- Account administration works end-to-end: lead can create accounts with one-time temporary passwords, enforce forced password change on first sign-in, disable accounts, and block disabled account access.
- Resilient UI states: animated loading skeletons, retry on failed saves reusing request ID, offline banner with disabled save mutations, not-your-patient 404 message, and live intake notification for new screening results.

## What has not been established

- Performance on production hardware and under real traffic (the load check in Run 8 was made on a development machine).
- External live SMS/WhatsApp gateways or live hospital integration (simulated via local outbox and intake API contracts).
- Anything about medical validity or clinical efficacy.

## Run 5 — 12 November 2026, setup split, operations, plain wording, ESLint

Node 24, Next.js 16.4.6, ESLint 9 with `eslint-config-next` 16.4.6.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`eslint .`) | exit 0, no errors, no warnings |
| `npm test` | 79 of 79 pass |
| `npm run build` | pass |
| `npm run test:e2e` | 5 of 5 journeys pass |
| Backup and restore drill (see `docs/operations.md`) | live file and backup both 68 cases, 22 accounts, integrity check `ok`; copy opened by the app at schema version 4 |
| `GET /api/health` against `next start` | 200 with `{"ok":true}`, no cookie needed |

Not run: the weekly dependency audit job and the CI workflow on a hosting service; the load check. `npm audit` reports 7 moderate findings in development tooling and none at high severity.

## Run 6 — 12 November 2026, browser store fixes

Node 24, Next.js 16.4.6.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass, no errors |
| `npm run lint` (`eslint .`) | exit 0, no errors, no warnings |
| `npm test` | 82 of 82 pass (3 new in `tests/workspace-etag.test.ts`: 304 with no body for a matching If-None-Match, tag changes with the revision and differs between users, sign-in still required) |
| `npm run build` | pass |
| `npm run test:e2e` | 11 of 11 pass (2.0 min): the 5 existing journeys and 6 new ones in `e2e/state-handling.spec.ts` |

The new browser journeys cover: sign-out clears the new-result banner and the failed action for the next user; two new results are queued; a hand-over does not show the new-result banner; a lost reply is retried with the same request id and original revision and the error reads as a plain sentence; offline shows the banner and turns "Save reason" off with "You are offline" (and the patient banner in Arabic); an intercepted 404 shows "This patient is not on your list". The first run of the new file failed three journeys because the test matched Next.js's empty route announcer (also `role="alert"`); the selector was narrowed and the next runs passed.

First-load JavaScript for the sign-in route, measured as the gzip size (level 9) of every script that the built `/` page loads (`.next/server/app/index.html`):

| | Page chunk | All scripts for modern browsers | Including the `noModule` polyfills |
|---|---|---|---|
| Before (tree at bc8ddbf) | 41.1 KB | 170.9 KB | 209.5 KB |
| After code splitting | 17.4 KB | 147.3 KB | 185.9 KB |

The shared framework chunks (React DOM 62.4 KB, Next.js runtime 65.5 KB) are most of the remainder. Layout shift was not measured.

## Run 7 — 12 November 2026, screen polish

Node 24, Next.js 16.4.6.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass, no errors |
| `npm run lint` (`eslint .`) | exit 0 |
| `npm test` | 82 of 82 pass |
| `npm run build` | pass |
| `npm run test:e2e` | 11 of 11 pass (1.8 min), no browser test changed |

Also done by hand: the built app was run on its own port and database, and My work, the case page, Referrals (empty) and the patient result screen were opened and compared with the drawings. Not run: the accessibility pass was not repeated outside the existing browser tests, and no 320 px screenshot was taken after the change.

## Run 8 — 12 November 2026, security review, session hardening, load check

Node 24.22.1, Next.js 16.4.6, Windows 11. The browser suite (`npm run test:e2e`) was not run in this pass; another process owned port 3001.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass, no errors |
| `npm run lint` (`eslint .`) | exit 0 |
| `npm test` | 114 of 114 pass (new: `tests/security.test.ts` 10, `tests/session-hardening.test.ts` 9, `tests/export-case.test.ts` 3, `tests/time.test.ts` 4, `tests/load-check.test.ts` 2, and 4 more in `tests/workspace-etag.test.ts`) |
| `npm run build` | pass |
| `npm audit --audit-level=high` | exit 0 (7 moderate findings in development tooling, none high) |
| Headers with `curl -I` against the built app | as listed in `docs/security.md` section 7 |
| Browser policy check (Chromium, 1440 and 390 px, every role's screens and dialogs, patient portals in three languages, forced password screen) | 135 screen visits, 0 Content-Security-Policy violations, 0 page errors |
| Sign-in lock against a spoofed `X-Forwarded-For` (built app, ten wrong passwords, ten different header values) | 401 ×8, then 429 ×2 |

### Load check

`npm run load-check -- --duration 300`: a fresh database with one network, 2,000 open cases (alerts already raised) and 50 staff accounts; the built app and worker started by the script; 50 signed-in clients each polling `GET /api/workspace` every 3 seconds with `If-None-Match`; 5 of them also saving a delay reason every 10 seconds. Latency is measured by the script on the same machine, to the last byte of the answer.

| Run | Requests | p50 | p95 | p99 | Max | Errors | Database lock errors |
|---|---|---|---|---|---|---|---|
| Before the changes (60 s, first build) | 382 | 5,112 ms | 9,362 ms | 11,868 ms | 12,945 ms | 41 (no answer) | 0 |
| After the changes, **5 minutes** | 5,292 (5,141 polls: 4,496 full, 645 not modified; 151 saves) | **24 ms** | **140 ms** | **305 ms** | 1,608 ms | **0** | **0** |

Saves in the 5-minute run: p50 85 ms, p95 153 ms, 150 saved, 0 refused as stale, 0 failed. Two answers took a second or more. The 95th percentile per 30-second window ran from 47 to 191 ms, and 377 ms in the last window, when the other process's browser suite started again on the same machine. Earlier 5-minute runs made while that suite was running the whole time, before the last two changes, gave p95 3,047 ms and 777 ms with no errors; they are not counted as results.

What was slow and what changed: every poll built the full snapshot (all cases of the file parsed, a quadratic lookup to match each case to its network row, the whole snapshot encoded twice for the tag), and the worker held the write lock while checking every case. Now the tag is worked out from the revision, user, directory and a one-minute clock bucket before any case is read; snapshots read only the user's network from parsed cases kept between reads and re-read only rows whose version changed (schema step 5 triggers); the response reuses the stored case text; session activity writes never wait for the lock; the alert scan saves only changed cases, 50 per transaction.

## Design comparison

Written 12 November 2026 by looking at each exported frame in `docs/design/` next to the screenshot of the running app in `docs/design/compare/` (the app was driven by the browser tests; every picture is from a real run). Staff screens were compared at 1440 pixels, patient screens at 390. The 768 and 320 pictures, and the 390 pictures of the staff screens, were taken and checked for horizontal scroll but not compared line by line. Frames 10:2 (style guide), 12:2 (how it works) and 14:367 (states) are exported but have no screen to photograph; the six states are covered by `e2e/state-handling.spec.ts` instead.

Differences that are not fixed are marked **open**. The people in the pictures are the made-up people the tests open; they differ from the people drawn in the frames, which is expected and is not listed again.

| Frame | Picture | Matching | Different |
|---|---|---|---|
| 11:2 Sign in | `11-2-sign-in-1440.png` | Two-column layout, same headline and sentence, form card on the right, same labels, filled teal button, same help line. | Our hint line fits on one line and the card is a little shorter. The drawing's e-mail placeholder is "name@yourclinic.org"; ours reads "Email address". The drawing shows dots in the password field; ours is empty. **Open**, cosmetic. |
| 11:22 My work | `11-22-my-work-1440.png` | Greeting, four count cards (rose, rose, amber, sky), "Your patients" cards with name, age and language, next step, status chip, due line and Open or View. | The top bar shows only the tabs the role may use (My work, Overview) and adds Password and Sign out; the drawing shows four tabs and no buttons. By design, see `docs/design-handoff.md`. |
| 13:2 Case page | `13-2-case-page-1440.png` (patient not yet told) | Breadcrumb, name with status chip, teal "Your next step" card with three actions, "What has happened" list with the current step highlighted, right column with About, Who is looking after, Close this case. | Ours has more: the Interpreter row with a Request button, the "Something is slowing this down" card, Messages and History. The first hero button reads "Message Huda" where the drawing shows "Mark as done" for a step already flagged. The timeline lists ten steps where the drawing lists seven and merges the last two into "Plan agreed and case closed". The amber "Call needed" row only shows after a wrong quick-check answer (checked in journey J3). **Open**. |
| 13:233 Close this case | `13-233-close-dialog-1440.png` | Title, one-line explanation, "Before you close" list with Done and Not done chips, "What did the test show?" and "Where is the report?" fields, "Not yet" and "Close case". | Ours shows the real rules the server checks (ten rows instead of four) and adds the ending kind, the plan and the next screening date (and a reason for exceptions). The close button is grey until every row is done. **Open**: the list is longer than drawn because the rules are. |
| 13:324 Send this referral back | `13-324-send-back-dialog-1440.png` | Title, same sentence, four reasons as radio rows, "Cancel" and a red "Send back". | The drawing opens on the second reason; ours selects the first. The drawing has a blue note naming the patient's doctor; ours is a grey line that names no one. Our picture shows the pop-up over the Referrals page; the drawing shows the pop-up alone. **Open**, small. |
| 13:284 Hand over this patient | `13-284-hand-over-dialog-1440.png` | Title and sentence, people as selectable rows with initials, role and place, reason field, "Cancel" and "Send request". | Ours lists doctors and the specialist and does not offer the navigator the drawing shows (the server refuses it). Our picture was taken before anyone was chosen, so no row is ticked and the send button is grey. The reason field has no example text. **Open**, by design for the navigator. |
| 13:138 Referrals | `13-138-referrals-1440.png` | Page title and sentence, referral cards with programme and urgency chips, "What was found" and "What is needed", the doctor's message, Accept, Ask for more information and Send back; right column with Questions from doctors and Accepted. | Urgency chips read "Soon" for elevated cases; the drawing's first card says "Needs you now" because that case was critical. "What is needed" says "Colonoscopy within 30 days" where the drawing says "A colonoscopy (camera test), within 15 days". Our "Questions from doctors" card was empty when photographed, so the reply box is not shown. **Open**: wording of the test name. |
| 14:203 Overview | `14-203-overview-1440.png` | Title, four figure cards, "Where patients get stuck" bars, "Programmes" list with status chips. | The drawing shows "Before Halqa" comparison figures; ours shows none (no invented figures). Ours adds "Export CSV", and its bar counts sit at the far right instead of beside the bar. The figures differ because they are computed from the cases. By design. |
| 14:296 Approvals | `14-296-approvals-1440.png` | Title and sentence, "Waiting for your decision" with a doctor's note, the three buttons, "Late or stuck", "How the app decides what is urgent". | Ours adds a decision-note box (the server needs a reason of at least 5 characters, so Approve and Send back are grey until it is written) and a "Submitted by ... evidence ..." line. "Late or stuck" lists every open alert and uses "Late" and "Needs a decision" chips; the drawing also has a "Stuck" chip. **Open**, small. |
| P1 Your result | `P1-result-390.png` | Card with title, amber chip, "This is not a diagnosis.", the explanation, "What happens next" card, Listen button, Continue, bottom bar. | Ours has a language chooser and Sign out under the title bar (the drawing has the greeting only). "Listen to this" has a pale fill; the drawing's is white. The chip text is smaller than drawn. **Open**: the language chooser is needed for patients and is kept. |
| P2 Quick check | `P2-quick-check-390.png` | Title, intro, three questions with three answers each, 1 to 5 scale with "Not sure" and "Very sure", "Send my answers". | The drawing shows answers already chosen and a different second answer ("A specialist will see me for a short test"); ours shows the app's own answers, the correct one being "Follow the next step with my care team". Our picture is taken before anything is chosen, so the send button is grey. |
| P3 All done | `P3-all-done-390.png` | Large tick circle, "Thank you", the saved sentence, "Back to my result", the hint. | Ours adds the line "Your team: ..." with names. |
| P4 Your steps | `P4-steps-390.png` | Title, teal "Next step" card, list with Done, Now and Later chips. | The drawing's next-step card asks the patient to choose one of three times; ours does not, because patients no longer pick times (staff book a real date and time). The drawing lists five steps; ours lists every step of the programme. **Open**: the drawing is out of date on slot choice. |
| P5 Booked | `P5-booked-390.png` | "You are booked", blue card with Booked chip, date and time, place and what to bring, "Add to my calendar", "I need to change this". | Ours adds the full steps list below. Date and place come from the booking the staff made. |
| P6 Help | `P6-help-390.png` | Title, three buttons with a line under each, "Your team" card, "Not for emergencies" card. | The first line reads "We will call you as soon as we can" where the drawing says "within one working day" (no approved service level exists). The team card shows the case's navigator and doctor with their clinics; the drawing shows their roles. |
| P8 Waiting | `P8-waiting-390.png` | Card "Your result is on its way", explanation, "Ask for a call back", bottom bar. | The title wraps to two lines in the drawing and fits one line in ours; the language chooser is added. |
| P9 Arabic result | `P9-arabic-390.png` | Right-to-left layout, same card order, bottom bar order reversed, Arabic text. | Ours adds the language chooser (showing "Arabic / العربية") and the sign-out button above the card, and the Latin name sits after the Arabic greeting. **Open**: the same header difference as P1. |

Nothing in the product was changed to make a picture match; the screens were photographed and read. The open items are for the design owner to decide.

## Run 9 — 12 November 2026, browser test suite and design evidence

Node 24, Next.js 16.4.6. The browser runs below used a clean copy of the committed tree (`git archive` of commit aa05eeb, built with `npm run build`, with the final `e2e/helpers.ts` copied in; only pictures and documents changed after that) on port 3101 through `HALQA_E2E_PORT`, because another process on this machine rebuilt `.next` and took port 3001 during earlier attempts. The copy shares `node_modules` with the working tree.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass, no errors |
| `npm run lint` (`eslint .`) | exit 0, no errors, no warnings |
| `npm run build` (the copy) | pass |
| `npm run test:e2e`, first plain run | 32 of 32 pass (4.1 min) |
| `npm run test:e2e`, second plain run | 32 of 32 pass (8.3 min; slower, the machine was busy) |
| `npm run test:e2e` with `SAVE_SCREENSHOTS=1` (the run that wrote the pictures, one commit earlier) | 32 of 32 pass (4.0 min) |

The 32 tests are the 11 existing ones (the old test 05 was rewritten to click through the screens), plus 21 new: intake to My work (I1), six journeys (J2 to J7), four keyboard tests (K1 to K4), five role tests, and five screen checks (S0 to S4).

What the runs established:

- Axe (WCAG 2.0 A and AA, 2.1 AA, colour contrast on) found no critical or serious violation, and no moderate contrast violation, on every staff screen and pop-up at 1440 and 390 pixels and every patient screen at 390 and 320. Test S0 adds pale text to a page and checks that the same function reports `color-contrast`, so a pass is not a no-op. No screen was changed as a result.
- The keyboard-only journeys pass, including a visible outline at every Tab stop, focus kept inside the create-account and close-case pop-ups and returned to the button that opened them.
- A result posted to `POST /api/intake/results` with the bearer key shows the new-result banner on the assigned navigator's and the doctor's screens within eight seconds and a repeat of the same result opens nothing; a wrong key and a missing key give 401. A written message stays "waiting to be delivered" until `POST /api/intake/delivery` reports it, then the step completes and the patient sees the result.
- Pictures: 49 files in `docs/design/compare`. Staff screens and pop-ups at 1440 and 390 pixels wide (the five original screens also at 768), patient screens at 390 and 320 (Waiting, Result, Arabic result, Quick check, All done, Steps, Booked, Help), Accounts, the create-account and disable-account pop-ups, the forced password screen and the change-password pop-up. The P9 Arabic pictures are the result screen and differ from each other.

Found in that run: the intake route stamps a new case with real time while the test controls can move the workspace clock forward, so the new-result banner does not appear for a case opened after the clock moved. Not reachable in use. Test I1 runs first for that reason.

Not run in that pass: `npm test`; the three frames with no screen (style guide, how it works, states) have no picture.

## Run 10 — 13 November 2026, release tree

A clean checkout of the release tree (`npm ci`, then each command below), Node 24.22.1, Next.js 16.4.6, Windows 11. The browser runs used port 3101 through `HALQA_E2E_PORT` with nothing else listening on it; the screenshots were not rewritten (`SAVE_SCREENSHOTS` was not set).

| Check | Result |
|---|---|
| `npm ci` | installs 400 packages |
| `npx tsc --noEmit` | pass, no errors |
| `npm run lint` (`eslint .`) | exit 0, no errors, no warnings |
| `npm test` | 117 of 117 pass (114 existing and 3 new in `tests/secrets-scan.test.ts`) |
| `npm run secrets-scan` | no findings |
| `npm run build` | pass |
| `npm run test:e2e`, first run | 32 of 32 pass (9.3 min) |
| `npm run test:e2e`, second run | 32 of 32 pass (6.0 min) |
| `npm audit --omit=dev` | found 0 vulnerabilities |
| `npm audit` | 7 moderate findings in linting tools; `npm audit fix` changes nothing because no patched release exists (details in `docs/security.md` section 6a) |

Not run in this pass: the load check (the figures in Run 8 stand), a real TLS deployment, an independent penetration test or accessibility audit.

## Run 11 — 12 November 2026, receiving services screen

Branch `feature/receiving-services` after `npm ci`, Node 24.22.1, Windows 11. The browser runs used port 3101 through `HALQA_E2E_PORT` with nothing else listening on it. The first browser run was made with `SAVE_SCREENSHOTS=1` (six new pictures, and the two Accounts pictures retaken because the screen now has two tabs); the second was made without it.

| Check | Result |
|---|---|
| `npm ci` | completes |
| `npx tsc --noEmit` | pass, no errors |
| `npm run lint` (`eslint .`) | exit 0, no errors, no warnings |
| `npm test` | 117 of 117 pass |
| `npm run secrets-scan` | no findings |
| `npm run build` | pass |
| `npm run test:e2e`, first run | 40 of 40 pass (5.9 min) |
| `npm run test:e2e`, second run | 40 of 40 pass (5.8 min) |

The 8 new browser tests: R1 (a lead adds a receiving service, the doctor's referral form offers it, the lead disables it and the form stops offering it), R2 (empty state), R3 (list that cannot be loaded, then Try again), R4 (the same unit and programme twice gives the plain sentence and keeps the dialog open), R5 (a refused specialist gives the plain sentence; a directory with no specialist shows the notice and turns Add service off), R6 (axe, colour contrast on, at 1440 and 390 on the empty list, the list with items, the add dialog and the disable dialog), K5 (keyboard: arrow keys between the two tabs, Tab kept inside the add dialog, Escape returns focus to Add a receiving service), and S2b (screens and screenshots). The empty list and the list-failure cases use a stubbed list answer because the shared test database always holds the programme's starting services.

Not run in this pass: `npm audit`, the load check, a real TLS deployment, an independent penetration test or accessibility audit.
