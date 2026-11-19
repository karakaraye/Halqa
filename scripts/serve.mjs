import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const mode = process.argv[2] === 'dev' ? 'dev' : 'start';
const environment = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
if (environment.HALQA_DEMO_REQUIRED === '1' && !environment.HALQA_DEMO_POSTGRES_URL) {
  throw new Error('HALQA_DEMO_POSTGRES_URL is required for the hosted demo.');
}
const localDemoPath = () => path.join(mkdtempSync(path.join(tmpdir(), 'halqa-demo-')), 'halqa.sqlite');
const processEnvironment = () => environment.HALQA_DEMO_POSTGRES_URL
  ? { ...environment, HALQA_DB_PATH: localDemoPath() }
  : environment;
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
// Development runs `next dev`; a built app runs through the Halqa web server, which sets the client address safely.
const appArgs = mode === 'dev' ? [nextBin, 'dev', '--webpack', '-p', process.env.PORT || '3000'] : [path.join(here, 'web.mjs')];
const app = spawn(process.execPath, appArgs, { stdio: 'inherit', env: processEnvironment(), windowsHide: true });
const worker = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'worker.ts')], { stdio: 'inherit', env: processEnvironment(), windowsHide: true });
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; worker.kill(); app.kill(); process.exitCode = code; }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
app.on('exit', (code) => stop(code || 0));
worker.on('exit', (code) => { if (!stopping && code) stop(code); });
