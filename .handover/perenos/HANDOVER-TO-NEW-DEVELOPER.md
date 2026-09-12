# HANDOVER — MULTI-CHEF → новому разработчику (на другом сервере)

**Дата handover:** 2026-09-12
**От:** команда менеджера `@manager` (Hermes Agent на 217.73.119.26).
**Кому:** fullstack-разработчик на другом сервере.
**Контекст:** бот-команда из 4 человек (architect / backend-bot / frontend-bot / qa-docs-bot) зависла на 16+ часов в Phase 3 (последняя задача MC-034). Нужно **закончить Фазу 3 + довести проект до MVP** без этой бот-инфраструктуры.

---

## 1. Что уже сделано (НЕ ТРОГАТЬ)

| Phase | Tasks | Merged (SHA) | PR(s) |
|---|---|---|---|
| Phase 0 — Foundation | MC-001..005 | main | #1–#5 |
| Phase 1 — Auth, profile, design | MC-010..014 | main | #6–#14 |
| Phase 2 — Catalogs, fridge | MC-020..023 | main | #10–#14 |
| Phase 3a — Recipes+nutrition+recommendation | MC-030..033 | main | #15, #17, #19, #20, #22, #23 |
| Phase 3b — Recipe page UI | MC-035 | main | #21 |
| **Phase 3c — Today page UI** | **MC-034** | **⏳ WIP, НЕ merged** | **PR не открыт** |

**main = `d8540d4` (HEAD)** — это стабильная точка, от неё пляшем.

Что в `main` кодовой базы:
- `apps/api` — NestJS API с модулями `auth/`, `profile/`, `household/`, `ingredients/`, `pantry/`, `health/`, `common/`, **`recipes/`**, **`recommendations/`**, `common/csrf-guard.ts`.
- `apps/web` — Next.js фронт с `/auth`, `/fridge`, `/today` (layout), `/plan`, `/profile`, `/shopping`, `/recipe/[id]`, `/plan/setup`.
- `packages/nutrition` — детерминированный КБЖУ пакет (MC-030).
- `packages/database` — Prisma schema (24 модели), миграции + seed для 269 рецептов.
- `packages/recommendation` — 7-факторное scoring + 5 hard filters + 8 антирецептов + `chainTags?`.
- `packages/contracts` — Zod-схемы + Swagger (`/api/docs`).
- `packages/ui` — design tokens.
- `.github/workflows/ci.yml` — 5 jobs (build, test, typecheck, lint, secret-scan). Параметры уже учтены: `pnpm turbo run build --filter=@multichef/web...` step + `--concurrency=2` + `--max-old-space-size=8192` на typecheck.

---

## 2. Что НЕ доделано — список задач в работе

### **MC-034 (web `/today`)** — главный наследник

**Состояние:** файлы созданы фронтботом, лежат в **working tree** (НЕ committed), ветка `feature/MC-034-today-wizard-result` существует локально и на remote НЕ запушена.

**Что сделано (in working tree):**
- `apps/web/src/lib/recommendations-client.ts` (client API: getRecommendationsToday, acceptRecommendation с mock)
- `apps/web/src/hooks/usePreferences.ts`
- 7 компонентов `/today`: `Greeting`, `UrgentBlock`, `BudgetProgress`, `QuickScenarios`, `HeroButton`, `UpcomingMeals`, `RouletteLink`
- `apps/web/src/app/(app)/today/page.tsx` + `TodayClient.tsx`
- wizard: `generate/{WizardClient, page}.tsx` + 3 шага (`BudgetStep`, `TimeStep`, `AntiRecipesStep`)
- loading: `loading/{LoadingClient, page}.tsx` + sessionStorage helpers
- result: `result/{ResultClient, page}.tsx` + `ExplanationChip`, `ChainTimeline`, `OptionCard`
- заглушка `/shopping/[listId]/page.tsx`
- e2e spec не создан
- тесты: только `__tests__/TodayComponents.test.tsx` (unit компонентные), `recommendations-client.test.ts` не написан

**Известные TS-ошибки (нужно исправить перед коммитом):**
1. `ResultClient.tsx`: `toast(...)` API неверный — нужен `toast.show(...)` или `toast.info(...)`.
2. `ResultClient.tsx`: `result.error.error.status` — у `ErrorEnvelope` нет поля `status`. Убрать проверку или использовать другой код.
3. (После фикса ошибок) запуск `pnpm --filter @multichef/web typecheck` покажет ещё нюансы — тестируйте итеративно.

