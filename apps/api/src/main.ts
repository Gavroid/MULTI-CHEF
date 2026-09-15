import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { Logger } from '@nestjs/common';
import { loadServerEnv, EnvValidationError } from '@multichef/config';
import { swaggerSchemas } from '@multichef/contracts';
import { AppModule } from './app.module.js';

// MC-002: load + validate env before NestFactory boots. The API must
// fail fast at startup if anything is missing or malformed — we never
// want to reach `app.listen()` with a half-configured environment.

let env: ReturnType<typeof loadServerEnv>;
try {
  env = loadServerEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

async function bootstrap(): Promise<void> {
  // Audit fix: trust only our nginx gateway (single hop) — client
  // X-Forwarded-For is not trusted for rate-limit IP extraction.
  const fastifyAdapter = new FastifyAdapter({ trustProxy: '127.0.0.1', logger: false });
  // T54-D (E24): raw image upload bodies. The parser accepts only the
  // three allowed image types and buffers up to 8 MB — deliberately
  // ABOVE the service's 5 MB cap so oversize uploads reach the service
  // and answer a clean VALIDATION_ERROR envelope (a parser-level
  // bodyLimit failure bypasses Nest's exception filter and lands as a
  // raw 413/500). nginx caps the wire at 10 MB.
  fastifyAdapter
    .getInstance()
    .addContentTypeParser(
      ['image/webp', 'image/jpeg', 'image/png'],
      { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 },
      (_req: unknown, body: unknown, done: (err: null, body: unknown) => void) => {
        done(null, body);
      },
    );
  // @fastify/cors MUST be registered first — before any other plugin
  // that touches the response (helmet, cookie) so the OPTIONS
  // preflight is short-circuited with the right headers. We
  // CORS_ORIGINS is parsed by packages/config into a string[].
  // When credentials are true the spec forbids `*`, so we always
  // echo the request Origin back (a per-origin allowlist).
  await fastifyAdapter.register(fastifyCors as never, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      // Same-origin / curl / server-to-server: no Origin header → allow.
      if (!origin) return cb(null, true);
      if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    // T41-A/B: X-CSRF-Token нужен для cross-origin мутаций, Retry-After —
    // для 429-ответов rate limiter.
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'Cookie', 'X-CSRF-Token'],
    exposedHeaders: [
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'Retry-After',
    ],
    maxAge: 86400,
  });
  // @fastify/cookie is registered before Nest boots so req.cookies
  // is available to controllers via the type-ergonomic cast in
  // auth.controller.ts.
  await fastifyAdapter.register(fastifyCookie as never, {
    secret: env.COOKIE_SECRET,
  });
  await fastifyAdapter.register(fastifyHelmet as never, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter, {
    bufferLogs: true,
  });
  app.useLogger(new Logger('MC-010'));

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // OpenAPI / Swagger.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('MULTI-CHEF API')
    .setDescription('Backend HTTP API for the MULTI-CHEF monorepo (Phase 1+).')
    .setVersion('0.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'ULID-26' }, 'session-token')
    .addCookieAuth('mc_session', { type: 'apiKey', in: 'cookie', name: 'mc_session' })
    .build();
  // Audit round-6 (ops): the full API contract (models, paths) is an
  // internal artefact — do not expose it on internet/LAN deployments.
  // Swagger stays available in non-production for development.
  if (env.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    // MC-033 (QA blocker #2): register Zod-derived OpenAPI schemas so
    // the recipes/recommendations wire DTOs appear in Swagger.
    for (const [name, schema] of Object.entries(swaggerSchemas)) {
      document.components ??= {};
      document.components.schemas ??= {};
      document.components.schemas[name] = schema as never;
    }
    SwaggerModule.setup('api/v1/docs', app, document, {
      swaggerOptions: { persistAuthorization: false },
    });
  }

  await app.listen(env.API_PORT, '0.0.0.0');
  // T18-F (audit round 18): banner through the Nest logger so boot
  // lines share one format with the rest of the application log.
  const bootstrap = new Logger('Bootstrap');
  bootstrap.log(`env: ok (NODE_ENV=${env.NODE_ENV}, CORS=${env.CORS_ORIGINS.length} origins)`);
  bootstrap.log(`api listening on http://localhost:${env.API_PORT}/api/v1`);
  bootstrap.log(`openapi:   http://localhost:${env.API_PORT}/api/v1/docs`);
}

void bootstrap();
