# Карта доступа — MULTI-CHEF (на 2026-09-12)

> Где что лежит, как достать, как использовать. **Секреты не копируются в plain text — только инструкции.**

---

## 1. Сервер

| Параметр | Значение |
|---|---|
| Внешний IP | **217.73.119.26** |
| Хост | Linux 7.0.6-2-pve (Proxmox VM) |
| Доступ | только root, SSH (порт 22) |
| Юзер | `root` |
| Uptime | — |

### SSH-доступ

```bash
# Твой ключ уже должен лежать в /root/.ssh/authorized_keys
ssh root@217.73.119.26
```

Если authorized_keys нет (или хотите разграничить):

```bash
# Как root (ssh на сервер):
mkdir -p /root/.ssh
chmod 700 /root/.ssh
echo "ssh-ed25519 AAAA..." >> /root/.ssh/authorized_keys   # вставить свой pubkey
chmod 600 /root/.ssh/authorized_keys
```

### SSH-ключи на сервере (опционально — это ключи для Actions/runner'ов, не давайте людям)

| Ключ | Файл | Назначение | Кому |
|---|---|---|---|
| `id_ed25519` | `/root/.ssh/id_ed25519` | общий | НЕ ПЕРЕДАВАТЬ новому разрабу (сменить, если хотите) |
| `id_ed25519_actions_deploy` | `/root/.ssh/id_ed25519_actions_deploy` | GitHub Actions deploy | НЕ ПЕРЕДАВАТЬ (это ключ сервера для runner'ов) |
| `id_ed25519_cicd` | `/root/.ssh/id_ed25519_cicd` | generic CICD | использовать для CI |

### Firewall

- INPUT — policy ACCEPT (iptables показывает открыто всё)
- ufw — не настроен
- nginx — на :80

### Доступные порты

```bash
ss -tlnp
# 0.0.0.0:22   sshd
# 0.0.0.0:80   nginx (proxy на Hermes + KLVR + filebrowser)
# 0.0.0.0:8787 Hermes WebUI (Python, требует auth)
```

---

## 2. GitHub

| Параметр | Значение |
|---|---|
| Repo | `git@github.com:Gavroid/MULTI-CHEF.git` (private) |
| Branches | 24 feature-ветки + main |
| Главная ветка | `main` = `d8540d4` |
| Production deploys | НЕТ (MC-071 ещё не делался) |

### PAT (Personal Access Token)

**Где:** `/root/.config/gh/host.yml`

```bash
cat /root/.config/gh/host.yml
# Структура:
# github.com:
#     oauth_token: ghp_XXX...
#     user: Gavroid
#     ...
```

**Как достать:**
```bash
TOKEN=$(grep oauth_token /root/.config/gh/host.yml | awk '{print $2}')
echo $TOKEN | head -c 12   # первые 12 символов для sanity check
```

**Как передать:**
- ❌ НЕ через открытый чат
- ✅ Через 1Password/Bitwarden shared vault
- ✅ Через SecureCRT / ключ шифрованный
- ❌ НЕ через slack/discord без шифрования

**Права токена:** классический PAT с `repo + admin:repo_hook + workflow + admin:org` (стандарт для CI+merge).

### Работа с GitHub без gh CLI

`gh` не установлен (на 12 сент 2026). Используй curl:

```bash
TOKEN=$(grep oauth_token /root/.config/gh/host.yml | awk '{print $2}')

# Создать PR
curl -X POST -H "Authorization: token $TOKEN" \
  https://api.github.com/repos/Gavroid/MULTI-CHEF/pulls \
  -d '{"title":"MC-XXX: ...","body":"...","head":"feature/MC-XXX","base":"main"}'

# Squash-merge PR
curl -X PUT -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/Gavroid/MULTI-CHEF/pulls/24/merge" \
  -d '{"squash":true,"commit_message":"..."}'

# Статус CI
curl -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/Gavroid/MULTI-CHEF/commits/<SHA>/check-runs"
```

Или установить gh:
```bash
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt update && apt install gh -y
gh auth login --with-token < /tmp/pat.txt
```

---

## 3. Репозиторий на диске

```
/root/workspace/multichef/
├── apps/
│   ├── api/                 # NestJS backend
│   └── web/                 # Next.js frontend
├── packages/
│   ├── contracts/           # Zod-схемы + Swagger
│   ├── database/            # Prisma schema
│   ├── nutrition/           # KBJU pure-function
│   ├── recommendation/      # scoring + filters
│   └── ui/                  # design tokens
├── docs/
│   ├── MULTICHEF-ARCHITECTURE-PRD.md
│   ├── MULTICHEF-DEVELOPMENT-PLAN.md
│   ├── api/conventions.md
│   └── adr/                 # ADR-0001..0021 (21 ADR)
├── docker-compose.yml       # Postgres + Redis + Nest + Next
├── .github/workflows/ci.yml # 5 jobs CI
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── README.md
```

Клонировать на другой сервер:
```bash
git clone git@github.com:Gavroid/MULTI-CHEF.git /opt/multichef
cd /opt/multichef
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# заполнить .env реальными значениями
docker compose up -d postgres redis
pnpm --filter @multichef/database prisma:migrate
pnpm --filter @multichef/database prisma:seed
```

---

## 4. .env-файлы (что нужно для запуска локально)

Каждый сервис имеет `.env.example`. Что внутри — посмотри:

| Файл | Переменные (примерно) | Уровень секретности |
|---|---|---|
| `apps/api/.env.example` | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN` | JWT_SECRET — секретный |
| `apps/web/.env.example` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USE_RECIPE_FIXTURES`, `NEXT_PUBLIC_USE_MEALPLAN_MOCK` | не секретные |
| `packages/database/.env.example` | `DATABASE_URL` | пароль Postgres |

**Где реальные .env (если деплоили):**
```bash
ssh root@217.73.119.26
ls -la /opt/multichef/apps/api/.env /opt/multichef/apps/web/.env
cat /opt/multichef/apps/api/.env | grep SECRET
```

Если их нет — **придумать новые** для прод-перезагрузки (не использовать старые).

### Как создать .env на новом сервере

```bash
cd /path/to/multichef
pnpm run gen-secrets    # если есть в scripts/
# или вручную:
echo "JWT_SECRET=$(openssl rand -base64 32)" >> apps/api/.env
echo "DATABASE_URL=postgresql://multichef:$(openssl rand -hex 12)@localhost:5432/multichef" >> apps/api/.env
```

---

## 5. Database (Postgres)

| Параметр | Значение (по умолчанию в docker-compose) |
|---|---|
| Host | localhost (или `postgres` внутри compose) |
| Port | 5432 |
| DB | `multichef` |
| User | `multichef` |
| Password | в `.env` |
| Schema | Prisma |
| Migrations | `packages/database/prisma/migrations/` |
| Seed | `packages/database/prisma/seed.ts` (300 ingredients, 269 recipes, 30 chains) |

**Запуск:**
```bash
docker compose up -d postgres
DATABASE_URL=postgresql://multichef:xxx@localhost:5432/multichef \
  pnpm --filter @multichef/database prisma migrate deploy
DATABASE_URL=... \
  pnpm --filter @multichef/database prisma db seed
```

---

## 6. CI/CD (GitHub Actions)

`.github/workflows/ci.yml`:
- 5 jobs на каждом PR: build, test, typecheck, lint, secret-scan.
- Cache: pnpm + turbo + node_modules.
- Параметры уже учтены:
  - `pnpm turbo run build --filter=@multichef/web...` перед test (для nutrition dist).
  - `--concurrency=2` для turbo test.
  - `--max-old-space-size=8192` для typecheck (heap OOM fix).
- Деплой в прод: НЕ настроен (MC-071 ещё не делался).

---

## 7. Production (чего НЕТ)

| Что | Статус |
|---|---|
| Домен | ❌ не назначен |
| SSL/TLS | ❌ нет |
| Reverse proxy | ⚠️ nginx сделан для Hermes (`/hermes/`), но НЕ для `apps/api` и `apps/web` |
| Бэкапы БД | ❌ нет |
| Monitoring | ❌ нет |
| Logs | docker logs только |
| Deploy pipeline | ❌ нет (MC-080) |

**Прод-deploy — задача MC-071 (Nginx) → MC-072 (scripts) → MC-080 (app) → MC-082 (cdn/data) → MC-090 (smoke).**

---

## 8. Полезные команды (для разраба)

```bash
# Все workspace-пакеты
pnpm ls -r

# Локальный запуск api
pnpm --filter @multichef/api start:dev

# Локальный запуск web
pnpm --filter @multichef/web dev

# Все тесты
pnpm test

# Тесты с покрытием
pnpm --filter @multichef/api test -- --coverage

# E2E (Playwright)
pnpm --filter @multichef/web test:e2e

# Prisma Studio
pnpm --filter @multichef/database prisma studio

# Workspace status
git status
git log --oneline -10
```

