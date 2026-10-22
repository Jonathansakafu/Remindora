import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { loadServerEnv } from '@remindora/config';
import { PrismaClient } from '@remindora/database';
import type { AuthTokensDTO } from '@remindora/types';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { inject } from 'vitest';
import { createApp } from '../src/bootstrap';
import { AuthService } from '../src/modules/auth/auth.service';

const KEYS = ['NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'ENCRYPTION_KEY', 'PAIRING_KEY', 'OTP_PEPPER', 'DEV_TOOLS', 'BILLING_PROVIDER', 'EMAIL_PROVIDER', 'LOG_LEVEL', 'WEB_URL', 'API_PUBLIC_URL', 'RATE_LIMIT_MULTIPLIER'] as const;

export interface Harness {
  app: INestApplication;
  url: string;
  prisma: PrismaClient;
  outbox: Array<{ to: string; subject: string; text: string }>;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  for (const k of KEYS) process.env[k] = inject(k as never) as unknown as string;
  const env = loadServerEnv({ ...process.env });
  const app = await createApp(env, { logger: false });
  const outbox: Harness['outbox'] = [];
  // Capture transactional email instead of printing it.
  (app.get(AuthService) as unknown as { email: unknown }).email = { send: async (m: { to: string; subject: string; text: string }) => (outbox.push(m), { id: null }) };
  await app.listen(0);
  const server = app.getHttpServer();
  const port = server.address().port as number;
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  return {
    app,
    url: `http://localhost:${port}`,
    prisma,
    outbox,
    http: () => request(server),
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

export type Device = { name: string; platform: 'WEB' | 'DESKTOP_MACOS' | 'ANDROID' };
export const DESKTOP: Device = { name: 'Test MacBook', platform: 'DESKTOP_MACOS' };
export const PHONE: Device = { name: 'Test Pixel', platform: 'ANDROID' };

export function lastCode(h: Harness, to: string): string {
  const mail = [...h.outbox].reverse().find((m) => m.to === to.toLowerCase());
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code mailed to ${to}`);
  return code;
}

/** Signs in through the real email-code flow. Native platforms receive the refresh token in the body. */
export async function signIn(h: Harness, email: string, device: Device = DESKTOP): Promise<AuthTokensDTO> {
  const start = await h.http().post('/auth/email/start').send({ email, device }).expect(200);
  const res = await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code: lastCode(h, email), pollSecret: start.body.pollSecret }).expect(200);
  if (res.body.status !== 'signed_in') throw new Error(`sign-in status ${res.body.status}`);
  return res.body.tokens as AuthTokensDTO;
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function connectSocket(h: Harness, token: string): Promise<Socket> {
  return new Promise((ok, fail) => {
    const s = io(h.url, { path: '/realtime', transports: ['websocket'], auth: { token }, forceNew: true });
    s.once('connect', () => ok(s));
    s.once('connect_error', fail);
  });
}

export function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      ok(payload);
    });
  });
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Date.now()}-${counter++}@e2e.test`;
}
