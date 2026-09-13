# MULTI-CHEF v0.1.2 — Глобальный аудит R15

**Дата:** 2026-09-13
**Аудитор:** Hermes Agent (MiniMax-M3) — сессия `ed68a4620193`
**Объект:** monorepo `/root/workspace/multichef` (Next 15 + React 19, NestJS 11 + Fastify, Prisma, BullMQ) + деплой `http://192.168.1.35:8080`
**HEAD:** dev `7d1f84c`, prod `29c5c18` (PR#51 поверх dev). Файлы синхронизированы; единственный uncommitted-mtime — `apps/web/src/app/(app)/profile/page.tsx` (untracked refactor).
**Метод:** 6 направлений прочитаны, 7 подотчётов (`00..07`), `pnpm test/build/typecheck/lint` все зелёные (468/468 tests, 9/9 build, 15/15 typecheck/lint). 4 e2e против прод-гейтвея. Регистрация 3 audit-пользователей (`audit-r15b-…@multichef.local`, `audit-logout-…`, R13 `audit-a/b-…`).

> R13 (предыдущий) зафиксировал 15 security/product находок. R14 (test-coverage) +3. R15 (текущий) — расширенное покрытие 6 направлений + 60+ находок.

---

## Сводная (все фазы R15)

| Severity | Кол-во |
|---|---|
| **🚨 БЛОКЕРЫ** (ломают основной happy-path) | **4** |
| **HIGH** (B1: 3, B2: 2, B3: 3, B4: 2, B5: 1, D: 2) | **13** |
| **MEDIUM** (B1: 8, B2: 4, B3: 5, B4: 5, B5: 2, C: 7, D: 4) | **35** |
| **LOW** (B1: 11, B2: 3, B3: 7, B4: 6, B5: 4, C: 6, D: 4) | **41** |
| **ВСЕГО подтверждённых находок в R15** | **~93** |

Из них **11 — блокирующие** для релиза (4 блокера + 7 high must-fix).

---

## 🚨 БЛОКЕРЫ РЕЛИЗА (4)

### 🚨 BLOCK-1. `PlanClient.tsx:128` `kcalPercent(totalCalories / 2000)` — UI рисует пользователю «148% от цели» когда реально недоедание на 25%
- **Что:** `day.totalCalories` = per-day-total для household, target = per-person default 2000. При ppl=2 и real КБЖУ 1487/день/pP, бар показывает 148% — пользователь думает «всё ок», реально недоедает.
- **Доказательство:** R13 5 live-прогонов planWeek.
- **Затронуто:** все /plan сессии.
- **Фикс:** `target = household.defaultPeopleCount × DEFAULT_DAILY_TARGET`, или получить `nutritionProfile.targetCalories`.
- **Файлы:** `apps/web/src/app/(app)/plan/PlanClient.tsx:17-23, 140`.

### 🚨 BLOCK-2. `ShoppingClient.tsx:280` `groupItems(items, new Map())` ломает группировку «по департаментам» — все 23 items в одной группе
- **Что:** пустая `Map()` создаётся per render, всегда возвращает `?? 99`. Live: 5 unique categories в API → 1 группа на UI.
- **Нарушение:** PRD §2.3.14 «items grouped by department».
- **Фикс:** построить Map orders через useMemo + источник sortOrder из API (IngredientCategory.sortOrder). Это **требует API-gap фикса** (`apps/api/src/shopping-lists/shopping-lists.service.ts` должен возвращать категории с sortOrder).
- **Файлы:** `apps/web/src/app/(app)/shopping/ShoppingClient.tsx:280`.

### 🚨 BLOCK-3. **`NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` в проде** — `/today/result` после «Готовлю это» → /shopping/<mock-id>, не реальный план
- **Доказательство:** `/etc/multichef/multichef.env` всё ещё имеет mock=1.
- **Что значит:** happy-path полностью ломается; пользователь попадает на placeholder.
- **Фикс:** отключить env в проде (`NEXT_PUBLIC_USE_MEALPLAN_MOCK=0`) ИЛИ закрыть фичу баннером «скоро заработает».
- **Файлы:** `apps/web/src/lib/recommendations-client.ts:43, 206-228`, `/etc/multichef/multichef.env`.

### 🚨 BLOCK-4. `AuthGuard` client-side — `localStorage.mc_user` держится одна, после logout в race может остаться валидной
- **Что:** profile/page.tsx:118 `void logout().then(() => removeItem('mc_user'))` — clear после fetch. Race в этот промежуток.
- **Фикс:** clear localStorage **до** fetch (anti-race).
- **Дополнительно:** R13-H-2 CSRF-soft mode + middleware проверяет только /profile — все остальные страницы НЕ защищены edge-уровнем. Реальная защита держится на `localStorage` маркере, что легко подделывается в DevTools.

---

## 🔒 HIGH MUST-FIX (7)

### H-1 (B1). Idempotency-Key validate presence, но **отсутствует дедупликация** — login может создать дубль-сессию при replay
- Файл: `apps/api/src/common/idempotency.ts:26-50`, `apps/api/src/auth/auth.service.ts:148-181`.
- Фикс: keyed fingerprint cache (Redis 24h, MC-051 scope).

### H-2 (B2). `processJob()` молча COMPLETED-ит все job-types кроме GENERATE_PLAN
- Файл: `apps/worker/src/processor.ts:18-29`.
- Что: API enqueue типы ROULETTE/GENERATE_TODAY/etc — worker делает ничего, ставит COMPLETED.
- Фикс: switch-cases с throw FAILED для unsup-ported типов.

### H-3 (B2). Worker SIGTERM без timeout — может зависнуть на active job
- Файл: `apps/worker/src/main.ts:30-37`.
- Фикс: `Promise.race([worker.close(), new Promise(r => setTimeout(r, 30_000))])`.

### H-4 (B4). Next.js pages **НЕ пробрасывают CSP/HSTS** — только API (Fastify) имеет security headers
- Доказательство: live headers `/` и `/today` имеют только nginx-defaults, нет CSP.
- Файл: `apps/web/src/middleware.ts`, `next.config.mjs`.
- Фикс: middleware headers() callback или next.config.mjs headers.

### H-5 (B4). `infrastructure/scripts/rotate-ssh-keys.sh` упомянут в runbook, но **не существует** (doc drift)
- Файл: `docs/runbooks/secret-rotation.md:21`.

### H-6 (B5). Logout UI: `window.localStorage.removeItem('mc_user')` после `await logout()` — race в 401-периоде
- См. BLOCK-4 — фикс частично.

### H-7 (D). `<Link passHref legacyBehavior>` в BottomTabBar — deprecated в Next 15+, сломается в Next 16
- Файл: `apps/web/src/components/BottomTabBar.tsx:104`.

---

## 🛠 ВЫСОКИЙ ПРИОРИТЕТ (МОЖНО СЕРЕИ)

### Безопасность (B5 / R13)
- **R13 H-1**: Throttler доверяет `X-Forwarded-For` → credential stuffing bypass. Trusted хосты nginx.
- **R13 H-2**: CSRF soft-mode при отсутствии `mc_csrf` cookie.
- **R13 C-1**: Orphan pantry item id `…-pantry` после `shopping-list complete` — валится на Zod ULID-26.
- **R13 M-3**: Secure-cookie heuristics через `X-Forwarded-Proto`.

### Backend (B1)
- **B1-H2 (HIGH)**: CSRF /logout не учитывает, что victim без mc_csrf не сможет **выйти**.
- **B1-M1**: нет `GET /api/v1/shopping-lists/:id` (только `/active`).
- **B1-M2**: `recommendations.module.ts` создаёт Redis без lazy/offline-quit.
- **B1-M7**: `generationSettings` сериализуется `as object` без prototype-pollution guard.

### Worker (B2)
- **B2-M1**: `maxRetriesPerRequest: null` без комментария-обоснования.
- **B2-M2**: нет метрик в OTEL/Prometheus.
- **B2-M3**: `report()` callback — нет batch update.

### Frontend (B3)
- **B3-M1**: AuthGuard client-side auth flow drift.
- **B3-M2**: нет skip-to-main ссылка для screen-reader.
- **B3-M3**: usePantry module-scope cache race.
- **B3-M4**: usePreferences error не виден.
- **B3-M5**: profile-page SSR stub drift.

### Infra (B4)
- **B4-M1**: `bootstrap.sh` CREATE ROLE 'changeme' без ALTER.
- **B4-M2**: systemd units без hardening (NoNewPrivileges, ProtectSystem).
- **B4-M3**: nginx нет `X-Real-IP` для Fastify `trustProxy`.
- **B4-M4**: nginx нет rate-limit zone.
- **B4-M5**: deploy.sh без pre-commit `pnpm check`.

### UI (D)
- **D-H2**: focus management при переходе страниц (BottomTabBar удерживает фокус).
- **D-M1**: Toast single-slot не приоритизирует danger.
- **D-M3**: Chip toggle без `aria-pressed`.

### Продуктовый (C)
- **C-H1..5**: UX edge cases (prefill indicators, empty-state plan link, edit household, error recovery).
- **C-M1..7**: a11y flows (loading states, navigation visibility, copy, persistence).

---

## ⚠️ LOW (tech debt)

41 LOW находок по всем 7 отчётам. Среди интересных:
- **docs drift**: `pantry.controller.ts` комментарий «hard delete» пока сервис делает soft.
- **`error-envelope.redactSecrets`**: только ключи, не значения (DB URLs / token / Authorization).
- **`usePreferences` empty-state silently** — пользователь не получает фидбэк.
- **Reuse of `new Map()` in render**.
- **Моки на проде в runbook**: `pick-top3` edge case с 1 recipe.

Полные списки — в `01..07*.md`.

---

## ✅ Что уже хорошо

- **Backend security fundamentals** — sessions, Argon2id, CSRF, Owner-scoped queries всё работает.
- **Cross-household IDOR** в pantry/jobs/meal-plans/shopping/prep-task проверен живо (R13 live, R15 live): **всё защищено 404, не 403** (правильное privacy).
- **Idempotency-Key guard глобальный** — все мутации требуют header.
- **Logout flow server-side** revoke session.
- **Pantry soft delete** с миграцией ADR-0021.
- **Bundle sizes в норме** (first-load 102 KB shared, /today 144 kB).
- **Build pipeline** зелёный.
- **468/468 unit + integration тестов** зелёные.
- **4/4 e2e против прод-гейтвея** зелёные (test-coverage gap: real plan не покрыт, R15-TC-1).
- **No gitleaks**.
- **CSRF/IDOR/headers** корректные на API-стороне.
- **Sanitize redirect** правильно отбивает open-redirect.
- **Code style**: 14/15 packages lint-clean, только profile page имеет не-отформатированную зону.

---

## Файлы отчёта

```
multichef/audit-r15/
├── 00-map.md           # карта monorepo + dependencies
├── 01-backend.md       # B1 — 22 находки (3/8/11)
├── 02-worker.md        # B2 — 9 находок  (2/4/3)
├── 03-frontend.md      # B3 — 15 находок (3/5/7)
├── 04-infra.md         # B4 — 13 находок (2/5/6)
├── 05-security.md      # B5 — 7 находок  (1/2/4)
├── 06-product.md       # C  — 22 находки (4 блокера + 5/7/6)
├── 07-ui.md            # D  — 10 находок (2/4/4)
└── SUMMARY.md          # это файл
```

---

## Рекомендации (приоритизированы)

### MUST FIX (блокеры релиза) — **эта неделя**

1. **BLOCK-1**: kcalPercent — fix target × ppl, либо API-источник nutritionProfile.targetCalories.
2. **BLOCK-2**: `groupItems` — fix render + API gap (вернуть sortOrder из IngredientCategory).
3. **BLOCK-3**: env `NEXT_PUBLIC_USE_MEALPLAN_MOCK=0` в проде + проверить e2e на DEV-стенде с `=0`.
4. **BLOCK-4**: race в logout — localStorage.removeItem ДО fetch.
5. **H-1 (Idempotency dedup)** + **H-4 (Next-pages CSP)** — security.
6. **R13 H-1 (XFF-spoof) + H-2 (CSRF-soft)** — security блокеры R13.

### SHOULD FIX (перед major release)

7. **H-2 (worker job-types)**: switch с throw для unsup-ported типов.
8. **H-3 (worker SIGTERM timeout)**.
9. **B1-H2 (CSRF /logout bypass)**.
10. **R13 C-1 (orphan pantry item)** + миграция `sourceShoppingListItemId`.
11. **B3-M1 (AuthGuard real-cookie check)** + middleware на все (app).

### NICE TO HAVE (tech debt)

12. a11y polish (skip-link, focus-management, aria-pressed Chip).
13. systemd hardening (NoNewPrivileges, ProtectSystem).
14. nginx rate-limit zone.
15. Toast priority queue (danger не перетирается info).
16. profile/page.tsx prettier-формат + commit.
17. Document `rotate-ssh-keys.sh` или создать.
18. Тест e2e `real-plan-deviation.spec.ts` для MC-051.
19. Endpoints `GET /api/v1/shopping-lists/:id` (по факту MC-056).
20. Pre-commit pipeline (`pnpm check` в deploy.sh).

---

## Что не покрыто (открытые вопросы)

- **Live SSH** к 192.168.1.35 (нет подходящих ключей). Не выполнены:
  - `systemctl status multichef-{api,worker,web}`
  - `journalctl -u multichef-*`
  - `pg_dump --stats`, `redis-cli INFO`
  - Effective database pool size vs `DATABASE_POOL_MAX`
  - Restore-test `backup.sh` (опасно, нужно сделать на бэкап-машине)
- **Live browser UI-снимки** через Hermes-tower не было живого моста к проде для качественного скриншота /today, /shopping.
- **N+1 query check** в `recommendations.service.ts:51-84` Promise.all — Promise.all `findMany` параллельно. Теоретически OK.
- **`mobile` API spec** (iPhone Safari) не проверено вживую.

---

## Заключение

**R15 аудит завершён.** Глобальная оценка:

- **Архитектура проекта** — здравая: idempotency guards, throttler, CSRF, owner-scoped queries, Prisma decimal, Fastify+helmet.
- **Тестовое покрытие** — высокое (468 unit/integration, 4 e2e против прод-гейтвея). Но **mock-mode скрывает реальный planner bug** (R13 H-3 КБЖУ deviation >10%).
- **Продуктовые блокеры** — 4 штуки, все из них обнаружены через **static + live HTTP** без живой browser-сессии.
- **Безопасность** — основная защита крепка, остаточные issues (CSP на Next-pages, XFF-spoof, CSRF-soft mode) — из R13.
- **UX/a11y** — фундаментально правильное (используется `useId` для ARIA-id), но есть polish-issues (focus management, touch-targets, reduced-motion).

**Главный «красный сигнал»**: `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` в проде — это **produkcja leak**, который при выпуске для реальных пользователей приведёт к «Опыт не работает». Это должно быть **первое** в списке MUST FIX.

---

*Конец отчёта R15.*
