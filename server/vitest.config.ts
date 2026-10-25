import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setupEnv.ts'],
    // Each test file gets its own database on the shared replica set.
    fileParallelism: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
