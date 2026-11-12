/**
 * npm run secrets-scan
 *
 * Scans every file tracked by git (except package-lock.json and binary files) for private key blocks,
 * common access-token shapes, assignments of secret-named variables to real-looking values, and tracked
 * files that should never be committed (.env files other than .env.example, database files, .pem and
 * .key files). Prints file:line and the name of the pattern, never the value found. Exit code 1 when
 * anything is found, 0 when the tree is clean.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_PATTERNS = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['Slack token', /\bxox[abeprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/],
];

// A secret-named variable assigned a value: NAME=value (any value), or NAME: "value" / NAME = 'value' (quoted).
// An unquoted NAME: value is skipped because it is how source code declares types and fields.
const ASSIGNMENT = /^\s*(?:export\s+)?["']?([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Za-z0-9_]*)["']?\s*([=:])\s*(.+?)\s*$/i;
const PLACEHOLDER = /^(?:<.*>|\$.*|%.*%|your[-_ ].*|change[-_ ]?me.*|example.*|placeholder.*|replace.*|x{3,}|\*{3,}|\.{3,}|none|null|undefined|true|false|[01])$/i;
// Values that are code, not literals: a call, a member access, an environment lookup, a template.
const CODE_LIKE = /[(){}[\]$`;]|^process\.|^env\./;

const FORBIDDEN_NAMES = [
  ['environment file', (path) => /^\.env/.test(basename(path)) && basename(path) !== '.env.example'],
  ['database file', (path) => /(^|\/)data\/.*\.sqlite/.test(path)],
  ['private key file', (path) => /\.(?:pem|key)$/i.test(path)],
];

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

/** Returns [{ file, line, pattern }]; line is 0 for findings about a file name. */
export function scan(root = process.cwd()) {
  const findings = [];
  for (const file of trackedFiles(root)) {
    for (const [pattern, test] of FORBIDDEN_NAMES) if (test(file)) findings.push({ file, line: 0, pattern });
    if (basename(file) === 'package-lock.json') continue;
    let buffer;
    try { buffer = readFileSync(join(root, file)); } catch { continue; }
    if (isBinary(buffer)) continue;
    const lines = buffer.toString('utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const [pattern, regex] of CONTENT_PATTERNS) if (regex.test(text)) findings.push({ file, line: index + 1, pattern });
      const match = ASSIGNMENT.exec(text);
      if (match) {
        const quoted = /^["'`]/.test(match[3]);
        if (match[2] === ':' && !quoted) return;
        const value = match[3].replace(/^["'`]|["'`,;]*$/g, '').trim();
        if (value && !value.startsWith('#') && !PLACEHOLDER.test(value) && !CODE_LIKE.test(value)) {
          findings.push({ file, line: index + 1, pattern: `secret-named variable ${match[1]} with a value` });
        }
      }
    });
  }
  return findings;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const findings = scan();
  for (const f of findings) console.log(`${f.file}${f.line ? `:${f.line}` : ''}  ${f.pattern}`);
  console.log(findings.length ? `secrets-scan: ${findings.length} finding(s)` : 'secrets-scan: no findings');
  process.exit(findings.length ? 1 : 0);
}
