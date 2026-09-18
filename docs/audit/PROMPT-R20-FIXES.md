# MULTI-CHEF — пост-аудитный спринт исправлений (R20 fixes)

Ты — senior full-stack инженер MULTI-CHEF. Перед тобой результаты глобального аудита R20
(`docs/audit/AUDIT-R20-GLOBAL-SUMMARY.md`, коммит `86f0b78`). Твоя задача — исправить находки
P0 и ключевые P2, не сломав работающий прод. Работай автономно, доступы ниже.

## Объект и доступы

- Монорепо: pnpm + turbo. `apps/api` (NestJS 11 + Fastify + Prisma/Postgres), `apps/web`
  (Next.js 15 App Router, PWA), `apps/worker` (BullMQ), пакеты `packages/{contracts,config,database,nutrition,ui}`.
- Локальный чекаут: `/root/workspace/multichef` (ветка main). Push по ssh-ключу в
  `Gavroid/MULTI-CHEF`. gh CLI нет.
- Прод: `http://192.168.1.95:8080` (nginx → api :3001, web :3000, оба loopback). SSH:
  `ssh root@192.168.1.95`. Чекаут: `/opt/multichef`. Env: `/etc/multichef/multichef.env`
  (root-only, НЕ выводить значения секретов). Systemd: `multichef-{api,web,worker}`.
- Деплой: ТОЛЬКО `infrastructure/scripts/deploy-safe.sh` (после фикса — см. задачу 1).
  Здоровье: `infrastructure/scripts/health-check.sh http://127.0.0.1:8080`.
- БД прода: Postgres, кодировка SQL_ASCII — `length()` считает ОКТЕТЫ; текстовые проверки
  через JS/Prisma или поправку на continuation-байты.
- Локальная тестовая БД: Postgres 16 на этой машине, креды в `/root/workspace/multichef/.env`,
  база `multichef_seed_test`.

## Контекст текущего состояния (прочитай отчёт R20 первым!)

Прод восстановлен на `abfb72d` 2026-09-18, но известные дефекты в рантайме:

1. Редактирование продукта в холодильнике → 400 (UI шлёт `unit`, strict-схема режет).
2. Accept рекомендации → мок (`NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` зашит в прод-бандл);
   реальный путь сломан контрактно.
3. Full-reload/прямой заход на защищённые страницы → редирект на `localhost:3000` →
   connection refused у пользователя (cookie Path + middleware nextUrl).
4. deploy-safe.sh: stage() не исполняет команды (smoke/backup/rollback мертвы),
   нет prisma generate в gates, NODE_ENV=production ломает test-gate.
5. PWA offline сломан (precache падает на 307 от middleware).

## План работ (строгий порядок — зависимости реальные)

### Задача 1 — deploy-safe.sh: починить pipeline (блокер для всего остального)

Файл: `infrastructure/scripts/deploy-safe.sh`.

1. `stage()` (строки ~51-58): сейчас `local name="$1"; shift; "$@"` при вызове
   `stage smoke` исполняет пустую команду → rc=0 всегда. Исправить все вызовы на
   `stage <name> <command...>` (например `stage smoke smoke`, `stage backup "$SCRIPT_DIR/backup.sh"`),
   либо переписать stage() чтобы имя совпадало с функцией. Критерий: smoke реально вызывает
   health-check.sh и при его фейле инициируется rollback.
2. Добавить gate `prisma generate` после install в worktree:
   `sudo -u multichef_app -H bash -c "cd '$WORKTREE' && /usr/bin/pnpm --filter @multichef/database exec prisma generate"`.
3. Test-gate: `env NODE_ENV=test /usr/bin/pnpm test` (иначе React act падает).
4. Флаг `--force`: пропускает «HEAD == ref → nothing to do» (нужен для редеплоев-восстановлений).
5. Chown после build: покрыть весь `$APP_DIR` (не только apps/), либо git-операции перевести
   на `sudo -u multichef_app git -c safe.directory=$APP_DIR ...` — убрать root-письмо в дерево.
6. Smoke должен включать проверку `dist/main.js` существует ДО рестарта
   (fail-fast вместо «restart ok → 502»).

Тестирование задачи: `bash -n`, затем прогон `deploy-safe.sh --ref main --force` на проде
как rehearsal (код не меняется, gates должны пройти, smoke реально исполниться — в логе
видны строки health-check). Откат: файл скрипта версионируется в git.

