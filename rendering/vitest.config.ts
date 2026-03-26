import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    pool: 'vmThreads',
    poolOptions: { vmThreads: { maxThreads: 4 } },
    exclude: [...configDefaults.exclude, 'src/test/e2e/**', '**/*.e2e.test.*'],
    coverage: {
      exclude: [
        'vendor/**',
        'src/test/**',
        '**/*.test.{js,ts}',
        '**/*.spec.{js,ts}'
      ]
    }
  }
});
