# FIX-PLAN — бэклог находок аудитов #21–#N

Легенда приоритетов: 🔴 P0 (security/data loss), 🔴 P1 (schema drift/correctness),
🟠 P2 (UX/observability), 🟡 P3 (hygiene).

| Round | ID    | Priority | Title                                                                | File                                       | Status | Commit |
| ----- | ----- | -------- | -------------------------------------------------------------------- | ------------------------------------------ | ------ | ------ |
| 21    | T21-A | 🟠 P2    | `runWithMirror` не выставляет `status=COMPLETED` на void-return пути | apps/worker/src/job-runner.ts:51-65        | open   | —      |
| 21    | T21-B | 🟠 P2    | BullMQ `Worker` без `attempts`/`backoff`/`DLQ`                       | apps/worker/src/main.ts:21-25              | open   | —      |
| 21    | T21-C | 🟡 P3    | Worker без структурного логгера                                      | apps/worker/src/main.ts, loop.ts           | open   | —      |
| 21    | T21-D | 🟡 P3    | `NoopQueuePublisher` молчит при отсутствии `REDIS_URL`               | apps/api/src/jobs/queue-publisher.ts:38-43 | open   | —      |
