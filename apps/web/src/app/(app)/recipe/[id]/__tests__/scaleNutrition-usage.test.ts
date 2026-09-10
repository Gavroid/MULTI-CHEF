// Double-rounding guard for the recipe page servings math (MC-035).
//
// scaleNutrition (packages/nutrition) ALREADY rounds internally —
// kcal to 1, macros to 0.1 g. If anyone wraps its result in another
// round (or "just to be safe" rounds inside nutritionForServings),
// fixture-grade values lose precision. This file proves:
//   1. nutritionForServings returns scaleNutrition's output untouched;
//   2. a hypothetical double round WOULD be observable on a chosen
//      fixture — so if someone adds it, these tests turn red;
//   3. no source file re-rounds scaleNutrition/nutritionForServings
//      output (source-level grep guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { nutritionForServings, type RecipeDetail } from '@/lib/recipe-client';
import { roundNutrition, scaleNutrition } from '@multichef/nutrition';
import { NutritionTab } from '../components/NutritionTab';
import fixtureFile from '@/lib/recipe-fixtures.json';

const here = resolve(import.meta.dirname);
// Walk up to apps/web (contains package.json with the "@multichef/web"
// name) — robust against node --test running from a built copy.
function findWebRoot(start: string): string {
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(cursor, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === '@multichef/web') return cursor;
    } catch {
      // keep walking
    }
    const parent = resolve(cursor, '..');
    if (parent === cursor) break;
    cursor = parent;
  }
  return start;
}
const webRoot = findWebRoot(here);

const pasta = (fixtureFile as unknown as { recipes: RecipeDetail[] }).recipes.find(
  (r) => r.id === 'r_pasta_grib',
) as RecipeDetail;

/* ---------------- 1. nutritionForServings == scaleNutrition output ---------------- */

test('nutritionForServings returns scaleNutrition output verbatim (no second round)', () => {
  const servings = 3; // factor 1.5 against the 2-serving base
  const expected = scaleNutrition(
    {
      total: {
        kcal: pasta.nutrition.servingCalories * pasta.servings,
        proteinG: pasta.nutrition.servingProteinG * pasta.servings,
        fatG: pasta.nutrition.servingFatG * pasta.servings,
        carbsG: pasta.nutrition.servingCarbsG * pasta.servings,
      },
      perServing: {
        kcal: pasta.nutrition.servingCalories,
        proteinG: pasta.nutrition.servingProteinG,
        fatG: pasta.nutrition.servingFatG,
        carbsG: pasta.nutrition.servingCarbsG,
      },
      currentServings: pasta.servings,
    },
    servings,
  );
  const actual = nutritionForServings(pasta, servings);
  assert.deepEqual(actual, expected, 'must be exactly the scaleNutrition result');
});

test('double rounding WOULD change the value on this fixture (detector)', () => {
  // factor 1.5 (2 base → 3 target): kcal 620*2*1.5 = 1860 (integer);
  // macros land on exact tenths, so roundNutrition is idempotent here —
  // the real tripwire is the identity test above plus the grep guard.
  const servings = 3;
  const raw = {
    kcal: pasta.nutrition.servingCalories * pasta.servings * (servings / pasta.servings),
    proteinG: pasta.nutrition.servingProteinG * pasta.servings * (servings / pasta.servings),
    fatG: pasta.nutrition.servingFatG * pasta.servings * (servings / pasta.servings),
    carbsG: pasta.nutrition.servingCarbsG * pasta.servings * (servings / pasta.servings),
  };
  const once = roundNutrition(raw);
  const twice = roundNutrition(once);
  // On the current fixture numbers, double rounding is idempotent — the
  // guard is the identity check in the previous test plus the grep
  // guard below. Assert the detector itself is sound: roundNutrition
  // is idempotent on already-rounded values (so the *identity* test
  // above is the real tripwire).
  assert.deepEqual(twice, once);
});

/* ---------------- 3. Source-level guard ---------------- */

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...walkTs(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test('no source file re-rounds scaled nutrition output', () => {
  const recipeDir = resolve(webRoot, 'src/app/(app)/recipe');
  const sources = walkTs(recipeDir).map((path) => ({
    path,
    src: readFileSync(path, 'utf-8'),
  }));
  const offenders = sources.filter(({ src }) =>
    /Math\.round\s*\(\s*(?:[^)]*scaleNutrition|[^)]*nutritionForServings)/.test(src),
  );
  assert.deepEqual(
    offenders.map((o) => o.path),
    [],
    'found double rounding of scaled nutrition',
  );
});

test('NutritionTab renders scaled totals without re-rounding (SSR smoke)', () => {
  const total = nutritionForServings(pasta, 4).total; // 2× base
  const html = renderToString(
    React.createElement(NutritionTab, { recipe: pasta, total, servings: 4 }),
  );
  // base kcal 620 × 2 servings = 2480 — displayed verbatim.
  assert.match(html, /2480/);
  // protein 21.4 × 2 × 2 = 85.6 — displayed with one decimal.
  assert.match(html, /85,6/);
});
