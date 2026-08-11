import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shader-studio/glsl-analysis': path.resolve(__dirname, '../language-servers/glsl-analysis/src'),
    },
  },
  test: {
    environment: 'node',
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
