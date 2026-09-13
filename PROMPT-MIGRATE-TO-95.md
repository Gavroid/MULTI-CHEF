# Промт для новой сессии: перенос MULTI-CHEF с .35 на .95

````
Ты — devops-инженер. Перенеси production-деплой MULTI-CHEF с 192.168.1.35
на 192.168.1.95 (Proxmox LXC, Ubuntu 24.04, root доступ по ключу уже
настроен с Hermes-Agent). После переноса удали прод с 192.168.1.35.

## Текущее состояние

- **Исходный сервер:** 192.168.1.35 (Hermes-Agent, Ubuntu 24.04, 8GB RAM)
  - Прод-деплой: /opt/multichef (systemd multichef-{api,worker,web})
  - nginx gateway: /etc/nginx/sites-available/multichef.conf (:8080/:8443)
  - Env: /etc/multichef/multichef.env (DATABASE_URL, REDIS_URL, секреты)
  - БД: PostgreSQL 16, база multichef (269 рецептов, 300 ингредиентов, юзеры)
  - Redis: 127.0.0.1:6379 (BullMQ очередь planning, AOF включён)
  - Backup: /var/lib/multichef/backups/
  - Репо: git@github.com:Gavroid/MULTI-CHEF.git, main = 29c5c18

- **Целевой сервер:** 192.168.1.95 (LXC multichef, Ubuntu 24.04)
  - SSH: root@192.168.1.95 (ключ Hermes-Agent уже в authorized_keys)
  - Чистый LXC — Node.js, PostgreSQL, Redis, nginx НЕ установлены

## Пошаговый план

### Шаг 1 — Bootstrap .95

```bash
# SSH с .35 на .95:
ssh root@192.168.1.35

# С .35 на .95:
ssh root@192.168.1.95

# Установить зависимости:
apt update && apt upgrade -y
apt install -y nginx postgresql redis-server nodejs npm curl git ufw fail2ban
npm install -g pnpm@9

# Node.js 24 (NodeSource):
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs

# pnpm:
corepack enable && corepack prepare pnpm@9 --activate

# Redis AOF:
redis-cli CONFIG SET appendonly yes
redis-cli CONFIG REWRITE

# PostgreSQL: создать роль и БД:
sudo -u postgres psql -c "CREATE ROLE multichef LOGIN PASSWORD 'CHANGE_ME';"
sudo -u postgres psql -c "CREATE DATABASE multichef OWNER multichef;"

# nginx: скопировать конфиг с .35:
scp root@192.168.1.35:/etc/nginx/sites-available/multichef.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/multichef.conf /etc/nginx/sites-enabled/
# Заменить в конфиге 127.0.0.1:3000/3001 — они те же (локальные порты .95)
nginx -t && systemctl reload nginx

# Секреты:
mkdir -p /etc/multichef
scp root@192.168.1.35:/etc/multichef/multichef.env /etc/multichef/multichef.env
# ОБЯЗАТЕЛЬНО заменить DATABASE_URL на .95-пароль и хост!
````

### Шаг 2 — Клонировать репо и собрать

```bash
# SSH-ключ для GitHub (скопировать с .35):
scp root@192.168.1.35:/root/.ssh/id_ed25519* /root/.ssh/
# Или добавить deploy key в GitHub repo

cd /opt
git clone git@github.com:Gavroid/MULTI-CHEF.git multichef
cd multichef

# Секреты:
mkdir -p /etc/multichef
set -a; source /etc/multichef/multichef.env; set +a

pnpm install --frozen-lockfile
pnpm turbo run build
```

### Шаг 3 — Миграции + seed

```bash
set -a; source /etc/multichef/multichef.env; set +a
pnpm --filter @multichef/database exec prisma migrate deploy

# Seed — ТОЛЬКО если .95 пустая БД (без переноса данных):
pnpm --filter @multichef/database exec prisma db seed
```

### Шаг 4 — Перенос данных с .35 (если нужен реальный данные)

```bash
# Dump с .35:
ssh root@192.168.1.35 "sudo -u postgres pg_dump multichef" > /tmp/multichef-dump.sql

# Restore на .95:
sudo -u postgres psql multichef < /tmp/multichef-dump.sql
```

### Шаг 5 — Systemd юниты

```bash
# Скопировать юниты:
cp /opt/multichef/infrastructure/systemd/multichef-{api,worker,web}.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now multichef-api multichef-worker multichef-web
```

### Шаг 6 — Backup cron

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/multichef/infrastructure/scripts/backup.sh >> /var/log/multichef-backup.log 2>&1") | crontab -
mkdir -p /var/lib/multichef/backups
```

### Шаг 7 — Верификация

```bash
# Health:
curl -s http://192.168.1.95:8080/api/v1/health/ready
# → {"status":"ready"}

# Web:
curl -s -o /dev/null -w "%{http_code}" http://192.168.1.95:8080/today
# → 200

# API:
curl -s http://192.168.1.95:8080/api/v1/recipes?limit=3 | head -c 200
```

### Шаг 8 — Очистка .35 (удаление старого прода)

```bash
ssh root@192.168.1.35

# Остановить и отключить systemd-юниты:
systemctl stop multichef-api multichef-worker multichef-web
systemctl disable multichef-api multichef-worker multichef-web
rm -f /etc/systemd/system/multichef-*.service
systemctl daemon-reload

# Удалить nginx-конфиг:
rm -f /etc/nginx/sites-enabled/multichef.conf
nginx -t && systemctl reload nginx

# Удалить код:
rm -rf /opt/multichef

# Удалить секреты:
rm -rf /etc/multichef

# Удалить бэкапы (ОСТОРОЖНО — сначала перенести на .95!):
# rm -rf /var/lib/multichef/backups

# НЕ УДАЛЯТЬ:
# - /root/workspace/multichef (dev-чекут — оставить)
# - PostgreSQL базу multichef (может пригодиться)
# - Redis (используется Hermes)
```

### Шаг 9 — Обновить документацию

- README.md: заменить 192.168.1.35 → 192.168.1.95
- infrastructure/scripts/deploy.sh: убедиться что APP_DIR верный
- manager-decision-log.md: записать миграцию

## Важные заметки

- **NEXT_PUBLIC_*** инлайнятся при сборке — NEXT_PUBLIC_APP_BASE_URL должен
  быть http://192.168.1.95:8080 при сборке на .95.
- **Turbo cache** на .95 пуст — первая сборка займёт ~5 мин.
- **БД**: если переносишь данные (не seed), убедись что миграции
  применены на .95 ДО restore дампа.
- **Secrets**: JWT_SECRET/SESSION_SECRET/COOKIE_SECRET — сгенерируй новые
  для .95, не копируй старые (или копируй если нужно сохранить сессии).
- **Firewall .95**: ufw allow 22,8080,8443; ufw enable.

```

Промт готов — скопируй в новую сессию, открой на `192.168.1.35` и выполняй по шагам. После шага 7 напиши «verify» — я проверю с этой сессии что .95 отвечает. После шага 8 — прод на .35 будет удалён.
```
