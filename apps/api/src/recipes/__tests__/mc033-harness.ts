// MC-033 — Test harness: boots the real Nest app modules against the
// integration Postgres, seeds, registers a user, and exposes get/post
// helpers on globalThis.__mc033 for the spec files.

import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { PrismaClient, Prisma } from '@prisma/client';
import { withTenantContext } from '@multichef/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuthModule } from '../../auth/auth.module.js';
import { RecipesModule } from '../../recipes/recipes.module.js';
import { RecommendationsModule } from '../../recommendations/recommendations.module.js';
import { AppHttpExceptionFilter } from '../../common/exception-filter.js';
import { IdempotencyKeyGuard } from '../../common/idempotency.js';

const PKG_ROOT = process.cwd();

export interface Mc033Harness {
  get(url: string): Promise<{ statusCode: number; body: string }>;
  post(url: string, body: Record<string, unknown>): Promise<{ statusCode: number; body: string }>;
  postNoAuth(
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: string }>;
  firstRecipeId: string;
  seedChickenDinnerYesterday(): Promise<void>;
}

let app: NestFastifyApplication | undefined;
let prisma: PrismaClient | undefined;
let sessionToken: string | undefined;
let harness: Mc033Harness | undefined;

function newEmail(): string {
  return `mc033-${randomUUID().slice(0, 12)}@example.com`;
}
function makePassword(): string {
  return 'Pa' + randomBytes(20).toString('base64url');
}

export async function setup(): Promise<Mc033Harness> {
  if (harness) return harness;
  const url = process.env['INTEGRATION_DATABASE_URL'];
  if (!url) throw new Error('INTEGRATION_DATABASE_URL is required');

  execSync(
    'pnpm --filter @multichef/database exec prisma migrate deploy --schema prisma/schema.prisma',
    {
      cwd: PKG_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    },
  );
  // Seed catalog (ingredients + 269 CURATED recipes). Idempotent.
  execSync('pnpm --filter @multichef/database db:seed', {
    cwd: PKG_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  @Module({
    imports: [AuthModule, RecipesModule, RecommendationsModule],
    providers: [
      { provide: APP_FILTER, useClass: AppHttpExceptionFilter },
      { provide: APP_GUARD, useClass: IdempotencyKeyGuard },
    ],
  })
  class TestModule {}

  const adapter = new FastifyAdapter({ trustProxy: true });
  await adapter.register(fastifyCookie as never, { secret: 'test-secret' });
  app = await NestFactory.create<NestFastifyApplication>(TestModule, adapter, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // Register + login a user (creates household as OWNER).
  // NOTE: POST requires Idempotency-Key (global guard) — missing key = 400.
  const email = newEmail();
  const password = makePassword();
  const registerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `mc033-bootstrap-${email}`,
    },
    payload: JSON.stringify({ email, password }),
  });
  if (registerRes.statusCode !== 200 && registerRes.statusCode !== 201) {
    throw new Error(`register failed: ${registerRes.statusCode} ${registerRes.body}`);
  }
  const registerBody = JSON.parse(registerRes.body) as { sessionToken?: string };
  // The DB stores only the token HASH; the cookie value IS the raw token.
  const cookieToken =
    registerBody.sessionToken ??
    registerRes.cookies.find((c: { name: string }) => c.name === 'mc_session')?.value;
  if (!cookieToken) throw new Error('no session token after register');
  sessionToken = cookieToken;

  const first = await prisma.recipe.findFirst({
    where: { sourceType: 'CURATED', status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  harness = {
    firstRecipeId: first!.id,
    async get(url: string) {
      return app!.inject({ method: 'GET', url });
    },
    async post(url: string, body: Record<string, unknown>) {
      return app!.inject({
        method: 'POST',
        url,
        cookies: sessionToken ? { mc_session: sessionToken } : {},
        headers: { 'idempotency-key': `mc033-${url.replace(/\W+/g, '-')}-${Date.now()}` },
        payload: body,
      });
    },
    async postNoAuth(url: string, body: Record<string, unknown>) {
      // Idempotency-Key guard runs before AuthGuard; without a key the
      // response is 400, masking the 401 we want to assert here.
      return app!.inject({
        method: 'POST',
        url,
        headers: { 'idempotency-key': `mc033-noauth-${Date.now()}` },
        payload: body,
      });
    },
    async seedChickenDinnerYesterday() {
      const user = await prisma!.user.findUnique({ where: { email }, select: { id: true } });
      const membership = await prisma!.householdMember.findFirst({
        where: { userId: user!.id, role: 'OWNER' },
        select: { householdId: true },
      });
      const householdId = membership!.householdId;
      const chicken = await prisma!.recipe.findFirst({
        where: {
          sourceType: 'CURATED',
          status: 'PUBLISHED',
          ingredients: { some: { ingredient: { canonicalName: { contains: 'куриц' } } } },
        },
        select: { id: true },
      });
      if (!chicken) throw new Error('no chicken recipe in seed');
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // ADR-0023 phase 3: MealPlan is RLS-protected — seed inside the
      // household's tenant context.
      const plan = await withTenantContext({ householdId, userId: user!.id }, async (tx) =>
        tx.mealPlan.create({
          data: {
            id: `mc033plan${Date.now()}`.slice(0, 26),
            householdId,
            startDate: yesterday,
            endDate: yesterday,
            peopleCount: 1,
            generationSettings: {},
            status: 'ACTIVE',
            days: {
              create: {
                id: `mc033day${Date.now()}`.slice(0, 26),
                date: yesterday,
                totalCalories: 0,
                totalProteinG: 0,
                totalFatG: 0,
                totalCarbsG: 0,
                entries: {
                  create: {
                    id: `mc033ent${Date.now()}`.slice(0, 26),
                    mealType: 'DINNER',
                    recipeId: chicken.id,
                    servings: new Prisma.Decimal(1),
                    portionGrams: new Prisma.Decimal(350),
                    position: 1,
                    source: 'GENERATED',
                  },
                },
              },
            },
          },
        }),
      );
      void plan;
    },
  };
  return harness;
}

export async function teardown(): Promise<void> {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
}
