# FIX-PLAN — бэклог находок аудитов #21–#N

Легенда приоритетов: 🔴 P0 (security/data loss), 🔴 P1 (schema drift/correctness),
🟠 P2 (UX/observability), 🟡 P3 (hygiene).

| Round | ID    | Priority | Title                                                                                          | File                                                                                           | Status | Commit |
| ----- | ----- | -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ | ------ |
| 21    | T21-A | 🟠 P2    | `runWithMirror` не выставляет `status=COMPLETED` на void-return пути                           | apps/worker/src/job-runner.ts:51-65                                                            | open   | —      |
| 21    | T21-B | 🟠 P2    | BullMQ `Worker` без `attempts`/`backoff`/`DLQ`                                                 | apps/worker/src/main.ts:21-25                                                                  | open   | —      |
| 21    | T21-C | 🟡 P3    | Worker без структурного логгера                                                                | apps/worker/src/main.ts, loop.ts                                                               | open   | —      |
| 21    | T21-D | 🟡 P3    | `NoopQueuePublisher` молчит при отсутствии `REDIS_URL`                                         | apps/api/src/jobs/queue-publisher.ts:38-43                                                     | open   | —      |
| 22    | T22-A | 🟠 P2    | `PantryDialog` без focus management, без `aria-modal`/`aria-labelledby` (WCAG 2.4.3)           | apps/web/src/components/PantryDialog.tsx:30-85                                                 | open   | —      |
| 22    | T22-B | 🟡 P3    | `FormErrorBanner` переключает `aria-live` режим при появлении сообщения                        | apps/web/src/components/FormErrorBanner.tsx:17-32                                              | open   | —      |
| 22    | T22-C | 🟡 P3    | `useTheme` не подписывается на OS-preference change mid-session                                | apps/web/src/hooks/useTheme.ts:62-78                                                           | open   | —      |
| 23    | T23-A | 🟠 P2    | `setPurchased`/`setDone` используют unsafe cast + silent `=== true` (Zod-валидация пропущена)  | apps/api/src/shopping-lists/shopping-lists.controller.ts:81-92, meal-plans.controller.ts:85-94 | open   | —      |
| 23    | T23-B | 🟡 P3    | 86× `req as unknown as { user: AuthenticatedUser }` — нужен module augmentation FastifyRequest | apps/api/src/**/controllers/*.ts                                                               | open   | —      |
| 23    | T23-C | 🟡 P3    | `enum Foo as unknown as string[]` костыль для Swagger `@ApiQuery` (4 случая)                   | apps/api/src/pantry/pantry.controller.ts:77-78, ingredients.controller.ts:48-49                | open   | —      |
