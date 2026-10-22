import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApi, createApp } from './bootstrap';

/** Writes docs/openapi.json without starting the HTTP listener (needs DB/Redis env for module init). */
async function main() {
  const app = await createApp(undefined, { logger: false });
  await app.init();
  const out = resolve(__dirname, '../../../docs/openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2));
  console.warn(`Wrote ${out}`);
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
