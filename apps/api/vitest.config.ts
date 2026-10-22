import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed for NestJS decorator metadata (esbuild doesn't emit it).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e.test.ts'],
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
