# Технический, пользовательский и UI-аудит MULTI-CHEF (71-й круг)

**Дата:** 2026-09-16
**Область:** полный прогон — техническая плоскость (статика + динамика на проде),
пользовательская (сквозной сценарий через Playwright на живом проде), UI/a11y
(375/768/1280, светлая/тёмная, axe-core).
**Исходная точка:** HEAD `231d5f5`, рабочее дерево чистое; e2e 49/49 на проде.
**Артефакты:** этот отчёт + скриншоты/JSON-логи в `docs/audit/71-assets/`.

---

## TL;DR

Прод **функционально сломан для реального пользователя** при полностью зелёном
CI и 49/49 e2e. Три P1:

1. **Глобальная валидация тел запросов не выполняется** — `nestjs-zod` DTO
   декоративны: `POST /auth/register` принимает пароль `123` и не-email,
   пустое тело даёт 500, `PATCH /profile` сохраняет `tz: "Not/AZone"`.
2. **Прод-бандл web собран с `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`** — ветка
   accept-флоу в скомпилированном чанке содержит ТОЛЬКО mock-путь (реальный
   `POST /meal-plans` вырезан минификатором как мёртвый код).
3. **Регрессия `c626e83` (T32-A): куки с `Path=/api/v1`** ломают весь
   браузерный флоу — middleware не видит `mc_session` на навигациях (вечный
   отбой на /auth/login), а `mc_csrf` невидим для `document.cookie`, поэтому
   **каждая мутация из UI отвечает 403** (логин, добавление продукта,
   рулетка). E2E этого не видит, потому что сажает куки через
   `addCookies` с дефолтным `Path=/` — та же маскировка, что и до E25.

Также: в CI забыты relay-шаги, POSTящие хвосты логов на публичный webhook.site
(P2), миграция mc092 не записана в журнал прод-БД (P2), web-процесс на проде
старше своего же `.next` на ~16 часов (P2). UI-плоскость: `bg-card` без
определённого токена → прозрачные фоны диалогов и карточек холодильника (P2).
A11y — **0 serious/critical** на всех проверенных маршрутах, тёмная тема и
PWA-ассеты в порядке.

**Позитив:** RLS в прод-БД точно соответствует документации; идемпотентность
(replay 200 / чужое тело 409), CSRF-guard, throttle 10/min → 429, i18n ru —
работают; gitleaks чист; пул индексов mc092 на месте.

---

## Технические находки

### T71-A · 🔴 P1 — Валидация тел запросов не выполняется (nestjs-zod DTO no-op)

**Где:** `apps/api/src/main.ts` (нет `useGlobalPipes`/`APP_PIPE`),
`apps/api/src/auth/auth.controller.ts:157` (`@Body() body: RegisterDto`),
`apps/api/src/profile/profile.controller.ts:64`, `apps/api/src/household/household.controller.ts:30`,
схемы-«источники правды»: `apps/api/src/auth/auth.dto.ts:12` (`password: z.string().min(8)`).

**Симптом.** Единственный работающий механизм валидации — ручные
`safeParse` внутри контроллеров (pantry:6, shopping-lists:6, ingredients:4,
recommendations:3, recipes:2, meal-plans:1, webhooks:1). Auth (0), profile (0),
household (0), jobs (0 — но jobs валидируется в сервисе) не парсят ничего:
`createZodDto` без зарегистрированного `ZodValidationPipe` ничего не валидирует.

RAW (прод):

```
$ curl -X POST .../api/v1/auth/register -H 'Content-Type: application/json' \
    -H "Idempotency-Key: <uuid>" -d '{"email":"не-почта-вообще","password":"123"}'
HTTP=201
{"user":{"id":"B99F7849C9E588151757C25A7E","email":"не-почта-вообще",...}}

$ curl -X POST .../api/v1/auth/register ... -d '{}'
HTTP=500
{"status":500,"error":{"code":"INTERNAL_ERROR","message":"Внутренняя ошибка сервера"}}

$ curl -X PATCH .../api/v1/profile -d '{"tz":"Not/AZone","locale":"xx-YY"}'
HTTP=200
{"id":"189BB4C3CC4EF6A1B987D6F3CB",...,"tz":"Not/AZone","locale":"xx-YY",...}
```

