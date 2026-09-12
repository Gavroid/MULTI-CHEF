/goal Довести MULTI-CHEF до MVP полностью автономно. Не останавливаться пока проект не достигнет v0.1.0 на проде.

## Источник правды

Прочти **в этом порядке** перед стартом:

1. `/root/workspace/multichef/.handover/perenos/HANDOVER-TO-NEW-DEVELOPER.md` (полный контекст)
2. `/root/workspace/multichef/.handover/perenos/SHORT-PROMPT-FOR-NEW-DEVELOPER.md` (короткая шпаргалка)
3. `/root/workspace/multichef/.handover/perenos/access-map.md` (где что лежит)
4. `/root/workspace/multichef/.handover/perenos/SERVER-INFO.md` (настройки сервера)
5. `/root/workspace/multichef/.handover/perenos/STATUS.md` (где проект сейчас)
6. `/root/workspace/multichef/.handover/perenos/MC-034-web-today-wizard-result.md` (ADR текущей задачи)
7. `/root/workspace/multichef/.handover/perenos/MC-040-rescue-product.md` (ADR следующей задачи)
8. `/root/.hermes/plans/goal-autonomous-mvp.md` (определение MVP)
9. `/root/workspace/multichef/docs/MULTICHEF-DEVELOPMENT-PLAN.md` (каталог MC-001..075)
10. `/root/workspace/multichef/docs/MULTICHEF-ARCHITECTURE-PRD.md` (PRD)

## Что значит «MVP достигнут» (8 success-критериев)

Не останавливайся пока все 8 не выполнены:

1. ✅ Все MC из MAIN-LINE закрыты (см. goal-autonomous-mvp.md секция «Каталог задач»)
2. ✅ `pnpm test` зелёный + coverage ≥ 80% branches
3. ✅ E2E Playwright happy path + 3 критичных сценария зелёные
4. ✅ `pnpm build` зелёный
5. ✅ Prod-deploy отработал (smoke зелёный)
6. ✅ README обновлён с инструкцией деплоя
7. ✅ CHANGELOG.md с записями v0.1.0
8. ✅ `STATUS.md` = `## MVP достигнут`

## MAIN-LINE (строго по плану, sequential)

```
MC-034 (web /today)              ← НАЧАТЬ С ЭТОГО (WIP в feature/MC-034-today-wizard-result)
  ↓
MC-040 (Спаси продукт)            [backend + frontend]
  ↓
MC-042 (Кулинарная рулетка)       [backend + frontend]
  ↓
MC-050 (BullMQ worker)
  ↓
MC-051 (Планировщик)
  ↓
MC-052 (ShoppingList)
  ↓
MC-054 (Бюджет)
  ↓
MC-055 (Web: План)
  ↓
MC-056 (Web: Покупки)
  ↓
MC-060 (PrepSession)
  ↓
MC-061 (PreparedPortion)
  ↓
MC-062 (Web: Заготовка)
  ↓
MC-070 (PWA)
  ↓
MC-071 (Nginx gateway)
  ↓
MC-072 (Инфра-скрипты)
  ↓
MC-073 (Playwright E2E)
  ↓
MC-080 (Прод-деплой app)
  ↓
MC-082 (Прод-деплой cdn/data)
  ↓
MC-090 (Прод-smoke)
```

## Workflow (на каждую MC)

```
1. Прочитай ADR / scope из DEVELOPMENT-PLAN.md
2. Создай ветку feature/MC-XXX от main d8540d4
3. Напиши код + тесты
4. Проверь локально:
   pnpm install --frozen-lockfile
   pnpm --filter @<pkg> test     (3 раза, exit 0)
   pnpm --filter @<pkg> typecheck
   pnpm --filter @<pkg> lint
   pnpm --filter @<pkg> build
5. git add, git commit (заголовок ≤72 символов)
6. git push origin feature/MC-XXX
7. Создай PR через gh CLI или curl+GitHub API (PAT из /root/.config/gh/host.yml)
8. Дождись CI: 5 jobs зелёные (build, test, typecheck, lint, secret-scan)
9. Squash-merge PR в main
10. Обнови /root/.hermes/plans/STATUS.md
11. Переходи к следующей MC
```

## Граница решений (что РЕШАТЬ САМОМУ, что СТОП)

**Решай сам, продвигайся дальше:**
- Архитектурный паттерн, схема, имя файла, организация кода → спроси архитектора (он уже завис, решай сам по аналогии с MC-032/033/035)
- Продуктовые: текст кнопки, цвет, иконка, дефолт, порядок элементов, mock-режим → реши сам, зафиксируй в STATUS.md как «решение менеджера»
- Coverage threshold ±2%, CI-фиксы (heap, timeout, cache) → реши сам
- Зависимости/конфиги внутри реализации → реши сам

**СТОП и напиши пользователю (если есть username -telegram или в чате):**
- Изменение scope MC, противоречащее DEVELOPMENT-PLAN.md
- Изменение API-контракта (breaking change для уже merged MC)
- Удаление/правка ранее merged functionality
- Изменение 8 антирецептов (тактическая константа PRD §2.3.3)
- Операции с реальными деньгами / прод-данными юзеров
- Все 3 попытки исправить blocker не помогли → СТОП

## Что фиксировать каждый цикл

