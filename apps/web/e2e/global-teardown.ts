import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default async function globalTeardown() {
  const file = resolve(__dirname, '.workers.pid');
  try {
    process.kill(Number(readFileSync(file, 'utf8')), 'SIGTERM');
  } catch {
    // already stopped
  }
  rmSync(file, { force: true });
}