Для контраста — pantry валидируется (ручной `safeParse` в контроллере):

```
$ curl -X POST .../api/v1/pantry/items -d '{"ingredientId":12345,"quantity":"много","unit":{"hack":true}}'
HTTP=400 {"error":{"code":"VALIDATION_ERROR",...,"unit":["Expected 'G' | 'ML' | 'PIECE', received object"],"_root":["Unrecognized key(s) in object: 'quantity'"]}}
```

**Почему важно.** Политика пароля (min 8) не существует на сервере; в БД
попадают произвольные строки в email; `User.tz` можно отравить невалидным
значением (на нём строятся формат-пути E23); контракты OpenAPI/Swagger
обещают то, что не проверяется. Пустое тело → 500 вместо 422.

**Гипотеза фикса.** Зарегистрировать глобальный пайп: `app.useGlobalPipes(new ZodValidationPipe())`
(nestjs-zod v4) — оживит все DTO разом; добавить e2e/интеграционный тест
«register с password<8 → 422», «email без @ → 422», «пустое тело → 422» (сейчас
эти кейсы в unit-тестах схем проходят, а на проводе не выполняются). Альтернатива
— явные `Schema.safeParse` в auth/profile/household по образцу pantry.

---

### T71-B · 🔴 P1 — Прод-бандл web собран с `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`

**Где:** `apps/web/src/lib/recommendations-client.ts:209-227`
(`acceptRecommendation`, ветка `usesMealPlanMock()`),
`/etc/multichef/multichef.env` (`NEXT_PUBLIC_USE_MEALPLAN_MOCK=1`),
прод-чанк `apps/web/.next/static/chunks/app/(app)/today/roulette/page-5b41c5043b448fe8.js`.

**Симптом.** Условие `if (usesMealPlanMock())` инлайнится DefinePlugin'ом.
В прод-чанке скомпилированная `acceptRecommendation` содержит **только**
mock-ветку — реальный вызов `POST /api/v1/meal-plans` удалён Terser'ом как
мёртвый код:

```
$ python3 - <<'EOF'  # контекст вокруг "mock-plan-" в прод-чанке
async function f(e){return arguments.length>1&&void 0!==arguments[1]&&arguments[1],
console.error("[recommendations-client] NEXT_PUBLIC_USE_MEALPLAN_MOCK=1 in production build"),
{data:{mealPlanId:"mock-plan-".concat(p()),shoppingListId:"mock-list-".concat(p())}}}
EOF
```

(в исходнике после `if` идут и console.error, и `POST ${base}/api/v1/meal-plans` —
в чанке fetch-ветки нет; значит условие свернуто в `true`).

Дополнительно: happy-today e2e в комментарии фиксирует «accept (mock)» как
ожидаемое поведение (`tests/e2e/happy-today.spec.ts:2-3`) — тест маскирует
утечку вместо того, чтобы её ловить.

**Почему важно.** Пользователь, принимающий рекомендацию, получает
`mock-plan-<uuid>`, которого нет в БД: план/список не создаются. Это ломает
ключевую ценность продукта даже после починки T71-C.

**Гипотеза фикса.** Убрать `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` из
`/etc/multichef/multichef.env`, пересобрать web, перезапустить сервис.
Системно: запретить mock-флагам непрод-дефолты в env-схеме `packages/config`
(например, валидировать «production + mock=1 → fail» при сборке), а e2e
добавить ассерт «accept дергает POST /meal-plans».

---

### T71-C · 🔴 P1 — Куки `Path=/api/v1` ломают браузерный флоу целиком (регрессия T32-A)

**Где:** `apps/api/src/auth/auth.controller.ts:33` (`const COOKIE_PATH = '/api/v1'`),
`apps/web/src/middleware.ts:22` (`req.cookies.get('mc_session')` на страницах),
`apps/web/src/lib/auth-client.ts:153-156` (`document.cookie` читает `mc_csrf`),
регрессионный коммит `c626e83` (2026-09-15 16:29, «fix(api,infra): cookies, …»).

**Симптом.** Два независимых следствия одного корня:

1. **Middleware-гейт.** Браузер не отправляет куку с `Path=/api/v1` на запросы
   страниц (`/today` и т.д.), поэтому `middleware()` всегда видит
   «не авторизован» и отбрасывает на `/auth/login?redirect=…` — даже с валидной
   сессией.
