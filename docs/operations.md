# Running Halqa

This is for the person who hosts it. Everything here was written against the code in this repository. What was run, and when, is stated where it matters; anything not run says so.

## Requirements

- Node.js 24 or later (the database is Node's built-in SQLite module; `package.json` requires `>=24`).
- One server with a writable disk that keeps its data (not temporary storage). The database is one SQLite file.
- A reverse proxy that terminates HTTPS in front of the app.
- Outbound access to the message service only if messages are sent (`HALQA_MESSAGE_WEBHOOK_URL`).

## First-time setup

```sh
npm ci
npm run build
npm run setup -- --email lead@yourclinic.org --name "Lead Name" --org "Your Organisation" [--licence <licence>]
```

`setup` creates the database and the first clinic lead in the network `halqa-network`, and nothing else: no cases, no other accounts. It prints a temporary password once; it is not saved anywhere, and the lead must choose a new password at first sign-in. `setup` stops with exit code 1 if any account already exists. All other accounts come from the Accounts screen or `npm run user:create -- --email --name --role --org [--licence] [--network] [--patient-case]`.

`npm run seed:local` fills a database with local development records for trying the screens. It refuses to run when `NODE_ENV=production` or when `HALQA_ORIGIN` is an https address. Do not use it on a live service.

## Configuration

Set these in `.env.local` next to `package.json` (read by `npm start`, `npm run dev` and the scripts) or in the service's environment. `.env.example` has the same list with descriptions. None of these is a secret except the webhook token.

| Variable | What it does | Default |
|---|---|---|
| `HALQA_DB_PATH` | Path of the SQLite file | `data/halqa.sqlite` |
| `HALQA_ORIGIN` | Exact public origin, no trailing slash. Turns on secure cookies and strict transport security, is the only origin accepted on writes, and is the patient sign-in link. Set it for `npm run build` too: strict transport security is fixed when the app is built | the request's own origin |
| `HALQA_INTAKE_KEY_SHA256` | SHA-256 (hex) of the lab system's key; up to three, comma-separated, while a key is replaced | unset: intake answers 503 |
| `HALQA_DELIVERY_KEY_SHA256` | SHA-256 (hex) of the message service's report key (use a different key); up to three while replacing | unset: reports answer 503 |
| `HALQA_MESSAGE_WEBHOOK_URL` | Where the worker posts queued messages. Must be https; plain http only to localhost. Any other address: nothing is sent and the worker logs `WebhookAddressRefused` | unset: messages stay queued |
| `HALQA_MESSAGE_WEBHOOK_TOKEN` | Bearer token the worker sends to that address | unset: messages stay queued |
| `HALQA_TRUST_PROXY` | Number of reverse proxies (1 to 5) that add the caller's address to `X-Forwarded-For`. Unset or 0: the header is ignored and the connection address is used | unset |
| `HALQA_LISTEN_HOST` | Address the web server listens on, for example `127.0.0.1` behind a proxy on the same machine | every address |
| `HALQA_SESSION_IDLE_MINUTES` | Minutes without any request before a session ends (1 to 480); sessions always end 8 hours after sign-in | `30` |
| `NEXT_PUBLIC_HALQA_TIME_ZONE` | Time zone of every date and time on screen (IANA name). Read at `npm run build` | each browser's own |
| `PORT` | Port of the web server | `3000` |
| `NODE_ENV` | `production` on a live service; always refuses test controls and `seed:local` | set by `npm start` |
| `HALQA_TEST_CONTROLS` | `1` lets automated tests move the clock. Never on a live service | `0` |
| `NEXT_TELEMETRY_DISABLED` | `1` stops Next.js usage reports (the launcher sets it) | `1` via the launcher |

Make a key hash with: `node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "<key>"`. Give the key itself only to the caller; the server never needs it.

## Running the app and the worker

The app and the worker are two processes using the same database file.

- The app: `npm start` (runs `scripts/serve.mjs`, which starts the Halqa web server `scripts/web.mjs` on `PORT` and also starts the worker as a child process).
- The web server alone: `node scripts/web.mjs`. It serves the built app like `next start` and, unless `HALQA_TRUST_PROXY` is set, replaces any `X-Forwarded-For` header with the address of the connection, so callers cannot choose the address that request limits and the sign-in lock count against. **Do not run `next start` directly on a live service**: it would pass a caller's header through.
- The worker alone: `node --import tsx scripts/worker.ts`. Every 15 seconds it raises alerts that are due, sends queued patient messages, and cleans up (see Housekeeping).

For a service manager, prefer running them as two services so a restart of one does not stop the other. Example for systemd (adjust paths and user):

```ini
# /etc/systemd/system/halqa-web.service
[Service]
WorkingDirectory=/srv/halqa
EnvironmentFile=/srv/halqa/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/bin/node scripts/web.mjs
Restart=always
User=halqa

# /etc/systemd/system/halqa-worker.service
[Service]
WorkingDirectory=/srv/halqa
EnvironmentFile=/srv/halqa/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --import tsx scripts/worker.ts
Restart=always
User=halqa
```

These unit files were not run on a Linux host while writing this document; check them on yours. Run one copy of each only (see Limits).

On Windows, **Start Halqa.cmd** starts the app and worker with `npm run dev` when `data\halqa.sqlite` exists, and otherwise prints the setup command.

## HTTPS and the exact origin

Put the app behind a reverse proxy that serves HTTPS and forwards to `http://127.0.0.1:3000`. Set `HALQA_ORIGIN` to the public address exactly as users type it, for example `https://halqa.yourclinic.org`. Then:

- cookies are marked Secure and strict transport security is sent;
- a write whose `Origin` header differs from it is refused with 403;
- the patient message link uses it.

Request limits and the sign-in lock count per client address, so the address must not be something a caller can choose:

- **Nothing in front of the app**: leave `HALQA_TRUST_PROXY` unset. The Halqa web server replaces any `X-Forwarded-For` with the connection's own address.
- **One reverse proxy** (the usual case): set `HALQA_TRUST_PROXY=1`, have the proxy add the caller's address to `X-Forwarded-For` (for nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` or `$remote_addr`), and make the app reachable only through the proxy (`HALQA_LISTEN_HOST=127.0.0.1` when on the same machine, or a firewall). The app uses the right-most entry, the one the proxy added; anything the caller sent is to its left and ignored.
- **A chain** (for example a content network and then nginx): set `HALQA_TRUST_PROXY` to the number of proxies; the app takes the entry that many places from the right.

With `HALQA_ORIGIN` set to an https address, `Strict-Transport-Security: max-age=31536000` is sent, but only if `HALQA_ORIGIN` was also set when `npm run build` ran (Next.js fixes these headers at build time). The page's content security policy carries a fresh script nonce per response and is set when the request is served (`src/proxy.ts`). Exact header values are in `docs/security.md` section 7.

## Housekeeping

Each worker cycle, in one transaction, deletes sessions past their expiry or idle for longer than `HALQA_SESSION_IDLE_MINUTES`, request receipts older than 30 days, and request-limit and sign-in-limit rows past their reset time. This is covered by tests (`tests/operations.test.ts`, `tests/session-hardening.test.ts`). The alert scan reads every case without holding the write lock and saves only the cases whose alerts change, 50 per transaction.

## Patient records: export and deletion

`npm run export-case -- <caseId> --out <file>` writes one case, its audit events, its queued messages and its linked patient account as JSON for a subject-access request (no password hash or session; refuses an unknown case; never overwrites). What is held, who can see it, retention and deletion are in `docs/data-protection.md`. Threats, controls and the incident procedure are in `docs/security.md`.

## Backups and restore

Make a backup (safe while the app and worker run):

```sh
npm run backup -- /path/to/backup-directory
```

It uses SQLite `VACUUM INTO`, creates the directory if needed, writes `halqa-<UTC timestamp>.sqlite` (for example `halqa-20261111T234403Z.sqlite`), prints the path, never overwrites an existing file and exits with a non-zero code on failure. Schedule it (for example hourly with cron or Task Scheduler), copy the files off the server, and encrypt the disk or volume that holds the database and the backups; the files contain patient data. Keep and prune on your own retention rule.

Restore:

1. Stop the app and the worker.
2. Move the damaged database aside: the file at `HALQA_DB_PATH` and any `-wal` and `-shm` files next to it.
3. Copy the chosen backup to the `HALQA_DB_PATH` location, named as that path says (for example `data/halqa.sqlite`).
4. Start the worker and the app. Opening the file applies any newer schema changes automatically.
5. Check: `GET /api/health` answers `{"ok":true}`, and a lead can sign in and sees the expected cases.

Sessions are not part of what you need to keep: after a restore everyone signs in again if their session is gone, and nothing else depends on them.

**Restore drill, run on 11 November 2026 (Windows, Node 24):** seeded a database with `npm run seed:local`, ran `npm run backup -- <directory>`, then compared the live file and the backup with read-only queries: both had 68 cases and 22 accounts and `PRAGMA integrity_check` returned `ok`. Copying the backup to a new `HALQA_DB_PATH` and opening it with the app's own database code reported schema version 4. The automated test `tests/operations.test.ts` ("backup writes a standalone copy ...") does the same on every run: it backs up a populated database, removes the original, opens the copy, checks the case count and that the sign-in hash verifies without any session, and checks that a second backup with the same name is refused. The step of stopping and starting a live service was not rehearsed on a real host.

## Monitoring

- `GET /api/health` needs no sign-in. 200 `{"ok":true}` means the database can be read; 503 `{"ok":false}` means it cannot. Point an uptime check at it (it allows 600 calls a minute per client). It does not show whether the worker is running.
- Logs: the app writes one JSON line to standard output for each failed request and each write request: time, route, method, status, error name and, for a database fault, SQLite's fixed result text (for example `"database":"database is locked"`). Nothing else: no bodies, emails, tokens or phone numbers. Alert on a run of `"status":500` or `503`, on any `"database"` field, or on many `401` lines for `/api/session` (wrong passwords) and `429` lines. Messages from the worker (`Escalation scan could not complete`, `Message delivery could not complete`, `Cleanup could not complete`) go to standard error and show only an error name; `Message delivery could not complete: WebhookAddressRefused` means the message address is not https.
- Audit: `SIGN_IN_LOCKED` events in the `events` table show accounts that reached the wrong-password limit.
- Watch the worker separately: if it stops, due alerts are not raised and queued messages are not sent. Have the service manager restart it and alert on restarts.
- Disk space of the volume holding the database and backups.

## Key rotation

Rotation replaces a key on both sides without a gap: each key variable accepts up to three hashes separated by commas, and any of them is accepted.

- **Intake key** (lab system to Halqa): make a new random key and compute its SHA-256. Set `HALQA_INTAKE_KEY_SHA256=<old hash>,<new hash>` and restart the web service. Give the new key to the lab system. When the lab confirms it uses the new key, set the variable to the new hash alone and restart; the old key then gets 401.
- **Delivery key** (message service to Halqa): the same with `HALQA_DELIVERY_KEY_SHA256`.
- **Suspected leak**: set the variable to the new hash alone straight away; the old key stops at the restart.
- **Webhook token** (Halqa to message service): get a new token from the message service, set `HALQA_MESSAGE_WEBHOOK_TOKEN`, restart the worker. Queued messages wait and are retried.
- Use a different key for each; do not reuse one across them. Keep keys only in `.env.local` or the service's secret store, never in the repository.

## Upgrading

1. Make a backup (above).
2. Stop the worker and the app.
3. Get the new code, then `npm ci` and `npm run build`.
4. Start the worker and the app. Schema changes are applied in order, each in its own transaction, the first time the database is opened (`PRAGMA user_version` records the step), so the app and the worker can start together safely.
5. Check `GET /api/health` and sign in.

To go back, stop everything, restore the backup from step 1 and start the previous code.

## Limits and the path to a shared database

- One server, one SQLite file, one app process and one worker. Do not run several copies or put the file on a shared network disk or temporary storage: the sign-in limit, request limits and revision checks rely on one database file.
- SQLite is in WAL mode with a 5-second wait for locks; writes on the read path (session activity) never wait and are skipped when the file is busy. `npm run load-check` measures one network of 2,000 cases with 50 polling staff clients; results of the runs made are in `VERIFICATION.md`. Run it on your own server before going live (`npm run build` first; `--duration 300` for five minutes).
- To grow beyond one server, move the data layer in `src/server/db.ts` and the SQL in `src/server/*.ts` to a shared database (for example PostgreSQL), keeping the same tables and the migration steps in order, and run several app processes behind the proxy with one worker. This has not been built.
