import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { corsOrigins } from '@remindora/config';
import { createAdapter } from '@socket.io/redis-adapter';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import Redis from 'ioredis';
import { Logger } from 'nestjs-pino';
import type { ServerOptions } from 'socket.io';
import { createAppModule } from './app.module';
import { loadServerEnv, type ServerEnv } from './config';

class RedisIoAdapter extends IoAdapter {
  private adapter: ReturnType<typeof createAdapter> | null = null;
  constructor(
    app: INestApplication,
    private readonly env: ServerEnv,
  ) {
    super(app);
  }

  async connect() {
    const pub = new Redis(this.env.REDIS_URL);
    const sub = pub.duplicate();
    this.adapter = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, cors: { origin: corsOrigins(this.env), credentials: true } });
    if (this.adapter) server.adapter(this.adapter);
    return server;
  }
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Remindora API')
    .setDescription(
      'REST API for Remindora — tasks, projects, calendar, focus, habits, collaboration, priority notifications and device linking.\n\n' +
        'Authenticate with `Authorization: Bearer <access token>`. Realtime events are delivered over Socket.IO at `/realtime` (auth: `{ token }`).\n\n' +
        'Errors use `{ "error": { "code", "message", "details" } }`. Plan limits return **402** with `code: plan_limit | plan_feature`.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export async function createApp(env: ServerEnv = loadServerEnv(), opts: { logger?: boolean } = {}) {
  if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });

  const app = await NestFactory.create(createAppModule(env), { bodyParser: false, bufferLogs: opts.logger !== false, logger: opts.logger === false ? false : undefined });
  if (opts.logger !== false) app.useLogger(app.get(Logger));

  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.set('trust proxy', 1);
  http.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: corsOrigins(env), credentials: true, allowedHeaders: ['Authorization', 'Content-Type', 'x-remindora-csrf', 'x-claim-secret'], maxAge: 600 });
  app.use(cookieParser());

  // Body parsing: raw bytes for signed webhooks, untouched streams for local blob uploads, JSON elsewhere.
  const json = express.json({ limit: '1mb' });
  const raw = express.raw({ type: '*/*', limit: '1mb' });
  app.use((req: Request & { rawBody?: Buffer }, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/billing/webhook/')) {
      return raw(req, res, (err?: unknown) => {
        if (err) return next(err);
        req.rawBody = req.body as Buffer;
        next();
      });
    }
    if (req.path.endsWith('/blob')) return next();
    return json(req, res, next);
  });
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  const io = new RedisIoAdapter(app, env);
  await io.connect();
  app.useWebSocketAdapter(io);

  const doc = buildOpenApi(app);
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'openapi.json' });
  app.enableShutdownHooks();
  return app;
}
