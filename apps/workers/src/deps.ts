import { buildKeysFromEnv } from './keys';
import { loadServerEnv, type ServerEnv } from '@remindora/config';
import { PrismaClient } from '@remindora/database';
import { createEmailSender, type EmailSender } from '@remindora/notifications';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import pino from 'pino';
import { createPushProviders, type PushProviders } from './delivery/push';

export interface Deps {
  env: ServerEnv;
  prisma: PrismaClient;
  redis: Redis;
  emitter: Emitter;
  email: EmailSender;
  push: PushProviders;
  keys: ReturnType<typeof buildKeysFromEnv>;
  log: pino.Logger;
}

export function createDeps(env: ServerEnv = loadServerEnv(), overrides: Partial<Deps> = {}): Deps {
  const log = overrides.log ?? pino({ level: env.LOG_LEVEL, base: { svc: 'workers' }, redact: ['token', 'pushToken', 'subscription'] });
  const redis = overrides.redis ?? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const keys = buildKeysFromEnv(env);
  return {
    env,
    prisma: overrides.prisma ?? new PrismaClient(),
    redis,
    emitter: overrides.emitter ?? new Emitter(redis),
    email: overrides.email ?? createEmailSender({ provider: env.EMAIL_PROVIDER, from: env.EMAIL_FROM, smtpUrl: env.SMTP_URL, resendApiKey: env.RESEND_API_KEY, log: (l) => log.info(l) }),
    push: overrides.push ?? createPushProviders(env, log),
    keys,
    log,
  };
}
