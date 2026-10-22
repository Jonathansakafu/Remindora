import { createApp } from './bootstrap';
import { loadServerEnv } from './config';

async function main() {
  const env = loadServerEnv();
  const app = await createApp(env);
  await app.listen(env.PORT, '0.0.0.0');
  console.warn(`Remindora API on ${env.API_PUBLIC_URL} — docs at ${env.API_PUBLIC_URL}/docs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
