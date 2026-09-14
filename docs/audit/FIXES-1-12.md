# FIXES-1-12: приёмка legacy-P0 бэклога по плану PLAN-P0-BACKLOG.md

**Дата:** 2026-09-14
**HEAD:** `b8c8a87 → финал этого захода` (см. git log). Прод: все три сервиса active, `health/ready 200`.

Приёмка выполнена по принципу «инвертированные команды исходного аудита» —
исходные улики в `VERIFICATION.md` (§T1–T4, §U1).

## WP-1 — nginx `server_tokens` (T2) ✅

Изменение: `/etc/nginx/nginx.conf:21` — `server_tokens off;` (было
закомментировано), `nginx -t` ok, reload.

| Команда                                | Было                            | Стало               |
| -------------------------------------- | ------------------------------- | ------------------- |
| `curl -sI :8080/`                      | `Server: nginx/1.24.0 (Ubuntu)` | **`Server: nginx`** |
| `curl -sI :8443/api/v1/health/live -k` | —                               | **`Server: nginx`** |
| `grep -icE "server:.*(1\.              | ubuntu)"`                       | 1                   | **0** |

`/` и `/api/v1/health/live` — 200 после reload.

## WP-2 — `<img>` атрибуты (T3) ✅

- `recipe/[id]/Header.tsx` (LCP): `loading="eager" fetchPriority="high" decoding="async"`, 4/3-wrapper резервирует геометрию.
- `OptionCard.tsx`: `loading="lazy" decoding="async" width=64 height=64`.
- Приёмка: в web нет ни одного `<img>` без атрибутов; `pnpm --filter @multichef/web build` ok; 221 web-тест зелёные.

## WP-3 — SEO (T1) ✅

| Команда             | Было (VERIFICATION §T1)     | Стало                                                                                |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `curl /robots.txt`  | **404**                     | **200**, 7 Disallow-правил (приватные + /api)                                        |
| `curl /sitemap.xml` | **404**                     | **200** (/, /auth/*, /design)                                                        |
| titles 5 страниц    | одинаковые, /profile пустой | уникальные: «Сегодня»/«Холодильник»/«План»/«Покупки»/«Профиль» + шаблон — MULTI-CHEF |
| OG                  | нет                         | og:title/og:description/og:site_name на публичных страницах                          |
| noindex приватных   | нет                         | `<meta name="robots" content="noindex, nofollow">` на (app)-экранах                  |

## WP-4 — WCAG color-contrast (U1) ✅

- `tests/e2e/axe-pages.spec.ts` — axe-гейт (serious/critical = 0 обязателен) на
  `/`, `/auth/login`, `/auth/register`, `/design`.
- Было: 5 правил / 42 узла. Стало: **4/4 страниц — 0 serious/critical**.
- Фиксы: `globals.css` light-токены `--color-text-muted #6f665c`,
  `--color-primary #c2410c`, `--color-primary-press #b23e0a`,
  `--color-fresh #1f7a33`, `--color-warning #9a6300`, `--color-danger #c92a2a`,
  `--color-info #1864ab` (все ≥4.5:1 на своих поверхностях);
  `link-in-text-block` — подчёркивание ссылок в тексте на auth-страницах.

## WP-5 — RLS (T4) — фазы 0–1 выполнены, фазы 2–3 за рефакторингом

- `docs/decisions/ADR-0023` — дизайн (session-GUC `app.household_id`/`app.user_id`,
  FORCE-RLS против owner-bypass, fail-closed).
- Миграция `20260914_mc087_rls_policies` — политики `tenant_isolation` на всех
  15 тенант-таблицах, **инертно** (без ENABLE — активация без контекст-слоя
  уронила бы API в «пустую БД»; применена к прод-БД).
- SQL-тест `rls-policies.integration.test.ts` (пилот NutritionProfile):
  контекст A → 1 строка, B → 0, без контекста → 0 (fail-closed),
  WITH CHECK отвергает чужую вставку, легитимная вставка проходит,
  после теста состояние возвращается в инертное. ✅
- Фазы 2–3 (контекст-слой в `@multichef/database` + `ENABLE/FORCE`) —
  оценены планом в 1–2 спринта; отдельная задача.

## WP-6 — гигиена ✅

- 6.1 `check:schema-drift` подключён в ci.yml (после migrate deploy).
- 6.2 `metric_5xx` в exception filter (код + path, greppable).
- 6.3 In-flight idempotency: 10 конкурентных register с одним ключом и телом →
  **6×201 с идентичным sessionToken + 4×429 (auth rate-limit 10/min)**,
  в БД 1 юзер. In-flight lock (TTL 60s, poll до 8s, fail-open) работает.
- 6.4 boot banner через Nest logger (T18-F).

## Тесты и деплой

- `pnpm lint` / `format:check` / `typecheck` / `test` (15/15 задач: 126 API +
  221 web + UI + пакеты) / `pnpm build` — всё зелёное на финальном HEAD.
- Интеграционная suite — зелёная на `multichef_test` (включая новые
  T16-A и RLS-тесты).
- CI-воспроизведение (install --frozen-lockfile → lint → format → typecheck →
  build) — зелёное; Node heap 8GiB для typecheck, как в ci.yml.

## Осталось осознанно

- **T4 фазы 2–3** — рефакторинг слоя данных на tenant-контекст
  (`withTenantContext`) + активация `ENABLE/FORCE` (см. ADR-0023).
- **T17-B vector** — оставлен (решение по умолчанию), README дополнен.
- **T16-A** — закрыт (404-контракт), см. FIXES-13-20.md.
