# Серверная инфа — настройки окружения

**Сервер:** 217.73.119.26 (внешний IP)
**Хост:** Linux 7.0.6-2-pve (Proxmox LXC/VM)
**ОС:** Debian 12 (предположительно, проверь `cat /etc/os-release`)

---

## Технические характеристики

```bash
# Проверить
uname -a
cat /etc/os-release
free -h
df -h /
nproc
```

---

## Установленный софт (что есть)

| Пакет | Версия | Установка |
|---|---|---|
| node | 24.x | через nvm (`/root/.nvm/versions/node/...`) |
| npm | встроен | — |
| pnpm | последняя | `npm i -g pnpm` |
| git | 2.x | apt |
| docker | ❌ (Proxmox LXC — без docker, но есть docker compose) | |
| docker compose | ❌ | |
| nginx | стабильный | apt |
| postgres | ❌ (нужно поднять через compose или локально) | |
| redis | ❌ | |
| gitleaks | ✅ (через Go, есть в CI) | |
| gh CLI | ❌ | установить через apt |

---

## Сервисы которые УЖЕ запущены на сервере

| Сервис | Порт | PID | Назначение |
|---|---|---|---|
| **sshd** | 22 | 281 | вход |
| **nginx** | 80 | 442, 440, 439... (8 workers) | reverse proxy |
| **Hermes WebUI** | 8787 | 410 | дашборд Hermes (НЕ приложение) |
| **Hermes gateway** | unix socket | — | шина сообщений Hermes |

Проверить:
```bash
ps auxf | head -20
ss -tlnp
```

---

## Структура диска

```bash
/                       # root, ext4
├── root/
│   ├── workspace/multichef/    # клон репо (наш проект)
│   ├── .hermes/                # Hermes config, profiles, plans
│   ├── .ssh/                   # SSH-ключи
│   └── .config/gh/host.yml     # GitHub PAT
├── var/log/             # стандартные логи
├── etc/nginx/           # nginx конфиг
└── tmp/                 # временные файлы
```

---

## Что включает серверная инфра для проекта multichef

### nginx
- Главный конфиг: `/etc/nginx/sites-enabled/default` (см. содержание ниже)
- Сейчас проксирует:
  - `/hermes/` → `http://127.0.0.1:8787/` (Hermes WebUI)
  - `/hermes-api/` → `http://127.0.0.1:9120/` (Hermes API)
  - `/klvr-debug/` → `http://127.0.0.1:8765/`
  - `/files/` → filebrowser (через baseurl)
- **НЕ проксирует:** `/api/v1/` (наш backend), `/web/` (наш frontend). Пока не настроено.

Содержимое nginx default (первые 30 строк):
```
client_max_body_size 80m;
listen 80 default_server;
listen [::]:80 default_server;
server_name _;
location = / { return 302 /hermes/; }
location = /klvr-debug/ { return 302 /klvr-debug/index.html; }
location /klvr-debug/ { proxy_pass http://127.0.0.1:8765/; ... }
location /files/ { proxy_pass http://127.0.0.1:8080/; ... }
location /hermes-api/ { proxy_pass http://127.0.0.1:9120/; ... }
location /hermes/ { proxy_pass http://127.0.0.1:8787/; ... }
```

### Hermes
- Каталог: `/root/.hermes/`
- Профили (боты):
  - `manager/` — я (менеджер). Прямо сейчас активна.
  - `architect/` — для архитектурных решений. Сейчас завис.
  - `backend-bot/` — для backend. Завис.
  - `frontend-bot/` — для frontend. Завис.
  - `qa-docs-bot/` — для QA. Завис.
- Планы: `/root/.hermes/plans/` — handover-файлы тут.
- State: `/root/.hermes/profiles/<profile>/state.db` — sqlite per profile.

### Другие (не multichef)
- **routerai** API ключи: `/root/LibreChat/.env` (НЕ ТРОГАТЬ — другой проект)
- **KLVR relay** — `id_ed25519_librechat` ключ (НЕ ТРОГАТЬ)

---

## Сетевой доступ к серверу извне

```bash
# Проверить
curl -s ifconfig.me
# → 217.73.119.26

# Из браузера:
http://217.73.119.26/ → 302 → /hermes/
http://217.73.119.26/hermes/ → Hermes WebUI (login required)
```

Не работает извне (по соображениям безопасности):
- `apps/api` (NestJS на :3000) — НЕ выставлен
- `apps/web` (Next.js на :3001) — НЕ выставлен
- Postgres — только localhost

Это нужно делать самому (задача MC-071).

---

## Создание нового пользователя (если хотите разграничить)

```bash
# root делает:
useradd -m -s /bin/bash developer
passwd developer   # установить пароль (или оставить ssh-only)

# Добавить SSH-ключ для нового пользователя
mkdir -p /home/developer/.ssh
echo "ssh-ed25519 AAAA..." > /home/developer/.ssh/authorized_keys
chown -R developer:developer /home/developer/.ssh
chmod 700 /home/developer/.ssh
chmod 600 /home/developer/.ssh/authorized_keys

# Если хотите sudo (опционально)
apt install sudo
echo "developer ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/developer
```

После — `developer` может зайти без пароля по ключу + работать под `sudo`.

---

## Что скорее всего надо будет сделать новому разрабу

1. **SSH-вход** через свой ключ → root или создать user.
2. **Склонировать репо** (если нет) → `/opt/multichef`.
3. **Установить зависимости:** `pnpm install --frozen-lockfile`.
4. **Заполнить .env-файлы** (или попросить у оператора).
5. **Запустить Postgres + Redis:** через compose или локально.
6. **Накатить миграции + seed:** `pnpm prisma migrate deploy && pnpm prisma db seed`.
7. **Поднять API и Web локально:** `pnpm dev`.
8. **Открыть PR:** через curl+PAT или `gh CLI` (если установил).

