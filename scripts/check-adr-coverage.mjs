#!/usr/bin/env node
// @multichef/check-adr-coverage
//
// Verifies that docs/decisions/ contains all 13 required ADRs
// (ADR-0001..ADR-0013) and that docs/api/conventions.md covers
// the 6 mandatory sections (Errors, Pagination, Idempotency,
// Timestamp, ID format, Money).
//
// Exits 1 if any required artefact is missing.
//
// Usage:
//   pnpm run check:adr-coverage
//   node scripts/check-adr-coverage.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const REQUIRED_ADRS = Array.from({ length: 13 }, (_, i) => {
  const n = String(i + 1).padStart(4, '0');
  return `ADR-${n}`;
});

const REQUIRED_CONVENTIONS_SECTIONS = [
  { name: 'Errors', pattern: /##\s+1\.\s+Формат ошибок|^#\s*Errors/im },
  { name: 'Pagination', pattern: /##\s+2\.\s+Пагинация|^#\s*Pagination/im },
  { name: 'Idempotency', pattern: /##\s+3\.\s+Идемпотентность|^#\s*Idempotency/im },
  { name: 'Timestamp', pattern: /##\s+4\.\s+Timestamp|^#\s*Timestamp/im },
  { name: 'ID format', pattern: /##\s+5\.\s+ID format|^#\s*ID format/im },
  { name: 'Money', pattern: /##\s+6\.\s+Money|^#\s*Money/im },
];

const ADR_DIR = resolve(repoRoot, 'docs/decisions');
const CONVENTIONS_PATH = resolve(repoRoot, 'docs/api/conventions.md');

let failures = 0;

function fail(msg) {
  console.error(`  ❌ ${msg}`);
  failures += 1;
}

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}

// 1) Проверяем наличие всех 13 ADR
console.log('=== ADR presence (ADR-0001..ADR-0013) ===');
let adrFiles = [];
try {
  adrFiles = readdirSync(ADR_DIR);
} catch (err) {
  console.error(`Cannot read ${ADR_DIR}: ${err.message}`);
  process.exit(1);
}

for (const required of REQUIRED_ADRS) {
  const found = adrFiles.some((f) => f.startsWith(required + '-') || f === required + '.md');
  if (found) {
    pass(`${required} present`);
  } else {
    fail(`${required} missing in docs/decisions/`);
  }
}

// 2) Проверяем формат каждого ADR (5 обязательных секций)
console.log('\n=== ADR format (5 sections each) ===');
const REQUIRED_SECTIONS = ['Status', 'Date', 'Context', 'Decision', 'Consequences'];

for (const required of REQUIRED_ADRS) {
  const file = adrFiles.find((f) => f.startsWith(required + '-'));
  if (!file) continue; // уже зафейлили выше
  const content = readFileSync(join(ADR_DIR, file), 'utf8');
  const missing = REQUIRED_SECTIONS.filter((s) => !new RegExp(`^##\\s+${s}\\s*$`, 'm').test(content));
  if (missing.length === 0) {
    pass(`${required} has all 5 sections`);
  } else {
    fail(`${required} (${file}) missing sections: ${missing.join(', ')}`);
  }
}

// 3) Проверяем conventions.md
console.log('\n=== API conventions coverage ===');
let conventionsContent = '';
try {
  conventionsContent = readFileSync(CONVENTIONS_PATH, 'utf8');
} catch (err) {
  fail(`Cannot read ${CONVENTIONS_PATH}: ${err.message}`);
  process.exit(1);
}

for (const section of REQUIRED_CONVENTIONS_SECTIONS) {
  if (section.pattern.test(conventionsContent)) {
    pass(`conventions.md has "${section.name}" section`);
  } else {
    fail(`conventions.md missing section "${section.name}"`);
  }
}

console.log('\n' + '='.repeat(60));
if (failures === 0) {
  console.log('OK: All 13 ADRs present with correct format; conventions.md covers all 6 sections.');
  process.exit(0);
} else {
  console.log(`FAIL: ${failures} check(s) failed.`);
  process.exit(1);
}
