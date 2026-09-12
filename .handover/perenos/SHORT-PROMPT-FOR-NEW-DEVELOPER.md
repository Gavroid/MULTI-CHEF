# SHORT PROMPT — для нового разработчика

> Копируй и вставляй в чат новому разработчику. Полная версия — `/root/.hermes/plans/HANDOVER-TO-NEW-DEVELOPER.md`.

---

Ты fullstack-разработчик, подключаешься к проекту **MULTI-CHEF** (NestJS API + Next.js web + pnpm monorepo + Postgres). Команда из 4 ботов (architect, backend-bot, frontend-bot, qa-docs-bot) на этом сервере зависла на 16+ часов. Игнорируй ботов, работай сам как обычный разраб.

## Где что
- **Сервер:** 217.73.119.26, root@, SSH по ключу.
- **Репозиторий:** `/root/workspace/multichef` (уже склонирован). Origin: `git@github.com:Gavroid/MULTI-CHEF.git`.
- **main = `d8540d4`** (стабильная точка). Всё что в main — рабочее и merged.
- **Документация:** `docs/MULTICHEF-ARCHITECTURE-PRD.md` (PRD), `docs/MULTICHEF-DEVELOPMENT-PLAN.md` (53+ задачи MC-001..075), `docs/adr/` (21 ADR).
- **Планы/история:** `/root/.hermes/plans/STATUS.md` + `manager-decision-log.md` + `manager-product-decisions.md` + `MC-XXX-*.md` ADRs.

## Что не доделано (на текущий момент)
1. **MC-034 — web `/today`.** Файлы фронтбот накидал в `feature/MC-034-today-wizard-result` (24 staged файла в working tree, **0 коммитов**). Не pushed. Нужно: исправить 2 TS-ошибки (`toast(...)` → `toast.info(...)`; `error.error.status` → убрать), добавить тесты, e2e, env-флаг `NEXT_PUBLIC_USE_MEALPLAN_MOCK`, закоммитить, запушить, открыть PR. ADR: `/root/.hermes/plans/MC-034-web-today-wizard-result.md`.
2. **MC-040 — «Спаси продукт».** ADR готов, бэкендбот создал локальную ветку `feature/MC-040-rescue-backend` (0 коммитов). Не pushed. Скоуп: backend `POST /api/v1/recommendations/rescue` + web `/fridge/rescue`. ADR: `/root/.hermes/plans/MC-040-rescue-product.md`.
3. **MC-042..MC-075** — потом (Фаза 4–7, см. development-plan).

## Технологии и как работать
- **Stack:** pnpm workspaces + Turborepo, NestJS, Next.js App Router, Prisma + Postgres, Zod, swagger via `zod-to-json-schema`, RHF, lucide-react. Design tokens из `packages/ui`.
- **Локальный прогон:** `pnpm install --frozen-lockfile && pnpm --filter @multichef/web test` (3 раза), typecheck, lint, build, e2e (Playwright).
- **CI:** 5 jobs (build, test, typecheck, lint, secret-scan). Параметры уже учтены: `--max-old-space-size=8192` на typecheck, `turbo build --filter=@multichef/web...` step, `--concurrency=2` на turbo test. Не меняй.
- **commits:** Conventional Commits, заголовок ≤72 символов (commitlint enforce).
- **Branches:** `feature/MC-XXX-...` от main; squash-merge в main через gh CLI (или curl+GitHub API с PAT из `/root/.config/gh/host.yml`).
- **Coverage:** branches ≥ 85% по новому коду.

## Gotchas (на чём обожглись)
- **TS2589 в swagger:** сложные Zod-схемы падают в `zodToJsonSchema`. Решение: `zodToJsonSchema(schema as never, {name, target: 'openApi3'})`.
- **Polling тесты:** НЕ использовать `await sleep(10ms)`. Helper: `waitFor(predicate, {intervalMs:5, timeoutMs:2000})`.
- **CSRF:** мягкий режим в `apps/api/src/app.module.ts`. State-changing endpoints требуют CSRF.
- **Prisma Decimal:** `decimal.toNumber()` перед арифметикой.
- **8 антирецептов** константа в `packages/recommendation/src/constants.ts` — не менять без ADR.

## MVP
Из `/root/.hermes/plans/goal-autonomous-mvp.md`:
- Phase 0–3 (вкл. MC-034, MC-035) + MC-040 + MC-042 (минимум Phase 4) + Phase 5 (без MC-053) + Phase 6 (полностью) + Phase 7 (PWA + nginx gateway + Playwright + прод).
- End-to-end: юзер открывает `/today` → получает рекомендацию → принимает → MealPlan создан → ShoppingList → покупки.
- Smoke E2E Playwright.

## Что НЕ делать
- НЕ менять архитектурный стек.
- НЕ мёрджить в main с красным CI.
- НЕ копировать API-ключи между профилями.
- НЕ изменять 8 антирецептов без ADR.
- НЕ удалять структуру пакетов без архитектурного обсуждения.
- НЕ игнорировать ботов — игнорируй. Не трать время, они зависли.

## Промт следующему разрабу
```
Я новый разработчик на проекте MULTI-CHEF. Мне нужно:

1. Ознакомиться с handover — /root/.hermes/plans/HANDOVER-TO-NEW-DEVELOPER.md (полная версия).
2. Продолжить работу с MC-034 (web /today):
   - прочитать ADR + решения
   - исправить 2 TS-ошибки в ResultClient.tsx
   - добавить недостающие тесты
   - закоммитить, запушить, открыть PR
   - дождаться CI, squash-merge
3. После merge начать MC-040 backend + frontend.

Сейчас на каком этапе?
```

---

**Контакты / если что-то не так:**
- Бот-команда — игнорировать.
- Сервер — `/root` + SSH.
- GitHub — PAT в `/root/.config/gh/host.yml`.
- Документация — `docs/`.