2. **CSRF на всех мутациях.** `mc_csrf` (Path=/api/v1, не HttpOnly) невидим для
   `document.cookie` на любых страницах приложения → `X-CSRF-Token` не
   отправляется → при этом сама кука к fetch на `/api/v1/*` прилагается →
   guard отвечает 403 CSRF_MISMATCH. Это затрагивает логин, добавление
   продукта, `POST /recommendations/roulette/draw` и т.д.

Изоляция причины (один и тот же валидный токен, меняется только Path куки;
`docs/audit/71-assets/iso-path-api-v1.png` и `iso-path-root.png`):

```
register 201 C5D2E2C0BA553C37F15D2E2C74
mc_session Path=/api/v1 -> final URL: http://192.168.1.95:8080/auth/login?redirect=%2Ftoday
mc_session Path=/       -> final URL: http://192.168.1.95:8080/today
```

Живой UI (реальный регистр через форму → редирект на логин → попытка входа):

```
[after-register] {"url":"http://192.168.1.95:8080/auth/login?redirect=%2Ftoday"}
[after-login]    {"url":"http://192.168.1.95:8080/auth/login?redirect=%2Ftoday"}   # вход не прошёл
POST /api/v1/pantry/items -> 403
FAIL 403 POST /api/v1/recommendations/roulette/draw
```

Скриншоты: `71-assets/after-login-375-light.png` (баннер «CSRF-токен не
совпадает…» на форме логина), `71-assets/roulette-after-spin-375.png` (тот же
текст в карточке рулетки).

**Почему CI этого не видит.** e2e сажает сессию вручную:
`page.context().addCookies([...])` без `path` → дефолтный `Path=/` → middleware
и `document.cookie` работают. Тот же механизм маскировки уже замечен в
PLAN-REMAINING (E22: «mc_csrf сеется из ответа register — hard mode сломал
старую добычу из document.cookie») — тогда починили тест, а не продукт.

**Гипотеза фикса.** Вернуть cookie path `/` (T32-A решал гигиену — сессия
«не уходит на статику»; более безопасная альтернатива: оставить `/api/v1` для
API-кук, но middleware перенести на проверку через под-запрос/EOF-токен —
сложнее). Минимальный и согласованный вариант: `COOKIE_PATH = '/'` + e2e-тест
на РЕАЛЬНЫЙ флоу (register через форму → автологин → мутация из UI), который
не сажает куки руками. Проверить, что `Vary: Cookie`/кэш Next не начинает
отдавать приватные страницы (middleware и так редиректит до рендера).

---

### T71-D · 🟠 P2 — В CI остались relay-шаги, POSTящие логи на публичный webhook.site

**Где:** `.github/workflows/ci.yml:239` (job `test`, шаг «Relay failure»),
`ci.yml:392` (job `e2e`, шаг «Relay failure»).

**Симптом.** HEAD-коммит `231d5f5` сообщает «remove temporary status-relay job
(run … confirmed green)» — удалена отдельная джоба, но временные `if: failure()`
шаги в `test` и `e2e` остались: хвосты миграций/юнитов/покрытия и api-интеграционных
логов (до ~3КБ на файл) уходят на `https://webhook.site/03855ef3-…`. UUID
публичен (лежит в репо) — читать логи может кто угодно.

```
$ grep -n "webhook.site" .github/workflows/ci.yml
239:          curl -sS --max-time 25 -X POST "https://webhook.site/03855ef3-6dde-4c4a-a7e2-58f1cd60d631" \
392:          curl -sS --max-time 25 -X POST "https://webhook.site/03855ef3-6dde-4c4a-a7e2-58f1cd60d631" \
```

**Гипотеза фикса.** Удалить оба шага (миссия релея выполнена). На будущее —
логи падений публиковать только в артефакты job'а, не наружу.

---

### T71-E · 🟠 P2 — mc092 не записана в `_prisma_migrations` прод-БД

**Где:** прод-БД `multichef`, таблица `_prisma_migrations` (10 строк, последняя —
`20260916_mc091_index_name_alignment`), файл миграции
`packages/database/prisma/migrations/20260916_mc092_declared_indexes/migration.sql`.

