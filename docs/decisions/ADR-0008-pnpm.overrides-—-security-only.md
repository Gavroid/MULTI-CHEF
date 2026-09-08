# ADR-0008: pnpm.overrides — security-only

## Status

**Accepted**

## Date

**2026-09-08**

## Context

MC-001 пришлось добавить `pnpm.overrides` для postcss и fastify (2 high + 4 moderate CVE в дефолтных резолвах). MC-003 добавил deepmerge-ts. Без правила эти overrides могут накапливаться бесконтрольно.

## Decision

`pnpm.overrides` в корневом `package.json` допустимы ТОЛЬКО по security-причине. Каждый override содержит: ссылку на advisory (GHSA-XXXX), дату пересмотра, краткое обоснование. Новые overrides добавляются отдельным коммитом с указанием advisory. CI (MC-005) запускает `pnpm audit --prod` для проверки что override'ы обоснованы.

## Consequences

### Positive

- Каждый override имеет audit-trail — можно отследить когда и зачем
- Накопление overrides ограничено — только реальные CVE
- Регулярный пересмотр (помечен датой)

### Negative

- Некоторые пакеты могут не обновляться из-за overrides — допустимая цена

### Neutral

- Зафиксировано также в CONTRIBUTING.md §7
