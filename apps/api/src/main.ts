import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

// MC-001 scaffold: global /api/v1 prefix and trust proxy enabled for the
// future Nginx gateway (MC-071). Real config (env, logging, CORS) lands
// in MC-002 alongside the Zod env schema (see ADR-0007).

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, logger: false }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`api listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