**Продуктовые решения (применять как есть, не менять):**
- Дисклеймер КБЖУ — ссылка «Подробнее о КБЖУ» → `/recipe/[id]`, **не дублируем** в карточке.
- `GET /profile` graceful fallback — пустой `preferences={}` если endpoint down.
- Quick-scenario «Срочно» = `MINIMAL + maxMinutes=20 + [SHORT_TIME, NO_MULTISTEP]`.
- loading 500 мс — оптические стадии (только если POST > 200 мс).
- `/shopping/[listId]` — заглушка создана, MC-053 задействует.

**Что должен сделать новый разраб:**
1. Закоммитить всё одним коммитом в ветке `feature/MC-034-today-wizard-result`:
   ```
   feat(MC-034): /today page with greeting, urgent block, wizard, 3-card result, accept-recommendation
   ```
2. Запушить в origin, открыть PR.
3. Перед коммитом: `pnpm --filter @multichef/web test` 3 раза подряд (polling tests), typecheck, lint-fix, build.
4. Дождаться зелёного CI, squash-merge.
5. После merge в main: STATUS.md обновить, MC-034 в колонке ✅.

### **MC-040 (Спаси продукт)** — следующая главная задача

**Состояние:** ADR готов в `/root/.hermes/plans/MC-040-rescue-product.md` (создан архитектором). Backend-бот создал локальную ветку `feature/MC-040-rescue-backend` БЕЗ коммитов. Ничего из работы не сохранено.

**Что нужно сделать (по ADR):**
- Backend: `POST /api/v1/recommendations/rescue {ingredientId, maxMinutes?, antiRecipes?}` с privacy-404 («Продукт не найден в холодильнике»), `pantryUsage.{usedGrams,totalGrams}`, noveltyScore (8-й фактор).
- Frontend: `/fridge/rescue` — picker продукта + карточки.
- Reuse существующий `rescueFilter` в `packages/recommendation/src/filters/rescue.ts` через `ctx.rescue.targetIngredientId`.
- Non-breaking additions: расширить `TodayRecommendationDtoSchema` через `addOptional('pantryUsage', ...)`.
- 13 пунктов в `MC-040-rescue-product.md`.

**После MC-040:** MC-042 (Кулинарная рулетка), затем Фаза 5 (MC-050..056, BullMQ + планировщик + shopping list + web pages), Фаза 6 (заготовки), Фаза 7 (PWA + прод).

---

## 3. Что есть на сервере (используй)

### 3.1 Доступ к серверу
- **IP:** `217.73.119.26` (внешний).
- **SSH:** на `root@217.73.119.26`, порт 22, только ключ.
- **Пользователи на сервере:** только `root` (uid 0). Если нужен отдельный user — попроси завести (или используй `root`).
- **SSH-ключ разраба:** добавь свой публичный ключ в `/root/.ssh/authorized_keys`.

### 3.2 GitHub
- **Repo:** `git@github.com:Gavroid/MULTI-CHEF.git` (private).
- **Branches:** 24 feature-ветки в `origin/feature/MC-XXX*` — ВСЕ merged, кроме:
  - `origin/feature/MC-035-recipe-page` (merged → b6fbcff в main)
  - `origin/feature/MC-033-chain-tags-dto` (merged → 4fd682c)
  - `origin/feature/MC-033-recommendations-endpoints` (merged → d8540d4)
  - Локально есть `feature/MC-034-today-wizard-result` (без коммитов) и `feature/MC-040-rescue-backend` (без коммитов) — обе НЕ pushed.
- **PAT (read+write+admin:repo_hook):** `/root/.config/gh/host.yml` (`oauth_token` field). Если gh CLI не установлен — используй curl с этим токеном.
- **CI/CD-ключ:** `/root/.ssh/id_ed25519_actions_deploy` — для GitHub Actions к этому серверу.
- **CICD-ключ:** `/root/.ssh/id_ed25519_cicd` — для general use.

### 3.3 Рабочая директория
- `/root/workspace/multichef` — клон репо. Branch: смотри актуальный статус.
- `git status -sb` покажет на какой ветке ты.

### 3.4 Nginx + открытые порты (для отладки, если нужно публично)
- nginx :80 → root отдает 302 на `/hermes/` (Hermes WebUI).
- Hermes WebUI: `/hermes/` → `http://127.0.0.1:8787/` (только для оператора, НЕ для приложения).
- KLVR debug: `/klvr-debug/`.
- Filebrowser: `/files/`.
- `apps/api` (NestJS) и `apps/web` (Next.js) НЕ выставлены наружу — нужно поднимать reverse-proxy (MC-071, ещё не делался).

