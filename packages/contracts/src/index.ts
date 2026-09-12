// Cross-package TypeScript contracts (DTOs, types, schemas).
//
// MC-033: first real contracts — recipes catalog + recommendations/today.
// Schemas are Zod; apps/api maps Prisma rows into these shapes, apps/web
// (MC-034) validates responses with the same schemas.

export * from './recipes.js';
export * from './recommendations.js';
export * from './rescue.js';
export * from './zod-swagger.js';
