import { createApp } from './bootstrap';
import { loadServerEnv } from './config';

async function main() {
  const env = loadServerEnv();
  const app = await createApp(env);
  // '::' is dual-stack: IPv4 plus IPv6 private networks (e.g. Railway's *.railway.internal).
  await app.listen(env.PORT, '::');
  console.warn(`Remindora API on ${env.API_PUBLIC_URL} — docs at ${env.API_PUBLIC_URL}/docs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
