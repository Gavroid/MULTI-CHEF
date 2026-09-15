/** UI locales supported by the product (PRD: ru first, en scaffold). */
export type UiLocale = 'ru' | 'en';

/**
 * T46-A (E23): the single source of human-readable error messages.
 * Machine-readable `code`s stay language-agnostic (conventions.md §2);
 * only the `message` is localized. The API resolves the entry by the
 * caller's User.locale (default 'ru') in the global exception filter.
 *
 * Kept in contracts (not apps/api) so web clients can map codes to
 * their own copy of a message without a round-trip.
 */
export const ERROR_MESSAGES = {
  VALIDATION_ERROR: { ru: 'Ошибка валидации запроса', en: 'Request validation failed' },
  UNAUTHORIZED: { ru: 'Требуется вход', en: 'Authentication required' },
  FORBIDDEN: { ru: 'Нет прав на этот ресурс', en: 'Forbidden' },
  NOT_FOUND: { ru: 'Ресурс не найден', en: 'Resource not found' },
  CONFLICT: { ru: 'Конфликт выполнения запроса', en: 'Conflict' },
  IDEMPOTENT_REPLAY: {
    ru: 'Повтор запроса с другим телом',
    en: 'Idempotency-Key replayed with a different body',
  },
  RATE_LIMITED: {
    ru: 'Слишком много запросов, попробуйте позже',
    en: 'Too many requests, slow down',
  },
  JOB_FAILED: { ru: 'Фоновая задача завершилась с ошибкой', en: 'Background job failed' },
  INTERNAL_ERROR: { ru: 'Внутренняя ошибка сервера', en: 'Internal server error' },
  BAD_REQUEST: { ru: 'Некорректный запрос', en: 'Bad request' },
  INGREDIENT_NOT_FOUND: { ru: 'Ингредиент не найден', en: 'Ingredient not found' },
  RECIPE_NOT_FOUND: { ru: 'Рецепт не найден', en: 'Recipe not found' },
  MEAL_PLAN_NOT_FOUND: { ru: 'План питания не найден', en: 'Meal plan not found' },
  HOUSEHOLD_NOT_FOUND: { ru: 'Домашнее хозяйство не найдено', en: 'Household not found' },
  USER_NOT_FOUND: { ru: 'Пользователь не найден', en: 'User not found' },
  SESSION_NOT_FOUND: { ru: 'Сессия не найдена', en: 'Session not found' },
  PANTRY_ITEM_NOT_FOUND: { ru: 'Продукт не найден в холодильнике', en: 'Pantry item not found' },
  SHOPPING_LIST_NOT_FOUND: { ru: 'Список покупок не найден', en: 'Shopping list not found' },
  SHOPPING_ITEM_NOT_FOUND: {
    ru: 'Позиция не найдена в списке',
    en: 'Shopping list item not found',
  },
  JOB_NOT_FOUND: { ru: 'Задача не найдена', en: 'Job not found' },
  PLAN_NOT_FOUND: { ru: 'Активный план не найден', en: 'Active meal plan not found' },
  PREP_TASK_NOT_FOUND: { ru: 'Задача подготовки не найдена', en: 'Prep task not found' },
  EMPTY_RESCUE: {
    ru: 'Из выбранных продуктов нечего спасти',
    en: 'Nothing to rescue from the selected items',
  },
  ROULETTE_EMPTY: {
    ru: 'Рулетка пуста — подходящих рецептов нет',
    en: 'Roulette is empty — no matching recipes',
  },
  REJECT_LIMIT_REACHED: { ru: 'Лимит отклонений исчерпан', en: 'Reject limit reached' },
  CSRF_MISMATCH: {
    ru: 'CSRF-токен не совпадает (заголовок X-CSRF-Token vs cookie mc_csrf)',
    en: 'CSRF token mismatch (X-CSRF-Token header vs mc_csrf cookie)',
  },
  SERVICE_UNAVAILABLE: { ru: 'Сервис временно недоступен', en: 'Service temporarily unavailable' },
  PREFERENCE_NOT_FOUND: { ru: 'Предпочтения не найдены', en: 'Preferences not found' },
  NUTRITION_PROFILE_NOT_FOUND: {
    ru: 'Профиль питания не найден',
    en: 'Nutrition profile not found',
  },
  ITEM_NOT_ARCHIVED: { ru: 'Продукт не в архиве', en: 'Item is not archived' },
  PANTRY_ITEM_ARCHIVED: {
    ru: 'Продукт в архиве — сначала восстановите его',
    en: 'Item is archived; restore it first',
  },
} as const satisfies Record<string, { ru: string; en: string }>;

export type LocalizedErrorCode = keyof typeof ERROR_MESSAGES;
