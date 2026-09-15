// T31 (audit round 31): единая ULID-схема path-параметров. Строгий
// Crockford-regex pantry + мягкий hex26 для auth-генерации — оба
// матчат 26-символьные ULID-подобные id.
import { z } from 'zod';

export const UlidParamsSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a 26-char ULID');

export function ulidParams(key = 'id') {
  return z.object({ [key]: UlidParamsSchema });
}
