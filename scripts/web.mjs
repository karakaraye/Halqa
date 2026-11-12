/**
 * The Halqa web server: serves the built app (run `npm run build` first) on PORT.
 *
 * It exists for one reason: request limits and the sign-in limit must key on an
 * address the caller cannot choose. Unless HALQA_TRUST_PROXY names how many
 * reverse proxies to trust, this server replaces any X-Forwarded-For header with
 * the address of the connection before the app sees it. With HALQA_TRUST_PROXY
 * set, the header is passed on and the app reads the entry its proxies added
 * (src/server/rate-limit.ts).
 *
 * Optional: HALQA_LISTEN_HOST (for example 127.0.0.1 behind a proxy on the same
 * machine). Default: every interface, as `next start` does.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env.local'))) process.loadEnvFile(path.join(root, '.env.local'));
process.env.NEXT_TELEMETRY_DISABLED ??= '1';

/** Same rule as trustedProxyHops() in src/server/rate-limit.ts. */
export function trustedProxyHops(value) {
  const hops = Number(String(value ?? '').trim() || '0');
  return Number.isInteger(hops) && hops >= 1 && hops <= 5 ? hops : 0;
}

/** Puts the connection's own address in X-Forwarded-For unless proxies are trusted. */
export function setClientAddress(request, hops = trustedProxyHops(process.env.HALQA_TRUST_PROXY)) {
  if (!hops) request.headers['x-forwarded-for'] = request.socket.remoteAddress ?? '';
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HALQA_LISTEN_HOST || undefined;
  const app = next({ dev: false, dir: root, port, hostname: host ?? 'localhost' });
  const handle = app.getRequestHandler();
  await app.prepare();
  const server = createServer((request, response) => {
    setClientAddress(request);
    handle(request, response).catch(() => {
      if (!response.headersSent) { response.statusCode = 500; response.setHeader('content-type', 'application/json'); }
      response.end(JSON.stringify({ error: 'The service could not complete the request.' }));
    });
  });
  server.listen(port, host, () => console.log(`Halqa is listening on port ${port}${host ? ` (${host})` : ''}.`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) main().catch((error) => { console.error('Halqa could not start:', error instanceof Error ? error.message : 'unknown error'); process.exit(1); });
