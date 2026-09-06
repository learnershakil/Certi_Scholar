import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    coverage: { include: ['src/**'], exclude: ['src/server.ts', 'src/worker.ts', 'src/seed.ts'] },
  },
});
