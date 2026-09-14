# Технический, продуктовый и UI-аудит MULTI-CHEF (вторая итерация)

**Дата:** 2026-09-14  
**HEAD:** `d5883d5 chore(audit): docs/AUDIT-REPORT + lint fix in import-recipes.ts`  
**Цель:** найти находки, пропущенные в первой итерации.

## TL;DR

Первая итерация (`AUDIT-REPORT.md`) выявила 6 проблем (B1–B6). Эта итерация находит ещё **9 новых находок** (M1–M9), четыре из которых критичны:

- 🔴 **M1 — `Idempotency-Key` хедер не дедуплицирует**. Только валидируется.
- 🔴 **M2 — WCAG AA-fail на primary CTA**: white-on-#e8590c = **3.58:1** (нужно ≥ 4.5).
- 🔴 **M3 — DB Seq Scan на `/recipes`**: каждый запрос сканирует 2000, **отбрасывая 1731**.
- 🟠 **M4 — Нет password reset / account deletion / email verify**.

Плюс 5 второстепенных.

---

## 1. Технические находки (углублённый проход)

### M1. Idempotency-Key не дедуплицирует 🔴

- **Что:** Хедер `Idempotency-Key` (MC-010) валидируется только на присутствие и формат (≥16 символов), реальной дедупликации нет.
- **Доказательство:** Два повторных POST `/pantry/items` с одним `Idempotency-Key` возвращают `CREATED` дважды. Сравните с JobsService: там есть реальная дедуп по `paramsHash` и 5-мин окну (`apps/api/src/jobs/jobs.service.ts:34-67`).
- **Код:** `apps/api/src/common/idempotency.ts:5-10` — комментарий прямо признаёт: «Real cache-backed deduplication is MC-051 work. For MC-010 we only validate the header.»
- **Воздействие:** Клиенты, разумно полагающиеся на RFC 9458 / Stripe-pattern, получают **двойные записи** при обычных retry.
- **Фикс:** Redis-backed dedup (24h TTL, request-fingerprint). Альтернативно — вынести обязательность хедера из публичной документации, пока dedup не готов.

### M2. WCAG AA-fail на primary CTA 🔴

| Сочетание                                  | Коэффициент | WCAG AA (4.5)? |
| ------------------------------------------ | ----------- | -------------- |
| `#ffffff` на `#e8590c` (primary CTA light) | **3.58**    | ✗ FAIL         |
| `#8a8177` на `#fffdf9` (text-muted light)  | **3.77**    | ✗ FAIL         |
| `#ffffff` на `#ff7a1a` (primary CTA dark)  | 6.06        | ✓              |
| `#9a9084` на `#1a1713` (text-muted dark)   | 5.69        | ✓              |

- **Файл:** `apps/web/src/app/globals.css:30-58`.
- **Воздействие:** Нарушает WCAG 2.1 Level AA для primary-кнопок в светлой теме (для людей с ослабленным зрением, в солнечном свете).
- **Фикс:** `--color-primary` → `#c4490a` (~4.9:1) или dark-text на primary.

### M3. DB Seq Scan на `/recipes` 🔴

```
EXPLAIN ANALYZE SELECT id, title FROM "Recipe"
 WHERE sourceType="'CURATED' AND status="'PUBLISHED'
 ORDER BY "createdAt" DESC, id DESC LIMIT 50;
→ Seq Scan on "Recipe"  (cost=0.00..410.00 rows=269 width=95)
  Filter: ((sourceType="'CURATED'...) AND (status="'PUBLISHED'...))
  Rows Removed by Filter: 1731
```

- Сейчас 1.3 ms; при 20k рецептов упадёт до десятков ms.
- **Фикс:**

```sql
CREATE INDEX recipe_curated_published_cursor_idx
  ON "Recipe" ("sourceType", "status", "createdAt" DESC, "id" DESC)
  WHERE "sourceType" = 'CURATED' AND status = 'PUBLISHED';
```

### M4. Password reset / account deletion отсутствуют 🟠

- `resetPassword | forgotPassword | changePassword` — **0 совпадений** в `apps/api/src`.
- `User.status` enum включает `DELETED`, но контроллера `DELETE /users/:id` или `softDelete` — нет.
- `verifyEmail | emailVerified | sendEmail` — нет.
- **Фикс (минимум):**
  1. `POST /auth/forgot-password` + SES/SMTP токен
  2. `POST /auth/reset-password`
  3. `DELETE /users/me` (soft-delete)

### M5. JobsService дeдуп-окно = 5 минут — слишком длинное 🟠

- `IDEMPOTENCY_WINDOW_MS = 5 * 60_000` в `apps/api/src/jobs/jobs.service.ts:33`.
- Генерация плана в 11:00 + повтор в 11:04 → возвращает **тот же старый** план.
- **Фикс:** 30 секунд для `GENERATE_PLAN`, либо «обновлено N мин назад, перегенерировать?» в UI.

### M6. CSP: `style-src "'unsafe-inline'` 🟡

- Позволяет `<style>`-инъекции, history-leak, exfil via `background-image: url`.
- **Фикс:** nonce-based CSS (сложно для Next.js + Tailwind), либо Tailwind-only.

### M7. Backup без шифрования, на том же хосте 🟡

- `pg_dump | gzip > /var/lib/multichef/backups/`. Plain SQL + users + pantry.
- **Фикс:** `gpg --encrypt` + offsite копия (scp/S3).

