// MC-003 seed scaffold.
//
// Intentionally a no-op: this file exists so `prisma db seed` has
// something to call. Real content (300 ingredients, 200 recipes, the
// default ingredient categories, demo household, …) lands with
// MC-020 (ingredient import) and MC-031 (recipe seed).
//
// ADR-0007 / DEVELOPMENT-PLAN §0 MC-003 — decision Q4.

async function main(): Promise<void> {
  console.log('seed: empty (MC-020/MC-031 will add data)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
