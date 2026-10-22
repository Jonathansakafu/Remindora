import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';

/**
 * Boots throwaway Postgres + Redis for the e2e suite (no Docker needed), or reuses
 * TEST_DATABASE_URL / TEST_REDIS_URL when provided (CI services).
 */
async function freePort(): Promise<number> {
  return new Promise((ok) => {
    const srv = createServer().listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => ok(port));
    });
  });
}

export default async function setup(project: TestProject) {
  let stop: Array<() => Promise<void>> = [];
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let redisUrl = process.env.TEST_REDIS_URL;

  if (!databaseUrl) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const dir = mkdtempSync(join(tmpdir(), 'remindora-pg-'));
    const port = await freePort();
    const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'test', password: 'test', port, persistent: false, onLog: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('remindora_e2e');
    databaseUrl = `postgresql://test:test@localhost:${port}/remindora_e2e`;
    stop.push(async () => {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    });
  }
  if (!redisUrl) {
    const { RedisMemoryServer } = await import('redis-memory-server');
    const redis = await RedisMemoryServer.create();
    redisUrl = `redis://${await redis.getHost()}:${await redis.getPort()}`;
    stop.push(async () => void (await redis.stop()));
  }

  const dbPkg = resolve(__dirname, '../../../packages/database');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: dbPkg, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' });

  const env = {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    JWT_SECRET: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PAIRING_KEY: randomBytes(32).toString('base64'),
    OTP_PEPPER: randomBytes(32).toString('base64'),
    DEV_TOOLS: 'true',
    BILLING_PROVIDER: 'dev',
    EMAIL_PROVIDER: 'console',
    LOG_LEVEL: 'error',
    RATE_LIMIT_MULTIPLIER: '100',
    WEB_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:4000',
  };
  for (const [k, v] of Object.entries(env)) project.provide(k as never, v as never);
  Object.assign(process.env, env);

  return async () => {
    for (const s of stop.reverse()) await s().catch(() => undefined);
    stop = [];
  };
}
