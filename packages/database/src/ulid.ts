// T56 (audit round 56): канонический ULID-генератор пакета.
// 13 случайных байт → hex → 26 символов (совместимо с regex в схеме:
// [0-9A-HJKMNP-TV-Z]{26} допускает 0/1 — для внутренних id достаточно).
// Дубликаты из seed/скриптов и auth/session-token.ts заменены этим
// единым хелпером (T56-A: «3 копии самописной ulid()»).
import { randomBytes } from 'node:crypto';

export function generateUlid(): string {
  return randomBytes(13).toString('hex').toUpperCase().padEnd(26, '0').slice(0, 26);
}