- `/root/.hermes/plans/STATUS.md` — обновляется после каждого merge
- `/root/.hermes/plans/manager-decision-log.md` — append-only архитектурные решения + CI-фиксы
- `/root/.hermes/plans/manager-product-decisions.md` — append-only продуктовые решения
- `/root/.hermes/plans/MC-XXX-*.md` — ADR (если пишешь новые)
- `/root/.hermes/plans/blockers.md` — если что-то критично остановилось

## Gotchas (на чём уже обожглись — применять сразу)

1. **TS2589 в swagger:** сложные Zod-схемы с discriminatedUnion/ZodOptional+ZodArray падают в `zodToJsonSchema`. Решение: `zodToJsonSchema(schema as never, {name, target: 'openApi3'})`. Уже применено в MC-033 для `zod-swagger.ts` — копировать паттерн.

2. **Polling вместо sleep в тестах:** `await sleep(10ms)` нестабилен на CI. Helper: `waitFor(predicate, {intervalMs:5, timeoutMs:2000})`. Уже в MC-035 RecipeView.test.tsx.

3. **CI heap:** typecheck требует `NODE_OPTIONS: --max-old-space-size=8192`. Уже в `.github/workflows/ci.yml` — не убирать.

4. **CI workspace deps:** для web-тестов нужен turbo build step (`pnpm turbo run build --filter=@multichef/web...`). Уже — не убирать.

5. **CSRF:** мягкий double-submit (`mc_csrf` cookie + `X-CSRF-Token` header). Уже в `apps/api/src/app.module.ts` через `CSRF_GUARD_PROVIDER`. State-changing endpoints подхватывают автоматически.

6. **Prisma Decimal:** `decimal.toNumber()` перед арифметикой. Float — только в display.

7. **8 антирецептов** константа в `packages/recommendation/src/constants.ts` (`ANTI_RECIPE_PREDICATES`) — не менять без ADR.

8. **CSRF-soft mode** vs hard-fail — hard-fail tech-debt ADR после MC-055. Не делать.

9. **Mock-режим для MealPlan:** `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` (до MC-051). Иначе не работает.

10. **`chainTags?`** в Recipe — MC-033 mini-PR (`5f9e20c` → `4fd682c`), additive extension. Не дублировать.

11. **`usePantry` hook** (MC-035) — общий, переиспользовать в `/today` и `/fridge/*`.

12. **`usePreferences` hook** (MC-034, scope-expansion) — общий для аллергенов.

13. **sessionStorage** для state (refresh /today без него → redirect + toast).

## Не останавливайся (anti-loop)

- Написал код → запушь → открой PR. Не жди approval.
- Один CI красный? → чини, не мёрджи в red.
- Упало в typecheck? → увеличь heap или исправь типы.
- Тест flaky? → polling вместо sleep.
- Бот завис (не новый разраб, а старые бот-агенты)? → ИГНОРИРУЙ, работай сам.
- Сеть/интернет пропал на 5 мин? → подожди, не переключайся на другую задачу.

## Что НЕ делать

- ❌ Не менять архитектурный стек.
- ❌ Не мёржить с красным CI.
- ❌ Не копировать API-ключи между профилями.
- ❌ Не изменять 8 антирецептов без ADR.
- ❌ Не удалять структуру пакетов.
- ❌ Не оставлять untracked WIP в working tree больше 30 минут.
- ❌ Не использовать `--no-verify` для commitlint без крайней причины.
- ❌ Не создавать новых веток под одной и той же задачей — обновляй существующую (по паттерну MC-033 mini + main).
- ❌ Не пытаться «поднять» старых ботов (architect, backend-bot, frontend-bot, qa-docs-bot) — они зависли и не помогут.

## Финальный отчёт пользователю (когда MVP готов)

Когда 8 success-критериев выполнены, напиши пользователю один раз:

```
MVP ГОТОВ.

Версия: v0.1.0
Main commit: <SHA>
Merged PRs: #24..#NN
Coverage: <X>% branches
E2E Playwright: <N>/<N> pass
Prod URL: https://<домен>/ (если есть)
Логин: <test user>
Пароль: <от test user>

Сводка:
- Phase 0–7 закрыты
- Все MAIN-LINE MC завершены
- README + CHANGELOG обновлены
- STATUS.md = `## MVP достигнут`

Что осталось (post-MVP backlog):
- MC-041 (Преображение остатков) — feature-flag off
- MC-043 (Антирецепт UI) — опционально
- MC-053 (Замена блюда) — phase 5
- MC-074 (полная observability)
- MC-075 (релиз-чеклист polish)
```

Если MVP не получается за реалистичный срок (3-5 дней активной работы) — напиши пользователю ЧТО осталось, ГДЕ застрял, и какая помощь нужна.

## Старт

1. Прочитай HANDOVER (10 источников выше).
2. Подтверди, что репо доступен: `cd /root/workspace/multichef && git log --oneline -3 && git status`.
3. Убедись, что HANDOVER-папка читается: `ls /root/workspace/multichef/.handover/perenos/`.
4. Возьми MC-034 из WIP: `git checkout feature/MC-034-today-wizard-result`.
5. Исправь 2 TS-ошибки, добавь тесты, закоммить, запушь, открой PR, дождись CI, squash-merge.
6. Повтори для следующих MC по MAIN-LINE.

Не останавливайся пока MVP не будет достигнут.