### 3.5 Документация
- `docs/MULTICHEF-ARCHITECTURE-PRD.md` — основной PRD, 6+ глав.
- `docs/MULTICHEF-DEVELOPMENT-PLAN.md` — каталог задач MC-001..075 с scope и DoD.
- `docs/adr/` — 21 ADR (решения архитектора).
- `docs/api/conventions.md` — Zod-стиль, mappers, CSRF.
- `README.md` (в корне multichef) — quick start.

### 3.6 Планы и история
В `/root/.hermes/plans/`:
- `STATUS.md` — текущий статус (обновляется после merge).
- `manager-decision-log.md` — append-only история архитектурных решений + CI-фиксов.
- `manager-product-decisions.md` — мои продуктовые решения.
- `MC-XXX-*.md` — ADR от архитектора.
- `goal-autonomous-mvp.md` — определение MVP, watchdog ботов, anti-patterns.
- `skill-patch-recommendations.md` — notes.

---

## 4. Что НЕ работает (зависло) — что разраб должен игнорировать

- **Бот-команда (`@architect`, `@backend-bot`, `@frontend-bot`, `@qa-docs-bot`)** — 16+ часов не отвечает. Сегодня ПЫТАЛСЯ запустить их через `message_agent` — все 4 прислали PONG-RESTART, но после этого НИ ОДИН не завершил свою задачу. Working tree frontend-бот наполнил (24 файла MC-034 в `feature/MC-034-today-wizard-result`), но закоммитить не смог. Backend-бот создал ветку MC-040 локально, но 0 коммитов.
- **PONG-RESTART ping:** можно слать для re-engage, но результата нет. Не трать время на ботов.
- **Возможные причины зависания:**
  1. Сеть между bot_mode_dm и Hermes gateway может быть нестабильной — стоит смотреть `~/.hermes/gateway.log`.
  2. Компакция контекста: @backend-bot до сброса имел 1126 msgs / 6.3M input tokens.
  3. Каждый фон-процесс имеет resource limit (`notify_on_complete`).
  4. Скорее всего — race conditions между message_agent и файловой системой; код написан, но commit не прошёл.

**Рекомендация:** не трогай `~/.hermes/profiles/`. Если хочешь продолжить с бот-инфрой — сделай это сам вне зоны моего goal. Иначе — **просто пиши код как обычный разраб**.

---

## 5. Что разраб должен делать (минимум для MVP)

### Сейчас (ближайшие 30 минут)
1. Подключись по SSH к серверу: `ssh root@217.73.119.26`.
2. Склонируй репо (если нет): `git clone git@github.com:Gavroid/MULTI-CHEF.git` (или используй существующий `/root/workspace/multichef`).
3. Открой **handover-task** в твоём трекере (или создай как `feature/MC-034-today-wizard-result` локально, если origin удалил).
4. Изучи PRD §2.3.2–2.3.4 (страница /today).
5. Прочитай `manager-product-decisions.md` (5 решений по MC-034) + ADR `MC-034-web-today-wizard-result.md` + ADR `MC-040-rescue-product.md`.

### План работы (MVP)

| Task | Scope | Sequence |
|---|---|---|
| **MC-034 (закончить)** | `apps/web/src/app/(app)/today/*`, `lib/recommendations-client.ts`, tests | **First** — only MC left in Phase 3 |
| **MC-040 (Спаси продукт)** | backend endpoint + web `/fridge/rescue` | After MC-034 |
| MC-042 (Кулинарная рулетка) | web `/today/roulette` | After MC-040 |
| MC-050..056 | BullMQ + MealPlan + ShoppingList + web | After MC-042 |
| MC-060..062 (Phase 6) | PrepSession + web `/prep/*` | After Phase 5 |
| MC-070..075 (Phase 7) | PWA + nginx gateway + scripts + Playwright + observability + deploy | After Phase 6 |

**MVP-сценарий (из goal-autonomous-mvp.md):** юзер видит `/today` → получает рекомендацию → принимает → план создан → shopping list → покупки (E2E).

### Пошаговый workflow (как работал менеджер)

```
1. Прочитать STATUS.md (снапшот)
2. Прочитать PR (если есть) или ADR
3. Создать ветку feature/MC-XXX (от main d8540d4)
4. Написать код + тесты
5. Проверить CI locally:
   - pnpm install --frozen-lockfile
   - pnpm --filter @multichef/web test  (3 times, exit 0)
   - pnpm --filter @multichef/web typecheck
   - pnpm --filter @multichef/web lint
   - pnpm --filter @multichef/web build
6. git add, git commit (commitlint header ≤72 chars)
7. git push origin feature/MC-XXX
8. Создать PR на GitHub: gh pr create
9. Дождаться CI (5 jobs: build, test, typecheck, lint, secret-scan) все зелёные
10. Squash-merge в main: gh pr merge --squash
11. Обновить STATUS.md
12. Append в manager-decision-log.md (для архитектурных решений) или manager-product-decisions.md (для продуктовых решений)
```

