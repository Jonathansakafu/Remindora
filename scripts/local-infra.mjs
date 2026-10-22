#!/usr/bin/env node
/**
 * Local Postgres + Redis without Docker.
 *
 *   npm run local:infra            # starts both, keeps running (Ctrl+C to stop)
 *
 * Postgres data persists in .local-infra/pg. Ports match .env.example
 * (Postgres 54329, Redis 63799) so they don't collide with system services.
 * If you have Docker, `docker compose up -d` is the equivalent.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '.local-infra');
const pgDir = join(root, 'pg');
const PG_PORT = Number(process.env.PG_PORT ?? 54329);
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 63799);

mkdirSync(root, { recursive: true });
const fresh = !existsSync(join(pgDir, 'PG_VERSION'));
const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'remindora', password: 'remindora', port: PG_PORT, persistent: true, onLog: () => {} });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase('remindora');
  await pg.createDatabase('remindora_test');
}
const redis = new RedisMemoryServer({ instance: { port: REDIS_PORT } });
await redis.start();

console.log(`Postgres  postgresql://remindora:remindora@localhost:${PG_PORT}/remindora`);
console.log(`Redis     redis://localhost:${REDIS_PORT}`);
console.log('Ctrl+C to stop.');

const stop = async () => {
  await redis.stop().catch(() => {});
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
