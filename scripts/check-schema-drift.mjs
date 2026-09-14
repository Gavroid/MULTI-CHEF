// T17-A tail — schema↔DB drift check.
//
// Runs `prisma migrate diff` between the LIVE database (DATABASE_URL)
// and schema.prisma and fails on any difference that is not one of
// the documented DB-only invariants (see
// packages/database/README.md → "DB-only invariants"): the partial
// UNIQUE one_active_plan, the functional UNIQUE Recipe_title_lower_key
// and the three pg_trgm GIN indexes are invisible to Prisma, so the
// diff shows them as would-be DROPs — that is expected and allowed.
// Anything else (a new column, a missing index, a stray table) fails
// the check so drift cannot accumulate silently.
//
// Usage: DATABASE_URL=postgres://... node scripts/check-schema-drift.mjs
// (safe against any environment whose schema matches the migrations,
// e.g. the multichef_test database).

import { execFileSync } from 'node:child_process';

const ALLOWED_DROPS = new Set([
  'idx_ingredient_canonical_trgm',
  'idx_alias_trgm',
  'Recipe_title_trgm_idx',
]);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('check-schema-drift: DATABASE_URL is required');
  process.exit(1);
}

let diff;
try {
  diff = execFileSync(
    'pnpm',
    [
      '--filter',
      '@multichef/database',
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-url',
      url,
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (err) {
  console.error('check-schema-drift: prisma migrate diff failed');
  if (err.stderr) console.error(String(err.stderr).slice(0, 2000));
  process.exit(1);
}

const statements = diff
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--') && !line.startsWith('#'));

const unexpected = statements.filter((stmt) => {
  const dropIndex = stmt.match(/^DROP INDEX "([^"]+)"/);
  if (dropIndex) return !ALLOWED_DROPS.has(dropIndex[1]);
  return true; // any non-DROP change to the live schema is unexpected
});

if (unexpected.length > 0) {
  console.error('check-schema-drift: schema and database have drifted!');
  for (const stmt of unexpected) console.error('  ' + stmt);
  console.error(
    'If a change is intentional, create a migration (prisma migrate dev) or update packages/database/README.md for new DB-only invariants.',
  );
  process.exit(1);
}

console.log(
  'check-schema-drift: OK — only the documented DB-only invariants differ (prisma cannot model them).',
);
