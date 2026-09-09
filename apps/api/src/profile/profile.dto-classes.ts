// MC-011 — Profile DTO classes (`nestjs-zod` shims). Imported by
// `profile.controller.ts`. Unit tests target the underlying zod
// schemas in `profile.dto.ts` to avoid pulling nestjs-zod (and its
// rxjs peer-dep) at test time.

import { createZodDto } from 'nestjs-zod';
import {
  HouseholdPatchSchema,
  NutritionPutSchema,
  OnboardingSchema,
  PreferenceCreateSchema,
  ProfilePatchSchema,
} from './profile.dto.js';

export class ProfilePatchDto extends createZodDto(ProfilePatchSchema) {}
export class NutritionPutDto extends createZodDto(NutritionPutSchema) {}
export class PreferenceCreateDto extends createZodDto(PreferenceCreateSchema) {}
export class OnboardingDto extends createZodDto(OnboardingSchema) {}
export class HouseholdPatchDto extends createZodDto(HouseholdPatchSchema) {}