### M8. CSP без `connect-src`, `worker-src`, `manifest-src` 🟡

- Default-src 'self' спасает, но явное объявление — best practice.

### M9. Дополнительно найдено ℹ️

- ✅ Worker concurrency = 2, BullMQ requeues stalled jobs.
- ✅ 10 параллельных планов с одинаковым телом → один `jobId` (paramsHash dedup).
- ✅ Multi-tenant изоляция: PantryItem фильтруется по `householdId`, user B получает 404 на user A items.
- ✅ Logout чистит и `mc_session`, и `localStorage("'mc_user')`.
- ✅ Anti-flash inline-скрипт в layout устанавливает `data-theme` до гидратации.
- ✅ Recipe images: правильный `alt={recipe.title}` + graceful fallback `<ChefHat>` icon при `imageFailed`.
- ✅ Latency: `/api/v1/recipes?limit=20` ≈ 11 ms.
- ✅ 0 npm-уязвимостей (PNPM 9.15.9 повторно).
- ✅ 0 orphan imageKeys (4000 webp на диске: 2000 main + 2000 thumb).
- ✅ 144/300 ингредиентов имеют алиасы (52%).

---

## 2. Продуктовые находки

### P2.1 CSRF-cookie ротация только при успехе login

- Не bug, но в сочетании с M1 может маскировать реальные дубли.

### P2.2 144/300 ингредиентов без алиасов

- Для MVP нормально, но при плановом import из внешних источников — coverage увеличить.

### P2.3 Pantry POST shape: подводный камень

- Реальная схема: **плоский объект** `{ingredientId, quantityG, unit, ...}`, НЕ `{items: [...]}`.
- В первой итерации аудита мой curl отправлял `{items:[...]}` → 400 каждый раз.
- Реальные пользователи работают нормально (UI шлёт правильную форму).

---

## 3. UI-находки (углублённый проход)

### U2.1 WCAG primary CTA — 3.58:1 🔴

См. M2.

### U2.2 ThemeToggle h-10 w-10 = 40×40 — ниже WCAG 2.5.5 (44×44) 🟡

- `apps/web/src/components/ThemeToggle.tsx:32-42`. BottomTabBar — `h-14` (56px) ✓.
- **Фикс:** `h-11 w-11`.

### U2.3 PWA `background_color: "#ffffff"` расходится с dark 🟡

- Splash для PWA всегда белый, даже если dark-тема.
- **Фикс:** использовать dark-фон в dark mediaquery.

### U2.4 Icon-only кнопки: `<span aria-hidden="true">` ✅

- `ThemeToggle`, отключенные `Button → aria-busy="true"`. a11y-фундамент крепкий.

### U2.5 `/today/result`: «Failed to fetch» без крупной «Повторить» 🟡

- Кнопка есть в LoadingClient, визуально мелкая.

---

## 4. Сводка таблицей

| #      | Приоритет | Зона     | Находка                                            | Где                                    |
| ------ | --------- | -------- | -------------------------------------------------- | -------------------------------------- |
| **M1** | **P0**    | API      | Idempotency-Key не дедуплицирует                   | `apps/api/src/common/idempotency.ts`   |
| **M2** | **P0**    | UI/a11y  | WCAG AA-fail primary CTA 3.58:1                    | `apps/web/src/app/globals.css`         |
| **M3** | **P0**    | DB-perf  | Seq Scan `/recipes` без compound-индекса           | PG index plan                          |
| M4     | P1        | Product  | Нет password reset / account-delete / email verify | `apps/api/src` (отсутствует)           |
| M5     | P1        | API      | Idempotency window = 5 мин — слишком длинный       | `apps/api/src/jobs/jobs.service.ts:33` |
| M6     | P2        | Security | CSP: `style-src "'unsafe-inline'`                  | CSP header                             |
| M7     | P2        | Infra    | Backup без шифрования на том же хосте              | `infrastructure/scripts/backup.sh`     |
| M8     | P3        | Security | CSP без connect-src / worker-src                   | CSP header                             |

## 5. Что НЕ удалось проверить

- 🟡 Полный axe-core a11y scan (нет axe-core в репо).
- 🟡 Web Vitals (CLS/LCP) — без headless lighthouse.
- 🟡 Storybook coverage — design-system без storybook.
- 🟡 Multi-домен deployment — NEXT_PUBLIC_APP_BASE_URL лочит на 1 хост.
- 🟡 Email bounce handling.

## 6. Рекомендации

1. **(P0, 30 мин)** M1: Redis-backed dedup по `Idempotency-Key`.
2. **(P0, 1 час)** M2: `--color-primary` → `#c4490a`.
3. **(P0, 15 мин)** M3: partial-index.
4. **(P0, 4-8 часов)** M4 epic: password reset + soft delete + email verify.
5. **(P1)** M5: `IDEMPOTENCY_WINDOW_MS = 30_000` для `GENERATE_PLAN`.
6. **(P2)** M6–M8: CSP cleanup, encrypted backups.
7. **(P0, continuation)** Из **первой итерации**: закрыть B1 (каталог) и B2 (onboarding 500) — по-прежнему критичны.

## 7. Артефакты

- Этот отчёт: `docs/audit/AUDIT-REPORT-2.md`
- Первая итерация: `docs/audit/AUDIT-REPORT.md`
- Скриншоты (48 шт. mobile + desktop + dark): `/home/multichef_app/shots/*.png`
- Метрика контрастов / EXPLAIN ANALYZE: см. терминальный лог этого сеанса.
