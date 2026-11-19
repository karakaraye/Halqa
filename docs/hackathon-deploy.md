# Deploy the synthetic demo on Vercel

Use separate hosting for the UI and API. Vercel serves the Next.js pages and rewrites same-origin `/api/*` requests to one long-running Node 24 service. That service owns the SQLite database and runs the existing 15-second worker alongside the API. SQLite, its WAL, and its shared-memory file stay on the same persistent disk. Use a single instance and a dedicated demo disk.

## Deploy

1. Push `codex/hackathon-vercel` to GitHub. Pick a stable HTTPS hostname for the demo. Use this exact scheme and hostname without a trailing slash for `HALQA_ORIGIN` on both services. If using a Vercel preview, use its stable branch alias and grant intended reviewers access to that alias.
2. Run the branch on a Node web service with a persistent disk, such as a paid Render web service. Use Node 24, build with `npm ci --include=dev && npm run build`, start with `npm start`, and set the health check to `/api/health`. For a Render disk mounted at `/var/data`, set `HALQA_DB_PATH=/var/data/halqa.sqlite`. Set `NODE_ENV=production` and `HALQA_ORIGIN` in the service environment. The platform supplies `PORT`.
3. On the API service, set `HALQA_INTAKE_KEY_SHA256` to the SHA-256 hex digest of a privately generated, high-entropy lab key. Keep the raw key in the caller's password manager or secret store. Leave the delivery key, outbound messaging variables, test controls, and proxy trust unset for this demo. With proxy trust unset the API uses the socket address for rate limits, so visitors may share a limit behind the proxy. The email sign-in limit still applies.
4. In the Vercel project, select Next.js and Node 24. Set `HALQA_API_ORIGIN` to the API service's HTTPS origin and `HALQA_ORIGIN` to the demo origin in the Preview environment. Use `npm run build` and enable access to Vercel's system environment variables. Keep the database path and integration credentials on the API service. Deploy the branch through the Git integration or run `vercel deploy` from its checkout. If you chose a custom hostname, point it to this preview with `vercel alias set <deployment-url> <demo-hostname>`. Redeploy the UI when either origin changes. [Vercel preview deployment guide](https://vercel.com/docs/projects/deploy-from-cli)

The origin allowlist is exact. Open the configured hostname to sign in. Use a separate API instance and disk if another environment needs its own public hostname. The origin service serves the API over HTTPS and still enforces the same login, role, CSRF, and integration-key checks for incoming requests.

## Seed and check

Run the seed command once from the app directory in a private shell on the API service with the persistent disk mounted. Confirm `HALQA_DB_PATH` points to the dedicated, empty demo database and keep the printed credentials private.

```sh
env -u HALQA_ORIGIN NODE_ENV=development npm run seed:local
```

The command seeds synthetic cases and staff and patient accounts with random passwords. Its environment overrides apply only to the seed process. If the database already has accounts, seeding exits without resetting them.

1. Open `/api/health` via the Vercel hostname and check for `{"ok":true}`.
2. Sign in as `lead_fatima@halqa.test` using the password printed by the seed command. Check that a seeded case opens and that signing out works. Use a private window to verify that `/api/workspace` requires sign-in.
3. Use the [intake example](api.md#post-apiintakeresults) with a fresh synthetic external ID, the current time in milliseconds, `pcpId: "pcp_mariam"`, and the raw intake key. Send it via the Vercel hostname. Expect 201, then 200 with the same case ID on repeat. The lead can create a patient account for this case.
4. Restart the API service. Confirm that the case still opens and the same intake payload returns the same case ID. Keep the same disk across redeploys. Use the existing [backup procedure](operations.md) to copy a snapshot off the service if needed.

The worker starts with `npm start` and handles escalation, outbox retries, and cleanup. Keep it in the same service as the API. Leave outbound messaging unset for synthetic phone numbers and record contact by phone in the demo UI.
