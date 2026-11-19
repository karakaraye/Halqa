# Host the synthetic Halqa demo

Deploy from `main`. A single Render web service runs the app and the existing worker. For the time-limited demo, free Render Postgres stores the SQLite database between starts. You can open the Render URL directly. A Vercel frontend can also forward requests to the same API.

## Render

1. Create a **Free** Postgres database with external access blocked. Create a **Free** Node web service from the Halqa repository in the same region. Use Node 24, `npm ci --include=dev && npm run build` to build, `npm start` to launch, and `/api/health` for its health check.
2. Set `HALQA_DEMO_REQUIRED=1`. Give the service the database’s **internal** URL as `HALQA_DEMO_POSTGRES_URL` and a randomly generated demo password of at least 24 characters as `HALQA_DEMO_SEED_PASSWORD`. Store both in the service’s secrets. Leave outbound messaging and test controls off. For API intake, set `HALQA_INTAKE_KEY_SHA256` to the SHA-256 hex digest of a new, high-entropy integration key. Keep the raw key private.
3. Open the service’s public HTTPS URL. `/api/health` should return `{"ok":true}`. Sign in as `lead_fatima@halqa.test` with the demo password. On the first successful database operation, Halqa seeds synthetic cases and demo accounts. Existing accounts and their passwords are preserved across restarts.
4. Send a synthetic [intake request](api.md#post-apiintakeresults) twice with the same external ID. Expect 201, then 200 with the same case ID. Restart the service and verify that case still opens and replay returns the same ID.

A Postgres transaction serializes API operations and worker ticks across processes. The web process and worker each work from a temporary SQLite copy. Changes are saved as a single PostgreSQL snapshot before the API responds. Run this mode with one small synthetic workspace and the existing worker. The free service can sleep while idle, and the free database expires after 30 days. Keep real patient information out of this deployment. [Render free-tier limits](https://render.com/docs/free)

## Vercel frontend

1. Use a Next.js project on Node 24, with `npm run build` and access to Vercel’s system environment variables.
2. Choose an exact HTTPS hostname for the Vercel demo. On Vercel, set `HALQA_ORIGIN` to that origin and `HALQA_API_ORIGIN` to the Render service’s HTTPS origin. For the synthetic Postgres-backed deployment, set `HALQA_DEMO_VERCEL_ORIGIN` on Render to the same Vercel origin. This keeps the Render sign-in address available too. For a persistent-disk setup, set `HALQA_ORIGIN` on Render to the Vercel origin instead. Use origin URLs without trailing slashes.
3. Deploy `main` in Vercel and open the configured hostname. Verify `/api/health`, sign in, and open a case. [Vercel deployment guide](https://vercel.com/docs/projects/deploy-from-cli)

For a long-running installation with its own persistent SQLite disk, see [Operations](operations.md).