**Симптом.** Все 7 индексов mc092 в проде физически есть (проверено по одной —
все `count=1`), но журнальной записи нет: индексы накатили мимо `migrate deploy`.

```
$ pnpm --filter @multichef/database exec prisma migrate status
11 migrations found in prisma/migrations
Following migration have not yet been applied:
20260916_mc092_declared_indexes
# exit code 1

$ SELECT migration_name FROM _prisma_migrations ORDER BY migration_name;  -- 10 строк, mc092 нет
```

**Почему важно.** `migrate status`-гейты и любые скрипты деплоя, проверяющие
журнал, будут считывать прод как «не накатанный»; журнал перестаёт быть
истиной о состоянии.

**Гипотеза фикса.** `prisma migrate resolve --applied 20260916_mc092_declared_indexes`
(от суперпользователя), затем контрольный `migrate status` → «Database schema is up to date!».

---

### T71-F · 🟠 P2 — Дрейф деплоя: web-процесс старше своего `.next` на ~16 часов

**Где:** systemd `multichef-web` (`ExecMainStartTimestamp=Tue 2026-09-15 23:24:03 UTC`),
`apps/web/.next/BUILD_ID` (mtime `2026-09-16 15:30:22 UTC`), `multichef-api`
(старт `2026-09-16 16:34`), HEAD `231d5f5` (20:26 UTC).

**Симптом.** `.next` пересобран под живым `next start`-процессом: серверные
бандлы в памяти от сборки 09-15, клиентские чанки на диске от 09-16 (версии
`page-*.js` не совпадают с серверными манифестами). Для E24-волны (upload UI в
web) это означает: код есть на диске, но серверная часть процесса его не
знает. Кроме того, ci-only коммиты после старта api — это нормально, но
нефиксированный дрейф «сборка ≠ процесс» делает воспроизведение прод-состояния
нетривиальным.

```
$ systemctl show multichef-web -p ExecMainStartTimestamp   → Tue 2026-09-15 23:24:03 UTC
$ stat -c %y apps/web/.next/BUILD_ID                       → 2026-09-16 15:30:22 UTC
$ git log -1 --format=%cd                                  → Wed Sep 16 20:26:05 2026 +0000
```

**Гипотеза фикса.** Runbook: после каждой сборки — `systemctl restart
multichef-web` (и api/worker при их изменениях); в идеале — deploy-скрипт,
который строит в отдельный каталог и атомарно переключает + рестартует.

---

### T71-G · 🟡 P3 — nginx: локальные `add_header` глушат серверные security-заголовки

**Где:** `/etc/nginx/sites-enabled/multichef`, `location /_storage/` и `location /images/`
(каждый со своим `add_header Cache-Control …`).

