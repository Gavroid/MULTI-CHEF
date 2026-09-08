#!/usr/bin/env node
// @multichef/check-env-coverage
//
// Walks apps/ and packages/, greps for `process.env.<NAME>` and
// `process.env['<NAME>']` references, and verifies every key is listed
// in `.env.example` at the repo root.
//
// Exits 1 if any env key read by the code is missing from .env.example.
// Orphan declarations (declared but unread) are reported but do not fail.
//
// Usage:
//   pnpm run check:env-coverage
//   node scripts/check-env-coverage.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const SCAN_DIRS = ['apps', 'packages'];
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const IGNORE_DIR_NAMES = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage']);
const ENV_EXAMPLE_PATH = resolve(repoRoot, '.env.example');

// 1) Read .env.example and collect declared keys.
function readEnvExample() {
  const text = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const declared = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
      declared.add(key);
    }
  }
  return declared;
}

// 2) Walk apps/ and packages/, collecting every process.env.<KEY> reference.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (stat.isFile()) {
      const lastDot = entry.lastIndexOf('.');
      const ext = lastDot >= 0 ? entry.slice(lastDot) : '';
      if (SCAN_EXTS.has(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}

const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
];

const EXEMPT_KEYS = new Set([
  // Framework-injected or covered through alternative paths. Add to
  // this set only after explicit review — the whole point of the
  // check is to surface these.
]);

function collectReferencedKeys() {
  const referenced = new Set();
  const usages = [];
  for (const dirName of SCAN_DIRS) {
    const absDir = resolve(repoRoot, dirName);
    let stat;
    try {
      stat = statSync(absDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    for (const file of walk(absDir)) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const key = match[1];
          if (EXEMPT_KEYS.has(key)) continue;
          if (!referenced.has(key)) {
            referenced.add(key);
            usages.push({ key, file: relative(repoRoot, file) });
          }
        }
      }
    }
  }
  return { referenced, usages };
}

// 3) Diff and report.
function main() {
  try {
    const declared = readEnvExample();
    const { referenced, usages } = collectReferencedKeys();

    const missing = [...referenced].filter((key) => !declared.has(key)).sort();
    const orphan = [...declared].filter((key) => !referenced.has(key)).sort();

    const lines = [];
    lines.push('env-coverage check (MC-002):');
    lines.push(`  .env.example declares: ${declared.size} keys`);
    lines.push(`  code references:       ${referenced.size} keys`);
    lines.push(`  missing from example:  ${missing.length}`);
    lines.push(`  orphan (declared but unused): ${orphan.length}`);

    if (missing.length > 0) {
      lines.push('');
      lines.push('FAIL: the following keys are read by the code but missing from .env.example:');
      for (const key of missing) {
        const where = usages.find((u) => u.key === key);
        lines.push(`  - ${key}  (used in ${where ? where.file : 'unknown'})`);
      }
      lines.push('');
      lines.push('Add them to .env.example with placeholder values.');
      process.stdout.write(lines.join('\n') + '\n');
      process.exit(1);
    }

    if (orphan.length > 0) {
      lines.push('');
      lines.push('Note: declared but currently unread (will not fail the check):');
      for (const key of orphan) lines.push(`  - ${key}`);
    }

    lines.push('');
    lines.push('OK: 100% of process.env.* references are covered by .env.example.');
    process.stdout.write(lines.join('\n') + '\n');
  } catch (err) {
    process.stderr.write(`env-coverage check failed: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
}

main();
