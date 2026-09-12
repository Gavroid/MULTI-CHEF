# Runbook — ротация секретов (MC-090)

Исполняется человеком без контекста проекта за ≤ 30 минут.

## 1. SESSION_SECRET / JWT_SECRET (инвалидация всех сессий — осознанно)
1. `openssl rand -base64 32` → новое значение в `/etc/multichef/multichef.env` (JWT_SECRET).
2. `systemctl restart multichef-api multichef-worker`.
3. Проверка: старые cookie невалидны (401), новый логин работает.

## 2. DATABASE_URL (blue-green)
1. Создать нового пользователя БД: `CREATE ROLE multichef_next LOGIN PASSWORD '...'`.
2. `GRANT ALL PRIVILEGES ON DATABASE multichef TO multichef_next;` (+ schema public).
3. Обновить DATABASE_URL → restart api/worker → smoke зелёный.
4. Отозвать старого: `REVOKE ...; DROP ROLE multichef;`.

## 3. SSH-ключи
`infrastructure/scripts/rotate-ssh-keys.sh` (атомарная замена: новый ключ в authorized_keys → проверка входа → удаление старого).

## 4. GitHub PAT
GitHub → Settings → Developer settings → regenerate; обновить `/root/.config/gh/host.yml` и секреты Actions.

## 5. Тест восстановления БД (обязательный, раз в квартал)
1. `gunzip -c /var/lib/multichef/backups/<свежий>.sql.gz | sudo -u postgres psql multichef_restore`
2. `DATABASE_URL=...multichef_restore pnpm --filter @multichef/database exec prisma migrate status`
3. Spot-check: `SELECT count(*) FROM "Recipe";` → 269.