**Симптом.** В nginx `add_header` наследуется с уровня server только если у
location нет своих `add_header`. Ответы статики/`/_storage/` теряют
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`:

```
$ curl -sSI http://192.168.1.95:8080/images/recipes/molochnyy-kokteyl-s-bananom.webp
HTTP/1.1 200 OK
Content-Type: image/webp
Expires: Fri, 16 Oct 2026 20:51:55 GMT
Cache-Control: max-age=2592000
Cache-Control: public, immutable
# ← нет X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy
```

(заодно видно дубль `Cache-Control` — `expires 30d` + `add_header` пишут два
заголовка).

**Гипотеза фикса.** Дублировать четыре заголовка в обоих location (или
вынести в `include snippets/security-headers.conf` и подключать на обоих
уровнях); `expires` заменить на единый `add_header Cache-Control "public, max-age=2592000, immutable"`.

---

### T71-H · 🟡 P3 — Сессионные куки без `Secure` на проде (включая HTTPS :8443)

**Где:** `apps/api/src/auth/auth.controller.ts:92` (`secure: env.COOKIE_SECURE`),
прод-env `COOKIE_SECURE=false`.

**Симптом.**

```
set-cookie: mc_session=…; Max-Age=604799; Path=/api/v1; HttpOnly; SameSite=Lax
set-cookie: mc_csrf=…;   Max-Age=604799; Path=/api/v1; SameSite=Lax
# флага Secure нет; то же самое при заходе через https://192.168.1.95:8443
```

Для LAN по HTTP это осознанный трейдоф (с `Secure` кука по HTTP не работает
вообще), но HTTPS-гейт :8443 существует и не даёт `Secure`+HSTS-пользы.

**Гипотеза фикса.** Задокументировать решение в ADR (HTTP-only LAN ⇒
COOKIE_SECURE=false); при переходе на HTTPS включить `COOKIE_SECURE=true`
(механизм уже есть, аудит 2026-09-13 сделал его живым). Пока пароли ходят по
HTTP в открытую — это главный лимит безопасности инсталляции, а не флаг куки.

---

### T71-I · 🟡 P3 — `sessionToken` дублируется в теле ответа register/login

**Где:** `apps/api/src/auth/auth.controller.ts:188-197` и аналогичный login-хендлер.

**Симптом.** Ответ отдаёт `sessionToken` JSON-ом рядом с установкой HttpOnly
куки — любой XSS получает сырой токен напрямую, минуя `document.cookie`
(он бы не помог: HttpOnly). Нужно API-клиентам (e2e), но для браузера это
лишняя экспозиция.

**Гипотеза фикса.** Отдавать токен только при явном клиентском флаге/заголовке
или перенести e2e на `apiRequestContext` с чтением Set-Cookie (контекст уже
умеет). Минимум — задокументировать, почему тело отвечает токеном.

---

### T71-J · 🟡 P3 — Sentry в проде выключен; JWT_SECRET — мёртвая переменная env

**Где:** `/etc/multichef/multichef.env` (нет `SENTRY_DSN`; есть `JWT_SECRET`,
который `packages/config` не определяет и код не читает).

**Симптом.** E26 построил Sentry-контур, но DSN не задан → все 5xx
(например, «пустое тело → 500» из T71-A) уходят только в journalctl и никем
не считаются. `JWT_SECRET` в env — мусор, вводящий в заблуждение (сессии на
случайных токенах, не JWT).

**Гипотеза фикса.** Подключить Sentry-DSN (хотя бы бесплатный tier) или
удалить `common/sentry.ts`-инициализацию из критического пути до реального
решения; вычеркнуть `JWT_SECRET` из env-файла и добавить `env-coverage`-правило,
чтобы лишние секреты падали в typecheck.

---

### T71-K · 🟡 P3 — Комментарий `app.module.ts` описывает CSRF soft mode (doc drift)

**Где:** `apps/api/src/app.module.ts:64-70`.

**Симптом.** Комментарий: «Soft mode — requests without the csrf cookie pass
(non-browser clients); hard-fail … deferred to a dedicated ADR». Фактический
код `csrf-guard.ts` (после E25/аудита 2026-09-13): при наличии `mc_session`
без `mc_csrf` — жёсткий 403. Комментарий противоречит поведению и путает
следующего инженера (как это и случилось при анализе T71-C).

**Гипотеза фикса.** Переписать комментарий на актуальную семантику
(session+csrf обязательны; без session — soft path для API-клиентов).

---

### T71-L · 🟡 P3 — e2e `fail-login` не устойчив к исчерпанному throttle-окну

**Где:** `tests/e2e/fail-login.spec.ts:13` (`expect(response.status()).toBe(401)`).

**Симптом.** Прогон 49 спек на проде после «лишних» попыток входа с того же IP:

```
Expected: 401
Received: 429
1 failed … 48 passed
# через 65s — повторный прогон только fail-login: 1 passed (946ms)
```

Тест не ретраит 429 (в отличие от happy-today, где регистр ретраится) —
зелёность зависит от порядка/давления предыдущих прогонов.

**Гипотеза фикса.** Обернуть ожидание в retry-цикл как в happy-today
(`if (status !== 429) break; sleep 5s`) или тестировать 401 API-уровнем
без участия throttle-бакета логина.

---

## Пользовательская плоскость (UX)

Прогон: реальная регистрация через форму → попытка входа → (после посадки
валидной сессии обходным путём, как это делает e2e) полный цикл
холодильник → сегодня → рулетка → план → покупки → рецепт → профиль.
Скриншоты — `docs/audit/71-assets/*.png`, сырые логи — `ux-audit-log.json`,
`ux-loop-log.json`.

### U71-A · 🔴 P1 — Новый пользователь не может войти в приложение (dead end)

Составляющая T71-C, пользовательская проекция: регистрация проходит (201,
«Создать аккаунт»), но редирект на `/today` отбивается middleware, возврат на
`/auth/login` даёт 403 CSRF при повторном входе. Пользователь зациклен между
двумя экранами. Скриншоты: `after-register-375-light.png`,
`after-login-375-light.png`. До починки T71-C прод-UI не имеет ни одного
успешного пользовательского пути.

### U71-B · 🟠 P2 — Deep-link `/fridge?add=1` не открывает диалог добавления

**Где:** `apps/web/src/app/(app)/fridge/add/page.tsx` (комментарий обещает
«redirect there with a flag so FridgeClient opens the dialog automatically»),
`apps/web/src/app/(app)/fridge/FridgeClient.tsx:83` (`addOpen` стартует `false`,
`?add=1` нигде не читается — в компоненте нет `useSearchParams`).

RAW: навигация на `/fridge?add=1` показывает обычный список без диалога
(`71-assets/fridge-add-deeplink-noop-375.png`); диалог открывается только
кликом по FAB/CTA. Все входные точки, ведущие на `/fridge/add` (например,
ошибка rescue-флоу), попадают в этот мёртвый redirect.

**Гипотеза фикса.** В `FridgeClient` прочитать `?add=1` через
`useSearchParams()` и `setAddOpen(true)` при монтировании (плюс e2e-ассерт).

### U71-C · 🟡 P3 — Рулетка показывает сырой технический текст ошибки

На `POST /recommendations/roulette/draw → 403` карточка рисует строку из
exception-конверта напрямую: «CSRF-токен не совпадает (заголовок X-CSRF-Token
vs cookie mc_csrf)» (`71-assets/roulette-after-spin-375.png`). На логине/профилях
есть `humaniseError` (401 → «Неверный email или пароль», 429 → «Слишком много
попыток. Подождите минуту.») — рулетке и другим поверхностям не хватает того
же маппинга. RAW-сообщение API не должно доходить до пользователя дословно.

### U71-D · 🟡 P3 — «Нет данных» приходят как 404 в консоль браузера

RAW сетевого прогона:

```
--- /today ---   FAIL 404 GET /api/v1/meal-plans/active
--- /plan ---    FAIL 404 GET /api/v1/meal-plans/active
--- /shopping --- FAIL 404 GET /api/v1/shopping-lists/active
```

UI обрабатывает это корректно (пустые состояния), но семантически «у домена
нет активного плана» — это 200+null/пустой объект, а 404 плодит красные
строки в DevTools/логах и маскирует реальные баги навигации.

### U71-E · ✅ Позитив

- «Добрый вечер»/гreeting, quick-сценарии, прогресс бюджета — экран «Сегодня»
  читается и не пустует (`today-authed-375-light.png`).
- Empty-state холодильника — дружелюбный, с единственным понятным CTA
  (`fridge-authed-empty-375.png`).
- Форма логина очеловечивает 401/429 (`LoginForm.tsx:116-118`).
- Тест 49/49 подтверждён на проде (после сброса throttle-окна).

---

## UI-плоскость

Матрица скриншотов: 375/768/1280 × светлая/тёмная, публичные и приватные
экраны (`docs/audit/71-assets/`, ~70 файлов), плюс focus-скриншот клавиатуры.

### V71-A · 🟠 P2 — Класс `bg-card` не имеет токена: прозрачные фоны диалогов и карточек

**Где:** `apps/web/src/components/PantryDialog.tsx:65` (контейнер всех
pantry-диалогов: добавить/редактировать/удалить),
`apps/web/src/components/AddPantryItemDialog.tsx:201` (выпадающий список
ингредиентов), `apps/web/src/components/PantryItemCard.tsx:50` (карточка
продукта в холодильнике).

**Симптом.** Ни `tailwind.config.ts` (`colors` — нет ключа `card`), ни
`globals.css` не определяют `--color-card`. Класс `bg-card` не генерируется
вообще → контейнер диалога прозрачный, содержимое страницы просвечивает
сквозь форму:

```
$ grep -rn "color-card" apps/web/src/app/globals.css apps/web/tailwind.config.ts
(пусто)
$ grep -rn "bg-card" apps/web/src --include="*.tsx" | grep -v test
PantryDialog.tsx:65 / AddPantryItemDialog.tsx:201 / PantryItemCard.tsx:50
```

Скриншот: `71-assets/fridge-add-dialog-375.png` — текст empty-state («Добавьте
продукты — мы подскажем…») просвечивает сквозь тело диалога «Добавить продукт».
На карточках холодильника (с товарами) фон тоже прозрачный — карточки сливаются
с фоном страницы.

**Гипотеза фикса.** Добавить токен `--color-card` (light/dark) в `globals.css`
и ключ `'card'` в `tailwind.config.ts` — либо заменить `bg-card` на
существующий `bg-surface` (сверлить, что из двух задумано по §2.5 PRD).

### V71-B · 🟡 P3 — Нелокализованный нативный date-input в диалоге

`AddPantryItemDialog.tsx:266` (`add-pantry-expires`) — `<input type="date">`
с системным плейсхолдером `mm/dd/yyyy` при ru-локали интерфейса
(см. `fridge-add-dialog-375.png`). Формат отображения зависит от ОС/браузера и
в России будет EN-ориентированным; E23 (i18n) это не покрывает.

**Гипотеза фикса.** Кастомный date-контрол с форматом ДД.ММ.ГГГГ или текстовое
поле с маской + `inputMode="numeric"`.

### V71-C · ✅ Позитив

- **axe-core: 0 нарушений** (включая serious/critical) на `/`, `/auth/login`,
  `/auth/register`, `/today`, `/fridge`, `/plan`, `/shopping`, `/profile`,
  `/offline` — приватные проверены в авторизованной сессии
  (`ux-audit-log.json`, `ux-loop-log.json`).
- Клавиатура: skip-link «Перейти к содержимому» первым Tab-ом, порядок
  email → password → Войти → Зарегистрироваться; фокус видим
  (`login-focus-1280-light.png`).
- Тёмная тема: корректные токены на всех экранах/вьюпортах
  (`today-authed-375-dark.png` и матрица), инициализация до первой отрисовки
  (`themeInitScript` в `app/layout.tsx:52`).
- PWA: manifest полный (192/512/maskable/SVG, apple-touch 200, `/offline` 200,
  `sw.js` v2, SHELL_URLS = 7), оффлайн-навигация по HTTP ожидаемо невозможна
  (`navigator.serviceWorker === undefined` на не-secure origin — известное
  ограничение, не баг; `offline-attempt-375.png`, `chrome-error://`).
- Бюджет бандла: `.next` без кэша = 5852 КБ ≪ 20000 КБ.
- Без горизонтального скролла на 375/768/1280 (подтверждено скриншотами и
  e2e `responsive-pwa`).

---

## Сводная таблица

| ID    | Sev   | Плоскость | Суть                                                                                              | Где                                                                    |
| ----- | ----- | --------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| T71-A | 🔴 P1 | API       | Валидация тел не выполняется (DTO no-op), password `123` → 201                                    | `apps/api/src/main.ts`, `auth.controller.ts:157`                       |
| T71-B | 🔴 P1 | Web       | Прод-бандл с мок-флагом: accept возвращает `mock-plan-*`                                          | `recommendations-client.ts:209`, env `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` |
| T71-C | 🔴 P1 | Fullstack | `Path=/api/v1` кук: middleware-отбой на страницах + 403 на всех мутациях UI (регрессия `c626e83`) | `auth.controller.ts:33`, `middleware.ts:22`, `auth-client.ts:153`      |
| U71-A | 🔴 P1 | UX        | Новый пользователь зациклен register↔login, войти нельзя                                          | следствие T71-C                                                        |
| T71-D | 🟠 P2 | CI        | Relay-шаги шлют логи на публичный webhook.site                                                    | `.github/workflows/ci.yml:239,392`                                     |
| T71-E | 🟠 P2 | БД        | mc092 нет в `_prisma_migrations` (журнал ≠ состояние)                                             | прод-БД, `migrate status` exit 1                                       |
| T71-F | 🟠 P2 | Ops       | `.next` пересобран под живым web-процессом (дрейф 16 ч)                                           | systemd multichef-web                                                  |
| U71-B | 🟠 P2 | UX        | `/fridge?add=1` не открывает диалог (мёртвый deep-link)                                           | `FridgeClient.tsx:83`                                                  |
| V71-A | 🟠 P2 | UI        | `bg-card` без токена → прозрачные диалоги/карточки                                                | `PantryDialog.tsx:65`, `PantryItemCard.tsx:50`                         |
| T71-G | 🟡 P3 | Инфра     | Security-заголовки теряются на `/images/`, `/_storage/`                                           | nginx location-блоки                                                   |
| T71-H | 🟡 P3 | API       | Куки без `Secure` (в т.ч. на :8443)                                                               | `auth.controller.ts:92`                                                |
| T71-I | 🟡 P3 | API       | `sessionToken` в теле ответа auth-эндпоинтов                                                      | `auth.controller.ts:188`                                               |
| T71-J | 🟡 P3 | Ops       | Sentry выключен (нет DSN); `JWT_SECRET` мёртвый                                                   | env, `common/sentry.ts`                                                |
| T71-K | 🟡 P3 | API       | Комментарий app.module про CSRF soft mode устарел                                                 | `app.module.ts:64`                                                     |
| T71-L | 🟡 P3 | e2e       | `fail-login` не ретраит 429 → флейк при нагрузке                                                  | `fail-login.spec.ts:13`                                                |
| U71-C | 🟡 P3 | UX        | Сырой текст ошибки API в карточке рулетки                                                         | Roulette UI                                                            |
| U71-D | 🟡 P3 | API/UX    | Empty-state как 404 (`meal-plans/active`)                                                         | API-контракты                                                          |
| V71-B | 🟡 P3 | UI        | `mm/dd/yyyy` нативного date-input при ru-локали                                                   | `AddPanityItemDialog.tsx:266`                                          |

Блокеры фикса: **T71-C → U71-A** (сначала вернуть работающий браузерный флоу),
затем **T71-A** (валидация), **T71-B** (мок), иначе любой UX-прогон будет
упираться в 401/403 до домена.

---

## Верификация (краткая)

- e2e-набор целиком: `48 passed, 1 failed (fail-login, 429 из-за моих probe-запросов)`;
  после паузы 65s `fail-login` — `1 passed (946ms)`. Итог 49/49.
- Динамические пробы (все с RAW в теле находок): register ±Idempotency-Key,
  CSRF 403, 401 без сессии, replay 200 / 409 IDEMPOTENT_REPLAY, throttle
  401×10→429, pantry VALIDATION_ERROR, profile 200 с мусором, health live/ready.
- RLS: `pg_policies` (16 политик) и `relrowsecurity/relforcerowsecurity`
  (12 таблиц FORCE, 5 инертных до E28) — совпадение с `packages/database/README.md`.
- gitleaks `--no-git` по дереву: `no leaks found`; `.webhook-test-secret` в
  `.gitignore:61`, в индексе отсутствует.
- Индексы mc092: 7/7 присутствуют (по `pg_indexes`), но журнал не записи — T71-E.
- CI: 7 джоб (lint, typecheck, test, audit, build, secret-scan, e2e) —
  зелёные на HEAD; скрытых пропусков нет (e2e-джоба гоняет только axe-pages —
  задокументировано в самом workflow), остаточный мусор — T71-D.

## Артефакты

- `docs/audit/71-assets/` — ~70 скриншотов (375/768/1280 × light/dark, публичные
  и приватные, изоляция T71-C: `iso-path-api-v1.png` / `iso-path-root.png`),
  сырые логи `ux-audit-log.json` и `ux-loop-log.json` (URL, консоль, мутации, axe).
- Команды воспроизведения — внутри каждой находки; каждый RAW-вывод получен
  на проде 2026-09-16 против HEAD `231d5f5`.

## Чистка после прогона

- Удалены тест-пользователи: `e2e-audit71-%` (12) и e2e-пользователи этого
  прогона `e2e-1789*`, `e2e-i18n-*`, `e2e-img-*`, `e2e-pwa-*` (4) —
  транзакционно через temp-id (Session/Preference/NutritionProfile/Job/
  HouseholdMember/PantryItem/MealPlan/ShoppingList/Household/User). Остаток
  `e2e-%/probe%` = 0.
- Временные Playwright-скрипты (`apps/web/audit71-*.mjs`) и `/tmp/audit71-*`
  удалены. Рабочее дерево — только `docs/audit/71-assets/` + этот отчёт.
