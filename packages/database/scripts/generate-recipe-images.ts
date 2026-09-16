// T54-A (E24): the seeded imageKeys pointed at webp files that never
// existed — every recipe card showed the broken-image fallback. This
// script (1) generates a deterministic branded webp per recipe into the
// image storage root and (2) migrates the DB key from the legacy
// public-path `/images/recipes/<slug>.webp` to the opaque storage key
// `recipes/<slug>.webp`. Resumable: pairs whose file already exists are
// skipped.
//
// Usage: IMAGE_STORAGE_ROOT=/opt/multichef/data/images \
//   pnpm --filter @multichef/database exec tsx scripts/generate-recipe-images.ts
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import { loadServerEnv } from '@multichef/config';

loadServerEnv();

const ROOT = process.env['IMAGE_STORAGE_ROOT'] ?? path.join(process.cwd(), 'data', 'images');

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function slugOf(imageKey: string): string {
  return imageKey.replace(/^\/images\/recipes\//, '').replace(/\.webp$/, '');
}

async function generate(slug: string, title: string, out: string): Promise<void> {
  const h = hash(slug);
  const hueA = h % 360;
  const hueB = (hueA + 40 + (h % 60)) % 360;
  const initial = (title || '?').trim().charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hueA},62%,52%)"/>
      <stop offset="1" stop-color="hsl(${hueB},58%,38%)"/>
    </linearGradient>
  </defs>
  <rect width="512" height="384" fill="url(#g)"/>
  <circle cx="440" cy="60" r="90" fill="rgba(255,255,255,0.12)"/>
  <circle cx="60" cy="330" r="70" fill="rgba(0,0,0,0.10)"/>
  <text x="256" y="240" font-family="DejaVu Sans, sans-serif" font-size="150"
        font-weight="bold" fill="rgba(255,255,255,0.92)" text-anchor="middle">${initial}</text>
</svg>`;
  await mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  await sharp(Buffer.from(svg)).webp({ quality: 78 }).toFile(tmp);
  await rename(tmp, out);
}

async function main(): Promise<void> {
  const recipes = await prisma.recipe.findMany({
    where: { imageKey: { startsWith: '/images/recipes/' } },
    select: { id: true, title: true, imageKey: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`recipes to migrate: ${recipes.length}`);
  let generated = 0;
  let migratedKeys = 0;
  for (const r of recipes) {
    const legacy = r.imageKey as string;
    const slug = slugOf(legacy);
    const key = `recipes/${slug}.webp`;
    const out = path.join(ROOT, key);
    // generate() writes tmp then renames (atomic overwrite);
    // resumability comes from the DB: the WHERE clause only selects
    // legacy keys, so a rerun finds nothing to do.
    await generate(slug, r.title, out);
    generated += 1;
    await prisma.recipe.update({ where: { id: r.id }, data: { imageKey: key } });
    migratedKeys += 1;
    if (migratedKeys % 200 === 0) console.log(`  … ${migratedKeys}`);
  }
  console.log(`done: generated=${generated} keys migrated=${migratedKeys}`);
  await prisma.$disconnect();
}

void main();
