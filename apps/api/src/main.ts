import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { loadServerEnv, EnvValidationError } from '@multichef/config';

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
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, logger: false }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');
  console.log(`env: ok (NODE_ENV=${env.NODE_ENV}, CORS=${env.CORS_ORIGINS.length} origins)`);
  console.log(`api listening on http://localhost:${env.API_PORT}/api/v1`);
}

void bootstrap();
