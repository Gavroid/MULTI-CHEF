// MC-010 — Auth request schemas. The schemas live in this file so
// they can be unit-tested without pulling in `nestjs-zod` (whose rxjs
// peer-dep is hoisted only into the runtime resolution path, not the
// test runner). The DTO classes that `nestjs-zod` needs are in
// `auth.dto-classes.ts`.

import { z } from 'zod';

export const RegisterBody = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(8).max(256),
    // PRD §2.3.1 — optional family name captured by the register form;
    // auth.service defaults to «Моя семья» when absent. (Re-added after
    // MC-107 .strict() promotion silently rejected the field the UI sends.)
    householdName: z.string().min(1).max(120).optional(),
    guestProfile: z
      .object({
        peopleCount: z.number().int().min(1).max(20).optional(),
        budgetWeekKopecks: z.number().int().nonnegative().optional(),
        preferences: z
          .array(
            z.object({
              ingredientId: z.string().optional(),
              kind: z.enum(['LOVE', 'DISLIKE', 'ALLERGY', 'EXCLUDE']),
              note: z.string().max(200).optional(),
            }),
          )
          .optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

export const LoginBody = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1).max(256),
  })
  .strict();

export const LogoutBody = z.object({}).strict();

// T46-C (E23): UI locale switch — drives API error-message language.
export const LocaleBody = z
  .object({
    locale: z.enum(['ru', 'en']),
  })
  .strict();
