// MC-010 — Auth DTO classes (`nestjs-zod` shims). Imported by
// `auth.controller.ts` and `main.ts` for body validation. Unit tests
// target the underlying zod schemas in `auth.dto.ts` to avoid pulling
// in `nestjs-zod` (and its rxjs peer-dep) at test time.

import { createZodDto } from 'nestjs-zod';
import { LocaleBody, LoginBody, LogoutBody, RegisterBody } from './auth.dto.js';

export class RegisterDto extends createZodDto(RegisterBody) {}
export class LocaleDto extends createZodDto(LocaleBody) {}
export class LoginDto extends createZodDto(LoginBody) {}
export class LogoutDto extends createZodDto(LogoutBody) {}
