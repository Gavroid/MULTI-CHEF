// T54-B (round 54): <img src> never sees raw DB strings — data:/http(s)/
// SVG-инъекции блокируются формой ключа. T54-C (E24): ключ теперь
// OPAQUE storage key; публичный URL строит резолвер.
const RECIPE_IMAGE_RE = /^recipes\/[a-z0-9][a-z0-9-/]*\.(webp|jpg|jpeg|png)$/i;

export function isSafeRecipeImage(imageKey: string | null | undefined): imageKey is string {
  return typeof imageKey === 'string' && RECIPE_IMAGE_RE.test(imageKey);
}

/** Resolve an opaque image key to the API serving route. */
export function recipeImageUrl(imageKey: string | null | undefined): string | null {
  return isSafeRecipeImage(imageKey) ? `/api/v1/images/${imageKey}` : null;
}
