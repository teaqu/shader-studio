import path from 'node:path';
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shader-studio/debug': path.resolve(__dirname, '../debug/src'),
      '@shader-studio/types': path.resolve(__dirname, '../types/src'),
      '@shader-studio/wgsl-analysis': path.resolve(__dirname, '../language-servers/wgsl-analysis/src'),
      '@shader-studio/glsl-analysis': path.resolve(__dirname, '../language-servers/glsl-analysis/src'),
      '@shader-studio/language-server-core': path.resolve(__dirname, '../language-servers/core/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Rendering suites replace browser globals and mock the same engine
    // modules. Run each file in a fork and avoid overlapping suites.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    exclude: [...configDefaults.exclude, 'src/test/e2e/**', '**/*.e2e.test.*', 'scripts/**/*.test.mjs'],
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
