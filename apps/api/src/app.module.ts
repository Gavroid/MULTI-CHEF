import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppHttpExceptionFilter } from './common/exception-filter.js';
import { IdempotencyKeyGuard } from './common/idempotency.js';
import { CSRF_GUARD_PROVIDER } from './common/csrf-guard.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { HouseholdModule } from './household/household.module.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { PantryModule } from './pantry/pantry.module.js';
import { RecipesModule } from './recipes/recipes.module.js';
import { RecommendationsModule } from './recommendations/recommendations.module.js';
import { JobsModule } from './jobs/jobs.module.js';

// MC-010 — global app wiring.
//
// Cross-cutting concerns live here (filters, guards, throttler) so
// they apply to every module added in future MCs (MC-011 profiles,
// MC-020 ingredients, etc.). Per-module concerns live in their own
// module file.

@Module({
  imports: [
    // Rate limit. The 'auth' bucket is the only named bucket for now;
    // MC-051 will introduce Redis-backed storage and more buckets.
    ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 10 }]),
    HealthModule,
    AuthModule,
    ProfileModule,
    HouseholdModule,
    IngredientsModule,
    PantryModule,
    RecipesModule,
    RecommendationsModule,
    JobsModule,
  ],
  providers: [
    // Global exception filter — converts every thrown error into the
    // docs/api/conventions.md §2 envelope.
    { provide: APP_FILTER, useClass: AppHttpExceptionFilter },
    // Rate limit applies to every route by default; specific endpoints
    // can opt out with @ThrottlerSkip().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Idempotency-Key guard — enforces the header on POST/PUT/PATCH/DELETE.
    { provide: APP_GUARD, useClass: IdempotencyKeyGuard },
    // CSRF double-submit (PRD §879, QA blocker #1): mc_csrf cookie +
    // X-CSRF-Token header on every mutating request that carries the
    // csrf cookie. Soft mode — requests without the csrf cookie pass
    // (non-browser clients); hard-fail for all mutations incl. MC-010
    // auth is deferred to a dedicated ADR (post-MC-055 tech debt).
    CSRF_GUARD_PROVIDER,
  ],
})
export class AppModule {}