**DoD задачи 1:** лог деплоя содержит реальный вывод health-check (`health: OK`);
`grep -c "prisma generate" infrastructure/scripts/deploy-safe.sh` ≥ 1; репетиция прошла exit 0.

### Задача 2 — session cookie Path + middleware host (F8+F7, самый большой user impact)

1. `apps/api/src/auth/auth.controller.ts:71`: `COOKIE_PATH = '/api/v1'` → `'/'`
   (и для mc_session, и для mc_csrf — clearCookie тоже). Проверить, что нет других
   мест, задающих path для этих cookie.
2. `apps/web/src/middleware.ts`: redirect строить из Host-заголовка, не из `nextUrl`:
   ```ts
   const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
   const proto = req.headers.get('x-forwarded-proto') ?? 'http';
   const loginUrl = new URL(`${proto}://${host}/auth/login`);
   loginUrl.searchParams.set('redirect', pathname + (search ?? ''));
   return NextResponse.redirect(loginUrl);
   ```
   Обоснование: Next 15.5 `nextUrl` за прокси берёт origin из биндинга сервера, а не Host.
3. Юнит-тесты: cookie Path в auth-ответах; middleware redirect с Host `192.168.1.95:8080`
   → Location начинается с `http://192.168.1.95:8080/`.
4. После деплоя: theme-persist e2e должны стать зелёными; sw precache — перепроверить
   (responsive-pwa T66-B через loopback-туннель `ssh -L 18080:127.0.0.1:8080`).

**DoD задачи 2:** на проде `curl -sI http://192.168.1.95:8080/today` → Location на
`192.168.1.95:8080/auth/login`; с валидной mc_session (Path=/) → 200;
`E2E_BASE_URL=... pnpm test:e2e` → theme-persist 2/2, responsive-pwa полностью зелёный.

### Задача 3 — PATCH pantry unit (F1)

1. Решить и зафиксировать контракт: либо `PatchPantryItemSchema` принимает `unit`
   (и сервис пересчитывает estimatedGrams), либо `EditPantryItemDialog` не шлёт `unit`
   (и селектор unit в диалоге становится display-only/disabled). Предпочтительно первое:
   пользователь уже видит селектор единиц.
2. Юнит-тесты схемы + интеграционный тест PATCH с unit.
3. e2e: добавить в существующую спеку fridge сценарий «редактирование позиции → 200».

**DoD задачи 3:** на проде PATCH с `unit` → 200 и значение сохраняется; e2e зелёный.

### Задача 4 — accept-флоу: убрать мок, согласовать контракт (F2)

1. Удалить мок-ветку `usesMealPlanMock` из `apps/web/src/lib/recommendations-client.ts`
   и `NEXT_PUBLIC_USE_MEALPLAN_MOCK` из env/деплоя (deploy-safe перестаёт пробрасывать).
   Из прод-env ключ убрать (предложить владельцу; значение не трогать самим без одобрения).
2. Контракт: принять решение и реализовать ОДИН вариант:
   - (a) `POST /meal-plans` расширяется полями `recipeId?`, `servings?` → создаётся
     точечный план на 1 день + shopping list, ответ `{mealPlanId, shoppingListId}`; ИЛИ
   - (b) клиент принимает `{jobId, deduplicated}` и поллит `GET /jobs/:id` до COMPLETED,
     затем читает active plan.
     Вариант (b) дешевле и укладывается в существующий job-пайплайн; (a) — правильнее
     продуктово («готовлю именно это»). По умолчанию делай (b), если владелец не сказал иначе;
     выбранное решение зафиксировать в `docs/decisions/ADR-XXXX`.
3. Обновить схемы в `packages/contracts` (единый источник), клиент, сервис, swagger.
4. Тесты: юнит на схемы, интеграция API, e2e happy-today (без консольной ошибки про мок).

**DoD задачи 4:** в прод-бандле нет строки `NEXT_PUBLIC_USE_MEALPLAN_MOCK`; accept из UI
создаёт реальный план (виден в GET /meal-plans/active); happy-today зелёный.

### Задача 5 — MC-200 добивка + nginx sync (F5/F6)

