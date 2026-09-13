// MC-085 — image pipeline (PLAN-2000-RECIPES.md §5.4).
// Renders a branded recipe card image per recipe via ImageMagick:
//   /var/www/multichef-images/recipes/{slug}.webp       (1200x900, q80)
//   /var/www/multichef-images/recipes/{slug}_480.webp   (480x360 cover)
// Idempotent: existing .webp files are skipped unless --force.
// Inputs: data/recipes/gen/*.json + data/recipes/retrofit.json
//
// Usage: node scripts/generate-images.mjs [--force] [--limit N]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FORCE = process.argv.includes('--force');
const li = process.argv.indexOf('--limit');
const LIMIT = li > -1 ? Number(process.argv[li + 1]) : Infinity;

const OUT = '/var/www/multichef-images/recipes';
mkdirSync(OUT, { recursive: true });

const PALETTES = {
  MAIN: ['#EA580C', '#7C2D12'],
  SOUP: ['#0D9488', '#134E4A'],
  BREAKFAST: ['#F59E0B', '#92400E'],
  SALAD: ['#16A34A', '#14532D'],
  SIDE: ['#65A30D', '#365314'],
  DESSERT: ['#DB2777', '#831843'],
  DRINK: ['#2563EB', '#1E3A8A'],
  BAKING: ['#D97706', '#78350F'],
  PREP: ['#64748B', '#334155'],
};
const CATEGORY_RU = {
  MAIN: 'ОСНОВНОЕ БЛЮДО',
  SOUP: 'СУП',
  BREAKFAST: 'ЗАВТРАК',
  SALAD: 'САЛАТ',
  SIDE: 'ГАРНИР',
  DESSERT: 'ДЕСЕРТ',
  DRINK: 'НАПИТОК',
  BAKING: 'ВЫПЕЧКА',
  PREP: 'ЗАГОТОВКА',
};

function wrapTitle(title) {
  const words = title.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 20 && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  if (lines.length > 4) {
    lines.length = 4;
    lines[3] = lines[3].slice(0, 17) + '…';
  }
  return lines;
}

function esc(text) {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '%%').replace(/'/g, '\u2019');
}

function renderCard(slug, title, category) {
  const [c1, c2] = PALETTES[category] ?? PALETTES.MAIN;
  const label = CATEGORY_RU[category] ?? category;
  const lines = wrapTitle(title);
  const main = join(OUT, `${slug}.webp`);
  const thumb = join(OUT, `${slug}_480.webp`);

  const args = [
    '-size',
    '1200x900',
    `gradient:${c1}-${c2}`,
    '-stroke',
    'rgba(255,255,255,0.22)',
    '-strokewidth',
    '46',
    '-fill',
    'none',
    '-draw',
    'circle 600,470 600,105',
    '-fill',
    'rgba(255,255,255,0.93)',
    '-stroke',
    'none',
    '-draw',
    'circle 600,470 600,175',
    '-font',
    'DejaVu-Sans',
    '-pointsize',
    '34',
    '-fill',
    'rgba(255,255,255,0.9)',
    '-gravity',
    'north',
    '-annotate',
    '+0+55',
    esc(label),
    '-font',
    'DejaVu-Sans',
    '-pointsize',
    '54',
    '-fill',
    '#1F2937',
    '-gravity',
    'center',
    '-annotate',
    '+0+10',
    esc(lines.join('\n')),
    '-font',
    'DejaVu-Sans',
    '-pointsize',
    '26',
    '-fill',
    'rgba(255,255,255,0.75)',
    '-gravity',
    'southeast',
    '-annotate',
    '+42+34',
    'MULTI-CHEF',
    '-quality',
    '80',
    main,
  ];
  execFileSync('convert', args, { stdio: 'pipe' });
  execFileSync(
    'convert',
    [
      main,
      '-resize',
      '480x360^',
      '-gravity',
      'center',
      '-extent',
      '480x360',
      '-quality',
      '75',
      thumb,
    ],
    { stdio: 'pipe' },
  );
}

// ---------- collect tasks ----------
const tasks = [];
const genDir = 'data/recipes/gen';
if (existsSync(genDir)) {
  for (const f of readdirSync(genDir)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(readFileSync(join(genDir, f), 'utf8'));
    tasks.push({ slug: f.replace(/\.json$/, ''), title: c.title, category: c.category });
  }
}
if (existsSync('data/recipes/retrofit.json')) {
  const arr = JSON.parse(readFileSync('data/recipes/retrofit.json', 'utf8'));
  for (const c of arr) tasks.push({ slug: c.slug, title: c.title, category: c.category });
}

const todo = tasks.filter((t) => FORCE || !existsSync(join(OUT, `${t.slug}.webp`))).slice(0, LIMIT);
console.log(`images: ${tasks.length} total, ${todo.length} to render`);

// ---------- render with small pool ----------
let done = 0,
  failed = [];
const queue = [...todo];
function worker() {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    try {
      renderCard(t.slug, t.title, t.category);
      done += 1;
      if (done % 250 === 0) console.log(`  rendered ${done}/${todo.length}`);
    } catch (e) {
      failed.push({ slug: t.slug, msg: String(e.message).slice(0, 120) });
    }
  }
}
const POOL = 8;
await Promise.all(Array.from({ length: POOL }, () => worker()));
console.log(`images done: ${done}, failed: ${failed.length}`);
for (const f of failed.slice(0, 10)) console.log('  FAIL', f.slug, f.msg);
