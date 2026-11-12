# Halqa data protection

What personal data Halqa holds, where, who can see it, how long it can be kept, how to give a patient their record, and what the operator must decide. It describes the code in this repository; legal decisions are listed at the end for the operator and their data protection officer. Nothing here is legal advice.

## 1. Personal data held, and where

Everything is in one SQLite file (`HALQA_DB_PATH`, default `data/halqa.sqlite`) and in the backups made from it.

| Data | Whose | Table and field | Source |
|---|---|---|---|
| Name, age, sex, phone number, language, preferred channel, interpreter need, nationality (optional), the lab's patient id | Patient | `cases.data` → `patient` | Lab or record system through `POST /api/intake/results` |
| Screening result: programme, finding, result code, urgency, lab, date | Patient (health data) | `cases.data` | Lab |
| Care record: steps and who completed them with notes, referrals and replies, appointments, missed appointments, delay reasons, alerts, closure with evidence reference and plan, quick-check answers and confidence, messages between patient and team and between doctors | Patient (health data), staff names | `cases.data` | Staff and patient through the screens |
| History of every change to a case | Patient, staff | `events` (`case_id`, `user_id`, time, action, detail) | Written automatically with each change |
| Patient messages queued for sending: phone, language, channel, template key, status, attempts, last error | Patient | `outbox` | Written when staff choose a written message |
| Accounts: email, name, role, organisation, licence number, network, linked case (patients), scrypt password hash, first-sign-in flag, disabled time | Staff and patients | `users` | Leads and `npm run user:create` / `npm run setup` |
| Account events: sign-in, sign-out, lock-out, sessions ended, password changed, account and service created or disabled | Staff and patients | `events` with no case | Written automatically |
| Sessions: SHA-256 of the token, CSRF token, expiry, last activity time | Signed-in users | `sessions` | Sign-in; deleted when they end and by the worker |
| Request limits: SHA-256 of rule and client address, counts | Callers | `rate_limits`; sign-in limits keyed by email and client address in `login_limits` | Deleted by the worker after the window |
| Request receipts: user id, request id, payload hash | Staff and patients | `receipts` | Deleted by the worker after 30 days |

Not held: national identity numbers, addresses, payment data, the patient's location. Logs (standard output) hold no personal data: time, route pattern, method, status, error name only.

Sent outside: the worker sends the message service each queued message's phone number, language, channel, template key and the sign-in address, never a diagnosis or result. Nothing else leaves the server.

## 2. Who can see what

Enforced on the server (`src/server/permissions.ts`, `src/server/workspace.ts`), never only by hiding things on screen.

| Who | Sees |
|---|---|
| Navigator | Cases of their network whose navigator is in their organisation (hub), and hand-overs addressed to them |
| Doctor (PCP) | Cases of their network whose doctor is in their organisation, or for which they are accountable |
| Specialist | Cases referred to a receiving service they answer for, or where they are the named specialist |
| Clinic lead | All cases of their network; the account and service lists of their network (never password hashes) |
| Patient | Only their own case, and only once someone has told them: released steps, the names and organisations of their team, their own messages with the team. Never staff notes, alerts, doctors' messages or other people |
| Lab and message service | Nothing to read; they can only add a result or report a delivery |
| Operator with server access | Everything in the file and the backups |

The staff list each screen receives holds names, roles, organisations and licence numbers, never emails.

## 3. How audit entries are protected

- `events` rows are written in the same transaction as the change they describe.
- Database triggers abort any `UPDATE` or `DELETE` on `events` (`Audit events are append-only`); the app has no code path that changes or removes them. A test checks this.
- No screen or route returns the raw `events` table. Staff see a case's own history in the case page (from `cases.data.audit`); the full table is available only to someone with the database file, for example through `npm run export-case`.
- Someone with write access to the file itself can drop the triggers. Protect the file and the backups (disk encryption, file permissions, limited server log-ins).

## 4. Retention options

Halqa deletes on its own only what is technical and short-lived: ended sessions, request-limit rows past their window, receipts older than 30 days. **Cases, accounts, events and outbox rows are kept until the operator removes them.** The operator must set retention periods (section 7). Options:

- **Keep for the legal retention period of health records**, then delete whole cases (see section 6 on audit rows).
- **Disable accounts** of people who leave (sign-in blocked at once, record kept for the audit trail).
- **Backups**: keep and prune them on a written schedule; a deleted case still exists in older backups until those are pruned.

## 5. Exporting one patient's record (subject access)

```sh
npm run export-case -- HQ-1042 --out /secure/place/HQ-1042.json
```

It writes one JSON file with: the case as stored (patient details, result, every step, note, message, referral, appointment, alert and closure), every audit event of the case in order (time, acting user id, action, detail), the messages queued for the patient (phone, language, channel, template, status, attempts, times) and the patient account linked to the case (id, email, name, disabled). It never contains a password hash, a session, a key or another patient's data. It refuses with exit code 1 when the case does not exist and never overwrites an existing file. Without `--out` it prints the JSON. The output contains health data: handle it as the operator's procedure requires, check the requester's identity first, and record the request and the reply.

Staff user ids in the audit events can be matched to names from the Accounts screen if the reply must name them; decide case by case whether staff names are disclosed (section 7).

Covered by `tests/export-case.test.ts` (contents, no secrets, no other patient, refusal for an unknown case, no overwrite, the command's exit codes).

## 6. Deletion and correction

- **Correction**: staff record corrections as new entries (a note, a delay reason, a corrected step through the normal actions). Fields such as the patient's phone number come from the lab; a corrected result should come through the lab system. There is no screen to edit history, by design.
- **Deletion is a database operation**, done by the operator with the app stopped and a backup taken. The app has no delete route. Points to decide and handle:
  - `events` rows are append-only: the triggers must be dropped and recreated by the operator to delete them, and doing so removes the evidence of what happened. Decide whether audit rows are kept (with the case reduced to the minimum) or deleted with it.
  - Deleting a case must also delete its `outbox` rows and the linked patient account (or the account must be disabled first).
  - Backups keep deleted data until they are pruned.
  - Record each deletion: what, when, who, on what authority.
- **Restriction**: disabling the patient account stops the patient's access; staff access to the case continues.

## 7. Decisions the operator must make (with the data protection officer)

1. The lawful basis for processing screening results and contact details, and the condition for processing health data.
2. Who the controller is and whether the message service and the hosting provider are processors; the contracts with them.
3. Retention period for cases, events, outbox rows, accounts and backups, and who carries out deletion.
4. Whether audit rows are deleted or kept when a case is deleted (section 6).
5. Where the server and backups are located and whether any data crosses a border (the message service included).
6. Whether staff names are disclosed in subject-access replies.
7. How patients are told about the processing (privacy notice), in which languages.
8. The breach procedure and notification deadlines (`docs/security.md` section 10).
9. Whether a data protection impact assessment is required (health data at scale usually requires one) and who signs it off.
10. Who may hold server access, and how that access is reviewed.

## 8. Records of processing (template)

Fill in one row per purpose and keep it with the operator's records.

| Field | Entry |
|---|---|
| Controller and contact | |
| Data protection officer | |
| Purpose | Following up screening results until the patient receives care |
| Categories of people | Patients with a screening result; staff of the screening network |
| Categories of data | As in section 1 |
| Recipients | Staff of the network as in section 2; message service (phone number, language, channel) |
| Transfers outside the country | |
| Retention | |
| Security measures | `docs/security.md` |
| Lawful basis and health-data condition | |
