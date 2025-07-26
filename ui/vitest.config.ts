import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      exclude: [
        'vendor/**',
        'src/test/**',
        '**/*.test.{js,ts}',
        '**/*.spec.{js,ts}',
        'src/vite-env.d.ts',
        'src/vscode.d.ts'
      ]
    }
  },
  resolve: {
    conditions: process.env.VITEST ? ['browser'] : undefined,
  }
});