### GitHub CLI
- Не установлен. Используй `curl` с PAT для API: `curl -H "Authorization: token $(grep oauth_token ~/.config/gh/host.yml | awk '{print $2}')" https://api.github.com/repos/Gavroid/MULTI-CHEF/pulls/...`
- Или установи: `apt install gh` + `gh auth login --with-token < token`.

---

## 6. Ключевые gotchas (на чём мы обожглись)

### CI уже настроен, но есть нюансы:

1. **Heap для typecheck:** CI typecheck требует `NODE_OPTIONS: --max-old-space-size=8192`. Уже прописано в `.github/workflows/ci.yml` — не убирай.
2. **Workspace deps:** для веб-тестов нужен `pnpm turbo run build --filter=@multichef/web...` step CI (он уже есть). Не удалять.
3. **Concurrency:** `--concurrency=2` для turbo test. Не убирать.
4. **TS2589 и zod-to-json-schema:** для сложных Zod-схем (с discriminatedUnion, ZodOptional+ZodArray) вызов `zodToJsonSchema` падает с `Type instantiation is excessively deep`. Решение в MC-033: кастить через `as never`. Применять при создании swagger schemas: `zodToJsonSchema(schema as never, {name, target: 'openApi3'})`.
5. **Polling вместо sleep в тестах:** фиксированный `await sleep(10)` нестабилен на CI. Использовать helper `waitFor(predicate, {intervalMs:5, timeoutMs:2000})`.

### CSRF
- **Soft mode** (MC-033): guard проходит если нет cookie. Hard-fail — tech-debt, ADR ещё не написан. Если включаешь state-changing endpoint — обязательно CSRF.

### Prisma + Decimal
- `Decimal` (от Prisma) → `.toNumber()` для арифметики. НЕ делить Decimal на число без `.toNumber()`.
- Float — только в display.

### Документация
- Перед коммитом проверь, что обновил `docs/adr/ADR-XXXX-*.md` если менял архитектуру.

---

## 7. Часто задаваемые вопросы (для разраба)

**Q: gh CLI нет, как делать PR?**
A: `curl -X POST -H "Authorization: token $(grep oauth_token ~/.config/gh/host.yml | awk '{print $2}')" https://api.github.com/repos/Gavroid/MULTI-CHEF/pulls -d '{"title":"...","body":"...","head":"<branch>","base":"main"}'`

**Q: Postgres для интеграционных тестов не поднимается локально?**
A: Используй Testcontainers (Docker должен быть). Или запусти локально `docker compose up -d postgres` (есть в `docker-compose.yml`).

**Q: Можно ли склонировать /root/workspace/multichef локально?**
A: Да, через rsync или git clone.

**Q: Куда класть новые ADR?**
A: `docs/adr/ADR-0022-*.md`. Структура — посмотри существующие 21 ADR.

**Q: Где Drizzle, Migrations?**
A: Prisma. `apps/api/prisma/migrate` (или `packages/database/prisma/`).

**Q: Как проверить покрытие?**
A: `pnpm --filter @multichef/api test -- --coverage` (c8/v8 встроен).

**Q: Что за abracadabra `chainTags?`?**
A: `chainTags?: string[]` — опциональное поле в Recipe для menu chaining (recipe today → base for recipe tomorrow → base for recipe 2 days later). MC-032 mini-PR добавил.

**Q: Где определены 8 антирецептов?**
A: `packages/recommendation/src/constants.ts` — `ANTI_RECIPE_PREDICATES`. Тактическая константа PRD §2.3.3. **НЕ МЕНЯТЬ** без архитектурного решения.

---

## 8. Сохранить состояние

Перед тем как закончить сессию, обнови:
- `STATUS.md` — статус Phase 3.
- `manager-product-decisions.md` — новые продуктовые решения (если были).
- `manager-decision-log.md` — архитектурные изменения (если были).

Если работа зависла и ты уходишь — добавь запись в `manager-decision-log.md`:
```
## DATE — NEW-DEVELOPER takeover
**Контекст:** старая команда менеджера зависла. new developer X взял задачу.
**Состояние:** WIP на feature/MC-034-today-wizard-result, ~24 файла.
**Что сделано:** ...
**Что осталось:** ...
```

---

**Удачи! Если будут вопросы — пиши менеджеру на этом же сервере (если боты оживут). Иначе — действуй как обычный разработчик с этим handover.**
