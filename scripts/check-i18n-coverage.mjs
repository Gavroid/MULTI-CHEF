// T46-B (E23): i18n coverage gate — 100% of dictionary keys must be
// referenced from web code, and every t('key') must exist in the
// dictionary. Regex-based on purpose: zero deps, runs anywhere.
//
//   node scripts/check-i18n-coverage.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DICT = join(ROOT, 'apps/web/src/i18n/ru.ts');
const SRC = join(ROOT, 'apps/web/src');

// --- parse the dictionary (two-level: namespace.key) ---
const dictSrc = readFileSync(DICT, 'utf-8');
const dictKeys = new Set();
let ns = null;
for (const line of dictSrc.split('\n')) {
  const nsM = line.match(/^  (\w+): \{/);
  if (nsM) {
    ns = nsM[1];
    continue;
  }
  if (ns && /^  \}/.test(line)) {
    ns = null;
    continue;
  }
  const keyM = ns && line.match(/^    (\w+):/);
  if (keyM) dictKeys.add(`${ns}.${keyM[1]}`);
}

// --- walk web src ---
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|ts)$/.test(name) && !p.includes('__tests__')) yield p;
  }
}

const used = new Set();
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf-8');
  // which namespace each t belongs to
  const nsByVar = {};
  for (const m of src.matchAll(/useTranslations\(['"](\w+)['"]\)/g)) {
    nsByVar[`t`] = m[1];
    nsByVar[`${m[1]}_t`] = m[1];
  }
  for (const m of src.matchAll(/\bt\(['"](\w+)['"]\s*[,)]/g)) {
    const ns = nsByVar['t'];
    if (ns) used.add(`${ns}.${m[1]}`);
  }
}

const missing = [...used].filter((k) => !dictKeys.has(k)).sort();
const unused = [...dictKeys].filter((k) => !used.has(k)).sort();

if (missing.length || unused.length) {
  if (missing.length) console.error('MISSING in dictionary:\n  ' + missing.join('\n  '));
  if (unused.length) console.error('UNUSED dictionary keys:\n  ' + unused.join('\n  '));
  process.exit(1);
}
console.log(`i18n coverage OK: ${dictKeys.size} keys, 100% used`);
