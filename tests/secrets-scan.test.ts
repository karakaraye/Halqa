import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../scripts/secrets-scan.mjs';

type Finding = { file: string; line: number; pattern: string };
const scanTree = scan as (root: string) => Finding[];

function repository(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'halqa-secrets-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

test('a clean tree passes, including placeholders and code that only names secrets', () => {
  const root = repository({
    'README.md': 'Set HALQA_MESSAGE_WEBHOOK_TOKEN in .env.local.\n',
    '.env.example': '# HALQA_MESSAGE_WEBHOOK_TOKEN=\nHALQA_DB_PATH=data/halqa.sqlite\nAPI_TOKEN=<your token>\n',
    'src/auth.ts': 'const password = hash(input);\ntype Body = { password: string; token: string };\nconst token = process.env.TOKEN;\n',
    'package-lock.json': '{"integrity":"AKIA' + 'ABCDEFGHIJKLMNOP"}\n',
  });
  try {
    assert.deepEqual(scanTree(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('planted fake secrets are reported by file, line and pattern, never by value', () => {
  const header = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
  const awsKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const root = repository({
    'notes/key.txt': `line one\n${header}\nabc\n`,
    'config/aws.txt': `id = ${awsKey}\n`,
    'app/.env': 'X=1\n',
    'prod.env.local': 'unrelated\n',
    'certs/server.pem': 'data\n',
    'data/halqa.sqlite': 'data\n',
    'src/client.ts': `const header = "Bearer ${'a'.repeat(30)}";\n`,
    'deploy.sh': 'export SESSION_SECRET=correct-horse-battery-staple\n',
  });
  try {
    const findings = scanTree(root);
    const has = (file: string, pattern: string, line?: number) => findings.some((f) => f.file === file && f.pattern.startsWith(pattern) && (line === undefined || f.line === line));
    assert.ok(has('notes/key.txt', 'private key block', 2));
    assert.ok(has('config/aws.txt', 'AWS access key', 1));
    assert.ok(has('app/.env', 'environment file'));
    assert.ok(has('certs/server.pem', 'private key file'));
    assert.ok(has('data/halqa.sqlite', 'database file'));
    assert.ok(has('src/client.ts', 'Bearer token', 1));
    assert.ok(has('deploy.sh', 'secret-named variable SESSION_SECRET', 1));
    assert.ok(!findings.some((f) => f.file === 'prod.env.local'));
    assert.ok(!JSON.stringify(findings).includes('correct-horse'), 'the value is never reported');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the command exits 1 on a finding and 0 on a clean tree', () => {
  const script = join(process.cwd(), 'scripts', 'secrets-scan.mjs');
  const run = (cwd: string) => {
    try { execFileSync(process.execPath, [script], { cwd, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status: number }).status; }
  };
  const clean = repository({ 'a.txt': 'hello\n' });
  const dirty = repository({ 'a.txt': 'ghp_' + 'a'.repeat(36) + '\n' });
  try {
    assert.equal(run(clean), 0);
    assert.equal(run(dirty), 1);
  } finally { rmSync(clean, { recursive: true, force: true }); rmSync(dirty, { recursive: true, force: true }); }
});
