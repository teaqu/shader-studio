import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'vmThreads',
    poolOptions: { vmThreads: { maxThreads: 4 } },
    coverage: {
      exclude: [
        'src/test/**',
        '**/*.test.{js,ts}',
        '**/*.spec.{js,ts}'
      ]
    }
  }
});
