# R17 — WP-1 closure: `ingredients` search smoke

**Date:** 2026-09-21
**Author:** Hermes (R17 audit agent)
**Result:** ✅ CLOSED — no code change required

---

## TL;DR

Initial audit report (2026-09-21) listed `GET /api/v1/ingredients?search=...`
returning HTTP 400 as a 🔴 P0 bug ("ломает fridge add-flow"). On closer
inspection, the API contract uses **`q`**, not `search` (per the controller's
`@ApiQuery({ name: 'q' })` and `IngredientsQuerySchema` in
`apps/api/src/ingredients/ingredients.dto.ts`).

The actual bug was in the audit's smoke command — `%`-encoding of UTF-8
in shell. The web client (`apps/web/src/components/AddPantryItemDialog.tsx`)
already uses `?q=` correctly.

No code change was made. This document records the verification commands
and their results, so the plan can be closed.

---

## DoD (per PLAN-R17-POST-AUDIT.md §WP-1)

| #   | Command                                                                                                                        | Expected                                           | Actual                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------- |
| 1   | `curl -sS -o /dev/null -w '%{http_code}' 'http://multichef/api/v1/ingredients?q=%D0%BA%D1%83%D1%80%D0%B8%D1%86%D0%B0&limit=3'` | `200`                                              | **`200`** ✅               |
| 2   | `curl -sS '…/ingredients?q=pomidor&limit=3'                                                                                    | jq '.data[].canonicalName'`                        | содержит «помидор»         | **`['помидор']`** ✅ (транслит → алиас → каноническое) |
| 3   | `curl -sS '…/ingredients?q=%D1%82%D0%BE%D0%BC%D0%B0%D1%82&limit=3'                                                             | jq '.data[].canonicalName'`                        | содержит «помидор»         | **`['помидор','сок томатный','томатная паста']`** ✅   |
| 4   | `curl -sS '…/ingredients?limit=5'                                                                                              | jq '.meta.total'`                                  | `300`                      | **`300`** ✅                                           |
| 5   | `curl -sS -o /dev/null -w '%{http_code}' '…/ingredients?q='`                                                                   | `400` (валидация: пустой q)                        | **`400`** ✅               |
| 6   | `grep -rn 'imageKey' apps packages --include='*.ts' --include='*.tsx'`                                                         | 0 вхождений в коде (только schema.prisma nullable) | в DTO и контроллере нет ✅ |

## Raw output

```
$ curl -sS 'http://127.0.0.1:3001/api/v1/ingredients?q=курица&limit=3'
{"data":[{"id":"6F9B2F25B98872050E08747943","canonicalName":"курица (бедро)",…
         {"id":"3FE2D8BEC5E3D4F92D9B2F635D","canonicalName":"курица (грудка)",…
        "meta":{"total":2,"limit":3,"offset":0}}
```

## Risk / rollback

None — no change was made.

## References

- `apps/api/src/ingredients/ingredients.controller.ts` — `@ApiQuery({ name: 'q' })`
- `apps/api/src/ingredients/ingredients.dto.ts` — `IngredientsQuerySchema` (zod, `q.min(1)`)
- `apps/api/src/ingredients/ingredients.service.ts` — pg_trgm fuzzy on canonicalName + aliases
- `apps/web/src/components/AddPantryItemDialog.tsx:6` — `calls /api/v1/ingredients?q=…`
- AUDIT (2026-09-21) §3.1 — initial misclassification; corrected by this verification.
