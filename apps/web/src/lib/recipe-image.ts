// T54-B (audit round 54, P1): единственное допустимое значение
// imageKey — внутренний путь сид-хранилища. Защищает <img src> от
// data:/http(s)/SVG-инъекций независимо от валидности данных API.
const RECIPE_IMAGE_RE = /^\/images\/recipes\/[a-z0-9-]+\.webp$/i;

export function isSafeRecipeImage(imageKey: string | null | undefined): imageKey is string {
  return typeof imageKey === 'string' && RECIPE_IMAGE_RE.test(imageKey);
}
