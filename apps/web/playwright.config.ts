import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Browser end-to-end tests against the real stack: API + workers + production web build.
 * Requires Postgres/Redis (`npm run local:infra` locally; service containers in CI).
 * Uses its own ports and the remindora_test database so it never touches dev data.
 */
const root = resolve(__dirname, '../..');
const dotenv = Object.fromEntries(
  (() => {
    try {
      return readFileSync(resolve(root, '.env'), 'utf8')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]);
    } catch {
      return [];
    }
  })(),
);

const API_PORT = 4100;
const WEB_PORT = 3100;
export const E2E_ENV = {
  ...dotenv,
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  LOG_LEVEL: 'warn',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://remindora:remindora@localhost:54329/remindora_e2e',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:63799/1',
  API_PUBLIC_URL: `http://localhost:${API_PORT}`,
  WEB_URL: `http://localhost:${WEB_PORT}`,
  CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
  EMAIL_PROVIDER: 'console',
  BILLING_PROVIDER: 'dev',
  DEV_TOOLS: 'true',
  RATE_LIMIT_MULTIPLIER: '50',
  NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_DIST_DIR: '.next-e2e',
} as Record<string, string>;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 },
    // Accounts start on UTC; a UTC browser keeps the app's device-timezone adoption from changing zones mid-test.
    timezoneId: 'UTC',
  },
  webServer: [
    { command: 'npx prisma migrate deploy --schema ../../packages/database/prisma/schema.prisma && node dist/main.js', cwd: resolve(root, 'apps/api'), url: `http://localhost:${API_PORT}/health`, env: E2E_ENV, reuseExistingServer: false, timeout: 60_000 },
    { command: `npx next build && npx next start -p ${WEB_PORT}`, cwd: __dirname, url: `http://localhost:${WEB_PORT}/login`, env: E2E_ENV, reuseExistingServer: false, timeout: 300_000 },
  ],
});
