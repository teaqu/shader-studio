import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Rendering suites replace browser globals and mock the same engine
    // modules. Run each file in a fork and avoid overlapping suites.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
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
