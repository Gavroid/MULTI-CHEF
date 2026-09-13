# R15 / Фаза B4 — Infrastructure / DevOps аудит

**Объект:** `infrastructure/{nginx,systemd,scripts}` + docs/runbooks + deployment pipeline.
**Метод:** static + live header probe (HTTP). SSH-доступа к 192.168.1.35 нет.

## Сводная B4

| Severity | Количество | Темы |
|---|---|---|
| HIGH   | 2 | Нет CSP на Next-pages, нет restore-test |
| MEDIUM | 5 | systemd hardening, NGINX, deploy |
| LOW    | 6 | cosmetic + doc drift |

---

## HIGH (B4)

### B4-H1. **Next.js pages НЕ пробрасывают CSP/HSTS** — только API (Fastify) имеет security headers
- **Файл:** `apps/web/src/middleware.ts` (нет CSP setup), `apps/web/next.config.mjs` (нет security-headers), `infrastructure/nginx/multichef.conf:9-21`.
- **Что:** Live probe показывает:
  - `GET /` → только `X-Content-Type-Options + Referrer-Policy`. Нет CSP, нет HSTS, нет `X-Frame-Options`.
  - `GET /today` → ещё меньше.
  - `GET /api/v1/health/live` → полный набор от Fastify/helmet.
- **Impact:** Next-страницы (включая `/profile`, `/today`, `/auth/*`) **не защищены** content-security-policy. Если кто-то заинжектит inline-script через XSS в любую Next-page — он пройдёт без CSP-блокировки.
- **Фикс:** добавить `headers()` callback в `next.config.mjs` или расширить `middleware.ts`:
  ```ts
  export function middleware(req: NextRequest): NextResponse {
    res.headers.set('Content-Security-Policy', "default-src 'self'; ...");
    res.headers.set('Strict-Transport-Security', ...);
    return res;
  }
  ```

### B4-H2. `infrastructure/scripts/rotate-ssh-keys.sh` упомянут в runbook, но НЕ существует
- **Файл:** `docs/runbooks/secret-rotation.md:21` — «`infrastructure/scripts/rotate-ssh-keys.sh`».
- **Факт:** `ls infrastructure/scripts` показывает `backup.sh, bootstrap.sh, deploy.sh, health-check.sh, rotate-secrets.sh` — **нет `rotate-ssh-keys.sh`**.
- **Impact:** если кто-то пробует следовать runbook на SSH-rotation — `bash: не найден`. Не критично, но документация-ложь.
- **Фикс:** создать скрипт или убрать строку из runbook.

---

## MEDIUM (B4)

### B4-M1. `bootstrap.sh:53` — `CREATE ROLE multichef LOGIN PASSWORD 'changeme'` без post-check
- **Файл:** `infrastructure/scripts/bootstrap.sh:51-55`.
- **Что:** если перезапустить bootstrap с уже существующим multichef-пользователем — нет `ALTER ROLE … PASSWORD ...`. Сохраняется исходный пароль. Если ENV переменная забыта — рабочий процесс использует **'changeme'** в проде.
- **Сейчас в проде:** `POSTGRES_PASSWORD` уже не 'changeme' (видно через connect-fail); значит ENV применили позже.
- **Фикс:** `ALTER ROLE multichef WITH PASSWORD '${env.POSTGRES_PASSWORD}'` при bootstrapping.

### B4-M2. `multichef-{api,worker,web}.service` — никакого systemd hardening
- **Файлы:** `infrastructure/systemd/multichef-api.service`, `multichef-worker.service`, `multichef-web.service`.
- **Что:** отсутствуют:
  - `NoNewPrivileges=true`
  - `ProtectSystem=strict` или `full`
  - `ProtectHome=true`
  - `PrivateTmp=true`
  - `MemoryMax=`, `MemoryHigh=`, `CPUQuota=`
  - `SystemCallFilter=` для syscall-restriction
  - `CapabilityBoundingSet=` пустой
  - `ReadOnlyPaths=` (логи/материалы)
- **Impact:** worker может читать /opt/multichef по привилегиям multichef_app, что нормально, но в случае XSS/RCE через Next не имеет защиты от syscall-escape.
- **Фикс:** добавить стандартный sandbox-набор.

### B4-M3. `nginx.conf` — отсутствует `proxy_set_header X-Real-IP`
- **Файл:** `infrastructure/nginx/multichef.conf:25-32`.
- **Что:** nginx передаёт `X-Forwarded-For` корректно, но нет `X-Real-IP`. Fastify с `trustProxy: true` смотрит на `req.ip` который суммирует hops (включая spoofing).
- **Фикс:** (с R13-H1) переписать на `proxy_set_header X-Forwarded-For $remote_addr;` или добавить IP-based allowlist proxy header. (R13 уже описал это.)

### B4-M4. `nginx.conf` — нет rate-limiting на /api/ (только app-level)
- **Файл:** `infrastructure/nginx/multichef.conf`.
- **Что:** `:8080/:8443` проксируют на 127.0.0.1:3001 без `limit_req_zone`. Если app-throttler пропустит (R13-H1) — nginx-stage ещё один слой защиты был бы полезен.
- **Фикс:** `limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;` + `limit_req zone=api burst=20 nodelay;`.

### B4-M5. `deploy.sh:21` — `git pull --ff-only origin main` без pre-commit verify
- **Файл:** `infrastructure/scripts/deploy.sh:21`.
- **Что:** `pnpm check` не запускается перед restart. Deploy может дать broken в проде.
- **Фикс:** `pnpm typecheck && pnpm lint && pnpm test` перед `systemctl restart`. (Уже требует успех, но не вызывается.)

---

## LOW (B4)

### B4-L1. `backup.sh` — keep-7, нет remote off-loading.
### B4-L2. `health-check.sh:7` — `/today` SSR возвращает 200 даже без backend (Next static shell).
### B4-L3. `rotate-secrets.sh` — это echo-list, не script. Документировано, но формально stub.
### B4-L4. `bootstrap.sh:11-13` — git clone без verify-signing: `git clone "git@github.com:Gavroid/MULTI-CHEF.git"` (SSH-key auth).
### B4-L5. systemd unit'ы не используют `Type=notify` — нет sd_notify readiness.
### B4-L6. NGINX no-op `client_max_body_size 10m` — норм, но не видна инструкция для файловых uploads.

---

## Сводный вывод B4

- B4-H1 (нет CSP на Next-pages) — серьёзный security drift.
- B4-H2 (runbook-archive vs reality) — не критично, документация-фикс.
- B4-M1..M5 — sandbox/validation hardening.
- Live infra (systemctl/journalctl/redis-cli) — не проверено, нужен SSH.

Дополнительно: **в проде `/etc/multichef/multichef.env`** я нашёл `NEXT_PUBLIC_USE_MEALPLAN_MOCK=1` (через R13) — это **dev/mock-leak в production**. Это попадает в B5 (security/high) тоже и попадает в B3-H3 как продуктовый дефект.
