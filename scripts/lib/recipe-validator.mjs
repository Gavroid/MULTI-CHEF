// MC-085 — recipe card validator (plan PLAN-2000-RECIPES.md §4.3).
// Pure functions, no deps: used by the CLI (validate-recipes.mjs), the
// generator (fix-loop) and the importer (hard gate before DB writes).

export const MEAL_TYPES = new Set(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);
export const UNITS = new Set(['G', 'ML', 'PIECE']);

const RU_TITLE = /^[«"»]?[А-ЯЁA-Z0-9][^<>{}]*$/;

function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * @param {object} card - recipe card (JSON dataset item)
 * @param {object} ctx - { catalog: Map<name,{id,unit}>, nutrition: Map<name,{kcal,protein,fat,carbs}>, seenTitles?: Set<string> }
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateCard(card, ctx) {
  const errors = [];
  const err = (code) => errors.push(code);

  // --- fields ---
  if (!card || typeof card !== 'object') {
    return { ok: false, errors: ['CARD:notObject'] };
  }
  if (
    typeof card.title !== 'string' ||
    card.title.trim().length < 3 ||
    card.title.trim().length > 120
  ) {
    err('FIELD:title.badLength');
  } else if (!RU_TITLE.test(card.title.trim())) {
    err('FIELD:title.notRu');
  }
  if (ctx.seenTitles) {
    const key = card.title?.trim().toLowerCase();
    if (key && ctx.seenTitles.has(key)) err('FIELD:title.duplicate');
    if (key) ctx.seenTitles.add(key);
  }
  if (typeof card.category !== 'string' || card.category.length < 3) err('FIELD:category.missing');
  if (!Array.isArray(card.cuisines) || card.cuisines.length < 1) err('FIELD:cuisines.needOne');
  if (!Array.isArray(card.seasons) || card.seasons.length < 1) err('FIELD:seasons.needOne');
  if (
    !Array.isArray(card.mealTypes) ||
    card.mealTypes.length < 1 ||
    card.mealTypes.some((m) => !MEAL_TYPES.has(m))
  )
    err('FIELD:mealTypes.invalid');
  if (!Number.isInteger(card.difficulty) || card.difficulty < 1 || card.difficulty > 3)
    err('FIELD:difficulty.range');
  if (!Number.isInteger(card.servings) || card.servings < 1 || card.servings > 12)
    err('FIELD:servings.range');
  if (
    !Number.isInteger(card.prepMinutes) ||
    !Number.isInteger(card.cookMinutes) ||
    card.prepMinutes < 0 ||
    card.cookMinutes < 0 ||
    card.prepMinutes + card.cookMinutes < 5 ||
    card.prepMinutes + card.cookMinutes > 240
  ) {
    err('FIELD:time.range');
  }
  if (
    typeof card.description !== 'string' ||
    card.description.length < 80 ||
    card.description.length > 250
  ) {
    err('FIELD:description.badLength');
  }

  // --- ingredients ---
  const ings = Array.isArray(card.ingredients) ? card.ingredients : [];
  if (ings.length < 3) err('ING:tooFew');
  const names = new Set();
  let totalGrams = 0;
  for (const ing of ings) {
    if (typeof ing.ingredient !== 'string' || !ctx.catalog.has(ing.ingredient)) {
      err(`ING:unknown:${ing.ingredient ?? '?'}`);
      continue;
    }
    if (names.has(ing.ingredient)) err(`ING:duplicate:${ing.ingredient}`);
    names.add(ing.ingredient);
    if (!UNITS.has(ing.unit)) err(`ING:unit:${ing.ingredient}`);
    if (!isNum(ing.grams) || ing.grams <= 0) err(`ING:grams:${ing.ingredient}`);
    if (!isNum(ing.quantity) || ing.quantity <= 0) err(`ING:quantity:${ing.ingredient}`);
    totalGrams += isNum(ing.grams) ? ing.grams : 0;
  }

  // --- portion weight (D5) ---
  if (isNum(card.servings) && card.servings > 0 && ings.length >= 3) {
    const portion = totalGrams / card.servings;
    const isDrink = card.category === 'DRINK';
    const [lo, hi] = isDrink ? [150, 400] : [100, 800];
    if (portion < lo || portion > hi) err(`PORTION:${Math.round(portion)}`);
  }

  // --- macros (D6) ---
  const missingNutrition = ings.filter(
    (i) => ctx.catalog.has(i.ingredient) && !ctx.nutrition.has(i.ingredient),
  );
  if (missingNutrition.length > 0) err(`NUTR:missing:${missingNutrition[0].ingredient}`);
  if (
    missingNutrition.length === 0 &&
    ings.length >= 3 &&
    isNum(card.servings) &&
    card.servings > 0
  ) {
    let kcal = 0,
      p = 0,
      f = 0,
      c = 0;
    for (const ing of ings) {
      const n = ctx.nutrition.get(ing.ingredient);
      if (!n) continue;
      const k = ing.grams / 100;
      kcal += n.kcal * k;
      p += n.protein * k;
      f += n.fat * k;
      c += n.carbs * k;
    }
    const per = card.servings;
    kcal /= per;
    p /= per;
    f /= per;
    c /= per;
    const isDrink = card.category === 'DRINK';
    const light = card.category === 'SALAD' || card.category === 'DESSERT';
    if (isDrink && (kcal < 0 || kcal > 500)) err(`KCAL:${Math.round(kcal)}`);
    if (!isDrink && light && (kcal < 60 || kcal > 1200)) err(`KCAL:${Math.round(kcal)}`);
    if (!isDrink && !light && (kcal < 120 || kcal > 1200)) err(`KCAL:${Math.round(kcal)}`);
    const macroKcal = 4 * p + 9 * f + 4 * c;
    if (macroKcal > 0 && Math.abs(macroKcal - kcal) / macroKcal > 0.25) err('KCAL:macroMismatch');
    card._perServing = {
      kcal: Math.round(kcal),
      proteinG: Math.round(p),
      fatG: Math.round(f),
      carbsG: Math.round(c),
    };
  }

  // --- steps ---
  const steps = Array.isArray(card.instructions) ? card.instructions : [];
  if (steps.length < 4) err('STEPS:tooFew');
  const totalLen = steps.reduce((s, x) => s + (typeof x === 'string' ? x.length : 0), 0);
  if (totalLen < 300) err(`STEPS:tooShort:${totalLen}`);
  if (!steps.some((x) => /\d/.test(x))) err('STEPS:noNumbers');
  if (new Set(steps).size !== steps.length) err('STEPS:duplicate');

  return { ok: errors.length === 0, errors };
}

/** Expected Recipe.tags for a card (seed convention). */
export function buildTags(card) {
  return [
    `category:${card.category}`,
    ...card.cuisines.map((x) => `cuisine:${x}`),
    ...card.seasons.map((x) => `season:${x}`),
    ...card.diets.map((x) => `diet:${x}`),
  ];
}

export function slugify(title) {
  const map = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };
  return title
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
