// MC-022 — Pantry DTO classes (`nestjs-zod` shims). Imported by
// `pantry.controller.ts` for `@Body()` decorator validation. Unit
// tests target the underlying zod schemas in `pantry.dto.ts` to
// avoid pulling nestjs-zod's rxjs peer at test time.

import { createZodDto } from 'nestjs-zod';
import { CreatePantryItemSchema, PatchPantryItemSchema } from './pantry.dto.js';

export class CreatePantryItemDto extends createZodDto(CreatePantryItemSchema) {}
export class PatchPantryItemDto extends createZodDto(PatchPantryItemSchema) {}
