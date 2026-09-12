# STATUS — MULTI-CHEF (на 2026-09-10)

> Снимок состояния проекта после сброса контекста менеджера. Источник правды:
> `git log` (origin/main), `docs/MULTICHEF-DEVELOPMENT-PLAN.md`, ADR-0001..ADR-0021.

## Фаза: Фаза 3 — почти завершена

| | MC-001..005 (Фаза 0) | MC-010..014 (Фаза 1) | MC-020..023 (Фаза 2) | MC-030..033 (Фаза 3) |
|---|---|---|---|---|
| Статус | ✅ | ✅ | ✅ | ✅ MC-030, MC-031, MC-032, MC-033, **MC-035** |
| PR | #1–#5 | #6–#11 | #10–#14 | #15, #17, #19, **#20, #21, #22, #23** |
| Squash-merge | ✓ | ✓ | ✓ | ✓ (4fd682c, b6fbcff, d8540d4) |

**Закрыто на main (28 коммитов):** MC-001..005, MC-010..014, MC-020..023, MC-030, MC-031, MC-INGREDIENT-NUTRITION, MC-MERGE-GATE, MC-032, MC-033-chainTags (mini), MC-035 (с CI-fixes + flaky-test fix), **MC-033 endpoints (с CI-fixes: heap 8 GiB + TS2589 fix + prettier fix)**.

## Сделано (последние 7 коммитов main)

- **d8540d4** Merge PR #23 — MC-033 backend endpoints (recipes + recommendations/today + CSRF + zod-swagger)
- **ad8b6c1** style(MC-033): apply prettier --write to zod-swagger.ts
- **2d0b649** fix(MC-033): bypass TS2589 in zod-swagger via 'as never' cast
- **5abedf9** ci(MC-033): raise Node heap to 8 GiB (4 GiB still OOM)
- **b6fbcff** Merge PR #21 — MC-035 recipe page + CI fixes
- **4fd682c** Merge PR #22 — MC-033 chainTags extension (mini)
- **824fc09** Merge PR #20 — MC-032 packages/recommendation

## Что фактически есть в коде (на d8540d4)

- **apps/api**: `auth/`, `profile/`, `household/`, `ingredients/`, `pantry/`, `health/`, `common/`, **`recipes/`, `recommendations/`, `common/csrf-guard.ts`** (✅ merged).
- **apps/web**: `/auth`, `/fridge`, `/today` (layout), `/plan`, `/profile`, `/shopping`, **`/recipe/[id]`, `/plan/setup`** (✅ merged).
- **packages/nutrition**: реализован MC-030.
- **packages/database**: 24 Prisma-модели, миграции + seed.
- **packages/recommendation**: 7 факторов scoring, 5 hard filters, 8 антирецептов, `chainTags?` (✅).
- **packages/contracts**: Zod-схемы + swagger (✅ merged).
- **CI**: build workspace deps for web + concurrency=2 + heap 8 GiB для typecheck.

## Что осталось до конца Фазы 3

| # | Задача | Статус | Scope |
|---|---|---|---|
| **MC-034** | Web: `/today` + wizard `/today/generate` + `/today/result` | ⏳ ждёт старта | `apps/web/src/app/(app)/today` |

**Граф зависимостей:** MC-033 ✅ → MC-034 разблокирован. Стартую MC-034.

## Что блокирует

- **Нет открытого активного спринта.** `@backend-bot` и `@frontend-bot` простаивают (нет in-flight задачи).
- **Рецепты в БД уже есть** (MC-031), но в API/web недоступны — фронт показывает пустой `/today` без рекомендаций.
- **Пакет `packages/recommendation` не создан** — это узкое место Фазы 3, без него MC-033 нечего подключать.

## Что осталось до конца проекта (Фазы 4–7)

- **Фаза 4** (игровые режимы): MC-040 «Спаси продукт», MC-041 «Преображение остатков», MC-042 «Рулетка», MC-043 «Антирецепт-фильтры» (зависит от MC-032/MC-033).
- **Фаза 5** (недельный план + покупки): MC-050 BullMQ/worker, MC-051 планировщик, MC-052 ShoppingList, MC-053 замена блюда, MC-054 бюджет, MC-055 «План», MC-056 «Покупки».
- **Фаза 6** (заготовки): MC-060..MC-062.
- **Фаза 7** (прод + PWA): MC-070 PWA, MC-071 Nginx gateway, MC-072 инфра-скрипты, MC-080/MC-082 прод-деплой.

## Решения, зафиксированные в этом цикле

- **2026-09-10** Решение пользователя: оставить архитектора на MiniMax-M3 / `minimax`-провайдере. Перевод на Kimi K3 отклонён (Kimi — coding-оптимизированный провайдер, архитектор пишет ADR, а не код; перенос API-ключа чувствителен). Записано в этом STATUS.

## Следующий шаг (без пользователя)

Ничего не делаю до явной команды. Команда ждёт.

## Требует решения

1. **Какой MC стартует следующим?** Варианты:
   - **A.** MC-032 (`packages/recommendation`) — критический путь Фазы 3, разблокирует MC-033 и MC-034. Backend-bot создаёт новый пакет.
   - **B.** MC-035 (страница рецепта) — независимая, frontend-bot может идти параллельно с MC-032. Меньше всего работы.
   - **C.** Перескочить Фазу 3 и уйти в Фазу 4 (игровые режимы) — **нет**, MC-040/041/042 зависят от MC-033.

   **Рекомендую A** (критический путь, всё остальное Фазы 3 на нём висит).
2. **Распараллеливание:** после ADR на MC-032 — MC-035 можно стартовать параллельно с MC-033 (разные исполнители, разные слои). Подтвердить «go параллельно»?
3. **Smoke-чек после MC-031:** `git log` показывает MC-SMOKE (#16, de2afc4) с browser E2E. Актуален ли? Гонять ли его перед MC-032 как regression?