import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { shaderStudioAliases } from '../vite.aliases.mjs';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    name: 'web-host',
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    // Svelte 5 ships separate server/client builds; without the browser
    // condition vitest resolves the server one and runes throw at mount.
    conditions: ['browser'],
    alias: [
      ...Object.entries(shaderStudioAliases).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      {
        find: '@shader-studio/ui',
        replacement: path.resolve(__dirname, '../ui/src'),
      },
    ],
  },
});
