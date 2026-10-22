import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E2E_ENV } from '../playwright.config';

/** Starts the background workers (reminder delivery). The API web server migrates the database on start. */
export default async function globalSetup() {
  const root = resolve(__dirname, '../../..');
  const workers = spawn('node', ['dist/main.js'], { cwd: resolve(root, 'apps/workers'), env: { ...process.env, ...E2E_ENV }, stdio: 'ignore', detached: true });
  workers.unref();
  writeFileSync(resolve(__dirname, '.workers.pid'), String(workers.pid));
}
