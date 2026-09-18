// MC-085 — recipe card generator engine (PLAN-2000-RECIPES.md §5.3).
// Deterministic: same --seed => same dataset. Every written card passed
// the validator. Output: data/recipes/gen/<slug>.json, data/recipes/waves.json
//
// Usage: node scripts/generate-recipes.mjs [--seed 42] [--target 1731]

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCard, slugify, buildTags } from './lib/recipe-validator.mjs';
import { WF } from './lib/dish-blueprints.mjs';
import { FAMILIES } from './lib/dish-families.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const SEED = arg('--seed', 42);
const TARGET = arg('--target', 1731);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pickArr = (arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- catalog ----------
const catalogRaw = JSON.parse(readFileSync('data/catalog.json', 'utf8'));
const nutritionRaw = JSON.parse(readFileSync('data/nutrition.json', 'utf8'));
const catalog = new Map(catalogRaw.map((x) => [x.name, x]));
const nutrition = new Map(nutritionRaw.map((x) => [x.name, x]));

function byRole(role) {
  const out = [];
  for (const [name, wf] of Object.entries(WF)) {
    if (wf && wf.role === role && catalog.has(name) && nutrition.has(name)) {
      out.push({ name, ...wf });
    }
  }
  return out;
}

// ---------- slot resolution ----------
// spec: ['role']            -> pool of single items
//       ['role','role',...] -> pool of DISTINCT item arrays (length = roles count)
//       {fixed:[names]}     -> pool of single items from the fixed list
function slotVariants(spec) {
  if (Array.isArray(spec)) {
    const unique = [...new Set(spec)];
    if (unique.length === 1) {
      // repeated same role -> array of N distinct items
      const pool = byRole(unique[0]);
      if (spec.length === 1) return pool;
      let combos = [{}];
      for (let i = 0; i < spec.length; i++) {
        const next = [];
        for (const c of combos) {
          const used = Object.values(c).map((x) => x.name);
          for (const it of pool) {
            if (used.includes(it.name)) continue;
            next.push({ ...c, [Object.keys(c).length]: it });
          }
        }
        combos = next;
      }
      return combos.map((c) => Object.values(c));
    }
    // different roles in one key -> union pool, single item
    const pool = [];
    for (const role of spec) pool.push(...byRole(role));
    return pool;
  }
  if (spec && Array.isArray(spec.fixed)) {
    return spec.fixed
      .filter((n) => catalog.has(n) && nutrition.has(n) && WF[n])
      .map((n) => ({ name: n, ...WF[n] }));
  }
  if (spec && Array.isArray(spec.fixedAll)) {
    const items = spec.fixedAll
      .filter((n) => catalog.has(n) && nutrition.has(n) && WF[n])
      .map((n) => ({ name: n, ...WF[n] }));
    return items.length > 0 ? [items] : [];
  }
  throw new Error(`bad slot spec: ${JSON.stringify(spec)}`);
}

function cartesian(pools) {
  const keys = Object.keys(pools);
  let acc = [{}];
  for (const key of keys) {
    const next = [];
    for (const combo of acc) {
      for (const variant of pools[key]) {
        next.push({ ...combo, [key]: variant });
      }
    }
    acc = next;
  }
  return acc;
}

function comboCount(pools) {
  let n = 1;
  for (const p of Object.values(pools)) n *= Math.max(1, p.length);
  return n;
}

// Build up to `count` combos: full cartesian when small, otherwise random
// sampling (deterministic via seeded rng) with per-card ingredient dedup.
function buildCombos(pools, count) {
  const keys = Object.keys(pools);
  if (keys.some((k) => !Array.isArray(pools[k]) || pools[k].length === 0)) return [];
  const total = comboCount(pools);
  if (total <= count) {
    let acc = [{}];
    for (const key of keys) {
      const next = [];
      for (const c of acc) for (const v of pools[key]) next.push({ ...c, [key]: v });
      acc = next;
    }
    return shuffle(acc);
  }
  const out = [];
  const seen = new Set();
  let guard = count * 60;
  while (out.length < count && guard-- > 0) {
    const c = {};
    for (const key of keys) c[key] = pickArr(pools[key]);
    const names = keys.flatMap((k) =>
      Array.isArray(c[k]) ? c[k].map((x) => x.name) : [c[k].name],
    );
    if (new Set(names).size !== names.length) continue;
    const sig = names.slice().sort().join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(c);
  }
  return out;
}

// ---------- card assembly ----------
const KCAL_WINDOW = {
  MAIN: [250, 900],
  SOUP: [130, 600],
  BREAKFAST: [150, 800],
  SALAD: [80, 500],
  SIDE: [130, 500],
  DESSERT: [80, 600],
  DRINK: [5, 500],
  BAKING: [200, 700],
  PREP: [60, 800],
};

function gramsFor(item, servings) {
  if (item.unit === 'PIECE') {
    const pieces = Math.max(1, Math.round((item.gps * servings) / 55));
    return { grams: pieces * 55, quantity: pieces };
  }
  return { grams: Math.round(item.gps * servings), quantity: Math.round(item.gps * servings) };
}

function computeKcal(items, servings) {
  let kcal = 0,
    p = 0,
    f = 0,
    c = 0;
  for (const it of items) {
    const n = nutrition.get(it.name);
    if (!n) continue;
    const k = it.grams / 100;
    kcal += n.kcal * k;
    p += n.protein * k;
    f += n.fat * k;
    c += n.carbs * k;
  }
  return { kcal: kcal / servings, p: p / servings, f: f / servings, c: c / servings };
}

function fitKcal(items, servings, cat) {
  const [lo, hi] = KCAL_WINDOW[cat] ?? [120, 900];
  let cur = items;
  for (let i = 0; i < 3; i++) {
    const m = computeKcal(cur, servings);
    if (m.kcal >= lo && m.kcal <= hi) return { items: cur, macro: m };
    const mid = (lo + hi) / 2;
    const factor = Math.min(1.4, Math.max(0.6, m.kcal > 0 ? mid / m.kcal : 1));
    cur = items.map((it) => ({ ...it, grams: Math.max(1, Math.round(it.grams * factor)) }));
  }
  const m = computeKcal(cur, servings);
  return m.kcal >= lo && m.kcal <= hi ? { items: cur, macro: m } : null;
}

function dietsOf(items) {
  const names = items.map((i) => i.name);
  const hasMeat = items.some((i) => MEAT_ROLES.has(i.role));
  const hasAnimal = items.some((i) => ANIMAL.has(i.role)) || names.includes('мёд');
  const hasGluten = names.some((n) => GLUTEN.has(n));
  const d = [];
  if (!hasMeat) d.push('VEGETARIAN');
  if (!hasMeat && !hasAnimal) d.push('VEGAN');
  if (!hasGluten) d.push('GLUTEN_FREE');
  return d;
}

function seasonOf(items) {
  const specific = items.map((i) => i.season).filter((s) => s && s !== 'ALL_YEAR');
  return specific.length > 0 ? specific[0] : 'ALL_YEAR';
}

function difficultyOf() {
  const r = rng();
  return r < 0.5 ? 1 : r < 0.83 ? 2 : 3;
}

const CUISINES = ['русская', 'домашняя', 'европейская', 'американская'];
const GLUTEN = new Set([
  'мука пшеничная',
  'мука ржаная',
  'хлеб белый',
  'хлеб чёрный',
  'багет',
  'батон',
  'круассан',
  'макароны',
  'спагетти',
  'пенне',
  'фузилли',
  'лапша яичная',
  'лапша удон',
  'перловка',
  'сухари панировочные',
  'крахмал картофельный',
]);
const ANIMAL = new Set(['dairy', 'cheese', 'egg']);
const MEAT_ROLES = new Set(['meat', 'bird']);

// ---------- existing titles ----------
const seenTitles = new Set();
const existingPath = 'data/existing-titles.json';
if (existsSync(existingPath)) {
  for (const t of JSON.parse(readFileSync(existingPath, 'utf8')))
    seenTitles.add(t.trim().toLowerCase());
}

// ---------- main loop ----------
const outDir = 'data/recipes/gen';
mkdirSync(outDir, { recursive: true });

const written = [];
const rejected = [];
const writtenSlugs = new Set();

let pass = 0;
let familyQueues = null;
while (written.length < TARGET && pass < 6) {
  if (!familyQueues || familyQueues.length === 0) {
    pass += 1;
    familyQueues = FAMILIES.map((f) => ({ f, combos: null, idx: 0, made: 0 }));
    for (const q of familyQueues) {
      const pools = {};
      for (const [key, spec] of Object.entries(q.f.slots)) pools[key] = slotVariants(spec);
      q.combos = buildCombos(pools, q.f.n * 200);
      q.idx = 0;
    }
    console.log(
      `pass ${pass}: families=${familyQueues.length}, combo sizes=${familyQueues.map((q) => q.combos.length).join(',')}`,
    );
  }

  const beforeSweep = written.length;
  for (const q of familyQueues) {
    if (written.length >= TARGET) break;
    while (q.idx < q.combos.length && q.made < q.f.n) {
      if (written.length >= TARGET) break;
      const combo = q.combos[q.idx++];
      const s = combo;
      const flat = Object.values(combo).flat();
      const names = flat.map((x) => x.name);
      if (new Set(names).size !== names.length) continue;

      const servings = int(2, 6);
      let withGrams = flat.map((it) => ({ ...it, ...gramsFor(it, servings) }));
      // portion pre-fit (D5): scale to the window if out of range
      {
        const [plo, phi] = q.f.cat === 'DRINK' ? [150, 400] : [100, 800];
        const totalG = withGrams.reduce((sum, it) => sum + it.grams, 0);
        const portion = totalG / servings;
        const target = portion < plo ? plo * 1.15 : portion > phi ? phi * 0.9 : null;
        if (target) {
          const f2 = target / portion;
          withGrams = withGrams.map((it) => ({
            ...it,
            grams: Math.max(1, Math.round(it.grams * f2)),
          }));
        }
      }
      const fit = fitKcal(withGrams, servings, q.f.cat);
      if (!fit) continue;
      withGrams = fit.items;
      const macro = fit.macro;

      // MC-200 stage 3: family build() templates render quantities from
      // the slot items — push the final grams back (previously the slots
      // had no grams yet, so step text leaked «NaN г»/«undefined г»).
      const finalByName = new Map(withGrams.map((it) => [it.name, it]));
      for (const it of flat) {
        const g = finalByName.get(it.name);
        if (!g) continue;
        it.grams = g.grams;
        it.quantity = g.quantity;
        const unit = it.unit ?? catalog.get(it.name)?.unit ?? 'G';
        it.label =
          unit === 'ML'
            ? `${g.grams} мл`
            : unit === 'PIECE'
              ? `${g.quantity} шт (≈${g.grams} г)`
              : `${g.grams} г`;
      }

      const title = q.f.title(s);
      const titleKey = title.trim().toLowerCase();
      if (seenTitles.has(titleKey)) continue;

      const built = q.f.build(s, int);
      // step enrichment (D4): guarantee total length and at least one number
      {
        const totalLen = built.steps.join('').length;
        const hasDigit = built.steps.some((x) => /\d/.test(x));
        if (totalLen < 340 || !hasDigit) {
          const totalG = withGrams.reduce((sum, it) => sum + it.grams, 0);
          built.steps.push(
            `Готовое блюдо рассчитано на ${servings} порции — примерно ${Math.round(totalG / servings)} г каждая; всего продуктов ${totalG} г, общее время ${built.prep + built.cook} минут. Приятного аппетита!`,
          );
        }
      }
      const cuisine = q.f.cuisine ?? pickArr(CUISINES);
      const diff = difficultyOf();
      const card = {
        title: title.trim(),
        description: `${title.trim()} — ${Math.round(macro.kcal)} ккал на порцию. Подготовка ${built.prep} мин, готовка ${built.cook} мин, ${servings} порции, сложность ${diff} из 3.`,
        category: q.f.cat,
        cuisines: [cuisine],
        seasons: [seasonOf(flat)],
        diets: dietsOf(flat),
        mealTypes: q.f.mealTypes,
        difficulty: diff,
        servings,
        prepMinutes: built.prep,
        cookMinutes: built.cook,
        requiredAppliances: q.f.appl ?? [],
        ingredients: withGrams.map((it) => ({
          ingredient: it.name,
          quantity: it.quantity ?? Math.round(it.grams),
          unit: it.unit ?? catalog.get(it.name)?.unit ?? 'G',
          grams: it.grams,
        })),
        instructions: built.steps,
      };

      const res = validateCard(card, { catalog, nutrition, seenTitles });
      if (!res.ok) {
        rejected.push({ title: card.title, errors: res.errors });
        if (rejected.length <= 25) console.log('REJECT:', res.errors.join(','), '|', card.title);
        continue;
      }
      card.tags = buildTags(card);
      delete card._perServing;
      const slug = slugify(card.title);
      if (!slug || writtenSlugs.has(slug)) continue;
      writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(card, null, 1));
      writtenSlugs.add(slug);
      written.push({ slug, cat: q.f.cat });
      q.made += 1;
    }
  }
  if (written.length === beforeSweep) {
    console.log(`pass ${pass}: no progress, stopping`);
    for (const q of familyQueues) {
      if (q.made < q.f.n) {
        console.log(
          `  short: [${q.f.cat}] made=${q.made}/${q.f.n} combos=${q.combos.length} consumed=${q.idx} slots=${JSON.stringify(q.f.slots)}`,
        );
      }
    }
    break;
  }
}

// ---------- waves ----------
const waves = { wave1: [], wave2: [], wave3: [] };
const sorted = written.map((w) => w.slug).sort();
waves.wave1 = sorted.slice(0, 331);
waves.wave2 = sorted.slice(331, 1031);
waves.wave3 = sorted.slice(1031, 1731);
writeFileSync('data/recipes/waves.json', JSON.stringify(waves, null, 1));

const perCat = {};
for (const w of written) perCat[w.cat] = (perCat[w.cat] ?? 0) + 1;
console.log(
  `generated: ${written.length} valid cards (target ${TARGET}), rejected: ${rejected.length}`,
);
console.log('per category:', JSON.stringify(perCat));
console.log(`waves: ${waves.wave1.length}/${waves.wave2.length}/${waves.wave3.length}`);
if (rejected.length > 0) {
  const byErr = {};
  for (const r of rejected) {
    for (const e of r.errors) {
      const k = e.split(':').slice(0, 2).join(':');
      byErr[k] = (byErr[k] ?? 0) + 1;
    }
  }
  console.log('rejection reasons:', JSON.stringify(byErr));
}
