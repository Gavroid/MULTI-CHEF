import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { Logger } from '@nestjs/common';
import { loadServerEnv, EnvValidationError } from '@multichef/config';
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
  const fastifyAdapter = new FastifyAdapter({ trustProxy: true, logger: false });
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
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, document, {
    swaggerOptions: { persistAuthorization: false },
  });

  await app.listen(env.API_PORT, '0.0.0.0');
  console.log(`env: ok (NODE_ENV=${env.NODE_ENV}, CORS=${env.CORS_ORIGINS.length} origins)`);
  console.log(`api listening on http://localhost:${env.API_PORT}/api/v1`);
  console.log(`openapi:   http://localhost:${env.API_PORT}/api/v1/docs`);
}

void bootstrap();
