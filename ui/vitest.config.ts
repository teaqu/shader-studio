import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import path from 'path';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    pool: 'vmThreads',
    poolOptions: { vmThreads: { maxThreads: 4 } },
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
    alias: [
      {
        find: '@shader-studio/glsl-debug',
        replacement: path.resolve(__dirname, '../debug/src'),
      },
      {
        find: '@shader-studio/monaco',
        replacement: path.resolve(__dirname, '../monaco/src'),
      },
      {
        find: '@shader-studio/rendering',
        replacement: path.resolve(__dirname, '../rendering/src'),
      },
      {
        find: '@shader-studio/types',
        replacement: path.resolve(__dirname, '../types/src'),
      },
      {
        find: /^svelte\/store$/,
        replacement: fileURLToPath(new URL('./src/test/svelte-store-shim.ts', import.meta.url)),
      },
      {
        find: /^svelte$/,
        replacement: fileURLToPath(new URL('../node_modules/svelte/src/index-client.js', import.meta.url)),
      },
    ],
  }
});
