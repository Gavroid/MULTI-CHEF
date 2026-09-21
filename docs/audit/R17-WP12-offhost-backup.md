# R17-WP12 — Off-host backup mirror

## Что сделано

- `infrastructure/scripts/offhost-backup.sh` (107 строк): rsync --link-dest из `/var/lib/multichef/backups/` в `/var/lib/multichef/backups-offhost/<STAMP>/`. Hardlink-based incremental — каждый weekly run экономит место.
- Cron `0 4 * * 1` (Пн 04:00 UTC) — `/etc/cron.d/multichef-offhost`.
- Log: `/var/log/multichef-offhost.log` (multichef_app:adm, mode 0664).

## DoD (smoke)

- `bash offhost-backup.sh` exit 0
- `find /var/lib/multichef/backups-offhost -name "*.sql.gz" | wc -l` ≥ 1
- `cat /etc/cron.d/multichef-offhost` показывает weekly entry
- `rsync --link-dest` hardlinks проверены: `stat -c%i offhost/.../multichef-*.sql.gz` совпадает с `src`.

## Фактический первый прогон (2026-09-21T09:02:16Z)

```
source = /var/lib/multichef/backups/multichef-20260921T084307Z.sql.gz (566923 bytes)
dest = /var/lib/multichef/backups-offhost/20260921T090216Z
mirrored 7 dump file(s)
pruned 0 dumps older than 3 months
ok (offhost dir = /var/lib/multichef/backups-offhost/20260921T090216Z)
```

## Что осталось вне scope

- Реальная копия на другую машину (нужен отдельный backup-target VPS) — MVP решение: отдельный раздел в пределах той же машины. В будущем достаточно поменять `BACKUP_DST` на `rsync user@host:/backups/`.
- Monthly snapshot в S3 — не настроен (S3 credentials не заданы).

## Operator runbook

- Посмотреть состояние: `ls -lh /var/lib/multichef/backups-offhost/`
- Принудительный прогон: `bash /opt/multichef/infrastructure/scripts/offhost-backup.sh`
- Лог: `tail -F /var/log/multichef-offhost.log`
- Сменить target на удалённый: `BACKUP_DST=user@host:/backups/multichef/ bash offhost-backup.sh`
