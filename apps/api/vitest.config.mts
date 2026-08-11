import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    environment: 'node',
    fileParallelism: process.env.RUN_POSTGRES_INTEGRATION !== 'true',
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    restoreMocks: true,
    setupFiles: ['./test/setup-environment.ts'],
  },
});
