// MC-032 — buildExplanation: ScoredRecipe → короткая русская плашка
// «почему это блюдо». Шаблонные фразы по факторам, никаких LLM
// (ADR red flag #6). Возвращает до 3 причин, начиная с самого весомого
// вклада; для отклонённых рецептов объясняет причину отсева.

import { FACTOR_NAMES, type FactorName } from './scoring/weights.js';
import type { AntiFilter, RejectionReason, ScoredRecipe } from './types.js';

const FACTOR_LABELS: Record<FactorName, string> = {
  pantryMatch: 'есть почти все продукты дома',
  expirationBenefit: 'использует продукты, которые скоро испортятся',
  budgetMatch: 'вписывается в бюджет',
  nutritionMatch: 'близко к твоим целям по КБЖУ',
  timeMatch: 'быстро готовить',
  preferenceMatch: 'попадает в твои вкусы',
  varietyScore: 'давно не готовил',
  noveltyScore: 'необычное сочетание',
};

const ANTI_LABELS: Record<AntiFilter, string> = {
  NO_OVEN: 'исключено: нужна духовка',
  ONE_PAN: 'исключено: слишком много посуды',
  NOT_CHICKEN_AGAIN: 'исключено: курица была вчера',
  NO_LEFTOVERS: 'исключено: из остатков',
  NO_FRYING: 'исключено: жареное',
  NO_CHOPPING: 'исключено: много резать',
  SHORT_TIME: 'исключено: готовить дольше 20 минут',
  NO_MULTISTEP: 'исключено: слишком много шагов',
};

function rejectPhrase(reason: RejectionReason): string {
  switch (reason.code) {
    case 'ALLERGY':
      return 'содержит исключённый продукт';
    case 'APPLIANCE_MISSING':
      return `нужна техника: ${reason.appliance}`;
    case 'DIET_CONFLICT':
      return 'не подходит под тип питания';
    case 'EXCEEDS_TIME':
      return `долго: ${reason.required} мин (лимит ${reason.max} мин)`;
    case 'ANTI_RECIPE':
      return ANTI_LABELS[reason.antiFilter];
    case 'NOT_RESCUE_TARGET':
      return 'не использует спасаемый продукт';
  }
}

/**
 * Build a short UI explanation for a scored recipe:
 * top contributing factors for passed recipes, the rejection reason
 * otherwise. Max 3 phrases, joined with ' · '.
 */
export function buildExplanation(scored: ScoredRecipe, maxReasons = 3): string {
  if (!scored.passed && scored.reject) {
    return rejectPhrase(scored.reject);
  }

  const ranked = FACTOR_NAMES.map((name) => ({
    name,
    contribution: scored.breakdown[name].contribution,
    value: scored.breakdown[name].value,
  }))
    .filter((f) => f.value > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, maxReasons);

  if (ranked.length === 0) {
    return 'нейтральный вариант';
  }
  return ranked.map((f) => FACTOR_LABELS[f.name]).join(' · ');
}
