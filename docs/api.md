# Halqa HTTP routes

This lists every route that is not a screen. All bodies are JSON (`Content-Type: application/json`, at most 32,000 bytes). All answers are JSON with `Cache-Control: no-store`. Errors look like `{"error":"<plain sentence>"}`.

Three kinds of caller:

- **Integration key**: a server-to-server caller sends `Authorization: Bearer <key>`. No cookie and no CSRF token. The server holds only the SHA-256 of the key (`HALQA_INTAKE_KEY_SHA256`, `HALQA_DELIVERY_KEY_SHA256`; up to three comma-separated hashes while a key is replaced, compared in constant time). Not set or not valid on the server: 503. Missing or wrong key: 401.
- **Signed-in user**: the `halqa_session` cookie set by `POST /api/session`. Every write (anything other than GET) must also send the header `x-halqa-csrf` with the `csrf` value from sign-in (compared in constant time), and an `Origin` header equal to `HALQA_ORIGIN` (or the request's own origin when that is not set). Missing or wrong: 403.
- **None**: `GET /api/health`.

While an account still has a temporary password, every signed-in route answers 403 `Set a new password to continue.` except `GET /api/workspace`, `GET /api/session`, `POST /api/account/password`, `DELETE /api/session` and `POST /api/session/revoke-all`.

Per-client request limits (counted in the database). The client is the connection's own address; with `HALQA_TRUST_PROXY=n` it is the `X-Forwarded-For` entry n places from the right, the one the trusted proxies added. A caller cannot choose it (see `docs/operations.md`). Over the limit: 429.

| Route | Limit |
|---|---|
| `POST /api/intake/results` | 120 per minute |
| `POST /api/intake/delivery` | 300 per minute |
| `POST /api/account/password` | 10 per 15 minutes |
| `/api/admin/*` | 60 per minute |
| `GET /api/health` | 600 per minute |
| `POST /api/session` | 100 attempts per client per 15 minutes; and 8 wrong attempts per email and client, then 15 minutes locked |

The examples use `https://halqa.example.org`, a key `$KEY` and a cookie file `jar`.

## GET /api/health

Auth: none. No cookie is read or set.

- 200 `{"ok":true}` after a trivial database read.
- 503 `{"ok":false}` when the read fails.
- 429 when over the limit.

It returns no version, path or setting.

```sh
curl -s https://halqa.example.org/api/health
```

## POST /api/intake/results

Auth: integration key (`HALQA_INTAKE_KEY_SHA256`). Opens one case for one lab result.

Body (no other fields are accepted):

| Field | Type |
|---|---|
| `externalId` | string, 1 to 200 characters. The lab's own identifier for this result. Repeats are recognised by network plus this value |
| `network` | string, 1 to 200 characters. Must match the network of the staff accounts |
| `patient.id`, `patient.name` | string, 1 to 200 characters |
| `patient.age` | whole number, 0 to 130 |
| `patient.sex` | `F` or `M` |
| `patient.phone` | international format, for example `+` then 7 to 15 digits |
| `patient.lang` | `en`, `ar`, `hi` or `ur` |
| `patient.preferredChannel` | `SMS`, `WHATSAPP`, `APP`, `PHONE` or `PORTAL` |
| `patient.needsInterpreter` | optional boolean |
| `patient.nationality` | optional string |
| `pathwayId` | `CRC_FIT`, `BREAST_BIRADS`, `CERVICAL_HPV` or `DIABETES_HBA1C` |
| `finding` | string, 1 to 2000 characters |
| `resultCode` | string, 1 to 200 characters |
| `urgency` | `CRITICAL`, `ELEVATED` or `ROUTINE` |
| `sourceLab` | string, 1 to 200 characters |
| `issuedAt` | whole number, milliseconds since 1970. At most 5 minutes ahead of the server clock |
| `pcpId` | optional. Id of an enabled doctor account in the same network |

Answers:

- 201 `{"caseId":"HQ-1042","created":true}`: a new case. The navigator with the fewest open cases is assigned; the doctor is `pcpId` when given. The patient is not marked as told.
- 200 `{"caseId":"HQ-1042","created":false}`: the same `network` and `externalId` was received before. Nothing changed.
- 401 key missing or wrong. 503 key not set on the server. 429 over the limit.
- 422 the body is missing information or has a value that cannot be accepted, the result is dated in the future, the doctor is not an active doctor of that network, or the network has no staff accounts.

```sh
curl -s -X POST https://halqa.example.org/api/intake/results \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"externalId":"LAB-000123","network":"halqa-network",
       "patient":{"id":"P-77","name":"Patient Name","age":54,"sex":"F","phone":"+10000000000","lang":"en","preferredChannel":"SMS"},
       "pathwayId":"CRC_FIT","finding":"Positive faecal immunochemical test","resultCode":"FIT+",
       "urgency":"ELEVATED","sourceLab":"Laboratory name","issuedAt":1789000000000}'
```

## POST /api/intake/delivery

Auth: integration key (`HALQA_DELIVERY_KEY_SHA256`), a different key from the intake key. The message service reports the final state of a message the worker handed to it.

Body: `{"outboxId": "<id sent to the service>", "status": "DELIVERED" | "FAILED", "error": "<optional text, up to 500 characters>"}`

- 200 `{"ok":true,"status":"DELIVERED"}` (or `FAILED`). `DELIVERED` completes the first care step, attributed to the message service. `FAILED` records a failed attempt.
- A repeat of the same report: 200, nothing changes.
- 409 the message already has the opposite final report.
- 404 no message with that id. 422 missing information. 401, 503, 429 as above.

```sh
curl -s -X POST https://halqa.example.org/api/intake/delivery \
  -H "Authorization: Bearer $DELIVERY_KEY" -H "Content-Type: application/json" \
  -d '{"outboxId":"msg_0000","status":"DELIVERED"}'
```

What the worker sends out is a JSON post to `HALQA_MESSAGE_WEBHOOK_URL` (https only; plain http only to localhost; redirects are not followed; 5-second timeout) with `Authorization: Bearer <HALQA_MESSAGE_WEBHOOK_TOKEN>`: the outbox id (also the idempotency key), channel, language, phone and a template key. It never contains a diagnosis or the result.

## POST /api/session, GET /api/session, DELETE /api/session

- `POST` auth: none (origin is checked). Body `{"email","password"}`. 200 `{"user":{...},"csrf":"..."}` and sets the cookie (HttpOnly, SameSite Strict, Path /, 8 hours, Secure whenever `HALQA_ORIGIN` is an https address). A session the browser already held (its cookie) ends at the same moment. 401 `Email or password is incorrect.` (the same for an unknown email and a disabled account). 429 after 8 wrong attempts for that email from that client (the account's lock is audited once as `SIGN_IN_LOCKED`), or after 100 attempts of any kind from one client in 15 minutes. 422 body not valid.
- `GET` auth: signed in. 200 `{"user":{...},"csrf":"..."}`; 401 when not signed in. `user.mustChangePassword` is true until the first new password is set.
- `DELETE` auth: signed in with CSRF. 200 `{"ok":true}`, ends this session (audited as `SIGN_OUT`) and clears the cookie.

A session ends at the first of: 8 hours after sign-in; `HALQA_SESSION_IDLE_MINUTES` (default 30) with no request at all; sign-out; a password change (all sessions of the account); sign out everywhere; the account being disabled. A visible screen polls every 3 seconds and so counts as activity; the screens stop polling while hidden. The last activity time is written at most once a minute per session. An ended session answers 401 `Please sign in.`

## POST /api/session/revoke-all

Auth: signed in with CSRF (allowed while the password is temporary). No body needed.

- 200 `{"ok":true,"sessions":<number ended>}`. Every session of the signed-in account ends, on every device including this one, and this device's cookie is cleared. Audited as `SESSIONS_REVOKED` with the number of sessions.
- 401 not signed in. 403 CSRF token or origin missing or wrong.

```sh
curl -s -b jar -X POST https://halqa.example.org/api/session/revoke-all   -H "Origin: https://halqa.example.org" -H "x-halqa-csrf: $CSRF"
```

```sh
curl -s -c jar -X POST https://halqa.example.org/api/session \
  -H "Origin: https://halqa.example.org" -H "Content-Type: application/json" \
  -d '{"email":"lead@yourclinic.org","password":"<password>"}'
```

## POST /api/account/password

Auth: signed in with CSRF (allowed while the password is temporary). Body `{"currentPassword","newPassword"}`; the new password has at least 12 characters and differs from the current one.

- 200 `{"ok":true,"user":{...},"csrf":"<new csrf>"}`. Every other session of the account ends, and a fresh cookie is set for this device. The first-sign-in flag is cleared.
- 403 the current password is not correct. 422 the new password is too short or the same. 401 not signed in. 429 over the limit.

```sh
curl -s -b jar -c jar -X POST https://halqa.example.org/api/account/password \
  -H "Origin: https://halqa.example.org" -H "x-halqa-csrf: $CSRF" -H "Content-Type: application/json" \
  -d '{"currentPassword":"<current>","newPassword":"<new password of 12 or more characters>"}'
```

## /api/admin/users

Auth: signed in as a clinic lead (role `LEAD`); others get 403. Works on the lead's own network only.

- `GET /api/admin/users`: 200 `{"accounts":[{id,email,name,role,org,licence?,patientCase?,mustChangePassword,disabled}]}`. Never includes password hashes.
- `POST /api/admin/users` (CSRF): body `{"email","name","role","org","licence"?,"patientCase"?}` where `role` is `NAVIGATOR`, `PCP`, `SPECIALIST`, `LEAD` or `PATIENT`. A patient account needs `patientCase`, the id of a case in the same network that has no patient account yet; other roles must not have it. 201 `{"account":{...},"temporaryPassword":"..."}`: the password is shown once and the account must change it at first sign-in. 409 the email is used (or the case already has a patient account). 422 not valid.
- `POST /api/admin/users/{id}/disable` (CSRF, no body needed but send `{}`): 200 `{"ok":true}`. The account can no longer sign in and its sessions end. 409 when you try to disable yourself. 404 not in your network.

```sh
curl -s -b jar -X POST https://halqa.example.org/api/admin/users \
  -H "Origin: https://halqa.example.org" -H "x-halqa-csrf: $CSRF" -H "Content-Type: application/json" \
  -d '{"email":"navigator@yourclinic.org","name":"Navigator Name","role":"NAVIGATOR","org":"Care hub"}'
```

## /api/admin/services

Auth: signed in as a clinic lead. Receiving services of the lead's network.

- `GET`: 200 `{"services":[{id,facility,specialty,pathway,specialistUserId,specialistName,disabled}]}`, enabled and disabled.
- `POST` (CSRF): body `{"facility","specialty","pathway","specialistUserId"}` (`pathway` as in intake). 201 `{"service":{...}}`. 409 that facility already has a service for that programme. 422 not valid or the specialist is not an enabled specialist of the network.
- `POST /api/admin/services/{id}/disable` (CSRF): 200 `{"ok":true}`. New referrals to it are refused; old ones still read correctly. 404 not in your network.

```sh
curl -s -b jar https://halqa.example.org/api/admin/services
```

## /api/workspace (summary)

This is the route the screens use. It is not an integration point and its action list may change with the screens.

- `GET` auth: signed in (allowed while the password is temporary). 200 a snapshot: the cases the user may see, the staff and receiving-services directory of the network, `revision`, `user`, `csrf`. A patient account receives only its own released journey. Every answer has an `ETag`; send it back as `If-None-Match` and the answer is 304 with no body when nothing changed. The tag depends on the revision, the user, the session's form token, the network's staff and services and a one-minute clock bucket, so it changes at least once a minute; it is checked before any case is read.
- `POST` auth: signed in with CSRF. Body `{"requestId":"<unique id>","revision":<number from the last snapshot>,"action":{"type":"...", ...}}`. The server checks the action against a strict schema and the user's role and case, applies it in one transaction with an audit entry, and returns the new snapshot. The same `requestId` with the same action does not repeat the work; with a different action it is refused. A stale `revision` is refused with 409 (the record changed). Forbidden: 403. Case not visible: 404. Not valid: 422.

## What is logged

The server writes one JSON line to standard output for each failed request (status 400 or above) and each write request: `{"time":"<UTC>","route":"/api/session","method":"POST","status":401,"error":"HttpError"}`. A database fault adds SQLite's fixed result text, for example `"database":"database is locked"`. The route is the pattern, never an id. There are no bodies, emails, tokens or phone numbers in it.