1. nginx: репо-конфиг привести к deployed-реальности (`X-Frame-Options: DENY`,
   `X-Forwarded-For $proxy_add_x_forwarded_for`) и УДАЛИТЬ `location /images/` +
   `location /_storage/` из обоих. Задеплоить конфиг, `nginx -t && systemctl reload nginx`.
2. Удалить `/var/www/multichef-images/` (68 МБ) — только после reload и подтверждения,
   что ни один ответ не ссылается на /images/ (grep access.log за 7 дней).
3. Из `/etc/multichef/multichef.env` убрать `IMAGE_STORAGE_*` (предложить владельцу diff).
4. `packages/database/prisma/schema.prisma:387`: убрать stale-комментарий про
   `POST /recipes/:id/image` (поле `imageKey` остаётся — инвариант MC-200).

**DoD задачи 5:** `curl -I …/images/recipes/pelmeni-otvarnye_480.webp` → 404;
`grep -r IMAGE_STORAGE /etc/multichef/multichef.env` пусто; `diff` репо/deployed nginx пуст.

### Задача 6 — надёжность воркера и наблюдаемость (F9/F10, опционально в этом спринте)

1. `queue.add(QUEUE_NAME, payload, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })`
   в `apps/api/src/jobs/queue-publisher.ts`; юнит-тест на опции.
2. Sentry: завести DSN (владелец), добавить `SENTRY_DSN` в env, проверить событие в dashboard.

## Архитектурные ограничения (не нарушать)

- `packages/contracts` — единственный источник wire-формата; новые поля сначала туда.
- Strict-схемы остаются `.strict()` — расширять схему осознанно, не ослаблять.
- `withTenantContext` обязателен для запросов к RLS-таблицам; новые сервисные методы — через него.
- `Recipe.imageKey` остаётся nullable и всегда NULL (MC-200 инвариант, фото НЕ возвращаем).
- Прод по умолчанию read-only; деплой только deploy-safe.sh; перед мутациями — backup.sh.
- Коммиты по commitlint (заголовок ≤72), pre-commit: gitleaks + prettier.
- Секреты из env не выводить в логи/чат/отчёты.

## Тестирование (обязательные ворота на каждую задачу)

1. `pnpm lint && pnpm format:check && pnpm typecheck` — локально, 0 ошибок.
2. `pnpm test` — весь монорепо; новые схемы/сервисы — новые юнит-тесты.
3. `RUN_DB_INTEGRATION=1 pnpm --filter @multichef/database test:integration` — если трогаешь
   схему/RLS (локально, тестовая БД).
4. E2E против прода после каждого деплоя:
   `E2E_BASE_URL=http://192.168.1.95:8080 pnpm --filter @multichef/web test:e2e`.
   Базовая линия сейчас: 43 зелёных; theme-persist (2) и responsive-pwa SW (2) красные до
   задачи 2 — после неё должны позеленеть. Для SW-спек используй loopback-туннель.
5. Smoke после деплоя: `health-check.sh` + ручная проверка затронутого пути curl'ом.

## Критерии приёмки спринта (все обязательны)

- [ ] Прод: редактирование продукта 200, accept создаёт реальный план, full-reload /today
      работает у залогиненного, редиректы ведут на 192.168.1.95:8080.
- [ ] deploy-safe.sh: rehearsal `--force` проходит, smoke реально исполняется (виден в логе),
      rollback-путь покрыт тестом/репетицией на безопасном рефе.
- [ ] E2E полный набор зелёный (включая theme-persist и SW-спеки через туннель).
- [ ] /images/ → 404, nginx repo==deployed, IMAGE_STORAGE_* удалены.
- [ ] Новый ADR по accept-контракту; `docs/audit/AUDIT-R20-GLOBAL-SUMMARY.md` дополнен
      секцией «R20-fixes: статус» с таблицей F1..F17 → fixed/wontfix.
- [ ] Всё закоммичено и запушено в main; финальное сообщение — таблица статусов находок +
      ссылки на коммиты.

## Первые шаги сессии

1. Прочитай `docs/audit/AUDIT-R20-GLOBAL-SUMMARY.md` целиком.
2. `cd /root/workspace/multichef && git log --oneline -3 && git status -sb` — убедись, что main актуален.
3. Начни с задачи 1 (deploy-safe) — она блокирует безопасный деплой остальных.
