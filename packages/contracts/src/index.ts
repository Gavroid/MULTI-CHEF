// Cross-package TypeScript contracts (DTOs, types, schemas).
//
// MC-033: first real contracts — recipes catalog + recommendations/today.
// Schemas are Zod; apps/api maps Prisma rows into these shapes, apps/web
// (MC-034) validates responses with the same schemas.
// R17-WP3: add profile/household contracts for the sub-pages.

export * from './params.js';
export * from './error-messages.js';
export * from './recipes.js';
export * from './recommendations.js';
export * from './rescue.js';
export * from './roulette.js';
export * from './jobs.js';
export * from './meal-plans.js';
export * from './budget.js';
export * from './plan-view.js';
export * from './prep-view.js';
export * from './profile.js';
export * from './zod-swagger.js';
