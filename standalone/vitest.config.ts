import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { shaderStudioAliases } from '../vite.aliases.mjs';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    name: 'standalone',
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    // Svelte 5 ships separate server/client builds; without the browser
    // condition vitest resolves the server one and runes throw at mount.
    conditions: ['browser'],
    alias: [
      { find: '@shader-studio/shader-explorer', replacement: path.resolve(__dirname, '../shader-explorer/src') },
      ...Object.entries(shaderStudioAliases).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      {
        find: '@shader-studio/ui',
        replacement: path.resolve(__dirname, '../ui/src'),
      },
      // Extension modules imported by tests resolve `vscode` to a stub; only
      // the parity test imports such a module, and nothing else imports `vscode`.
      { find: /^vscode$/, replacement: path.resolve(__dirname, 'src/test/vscodeStub.ts') },
    ],
  },
});
