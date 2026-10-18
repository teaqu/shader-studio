import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { shaderStudioAliases } from '../vite.aliases.mjs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: { name: 'file-explorer', environment: 'jsdom', globals: true },
  resolve: { conditions: ['browser'], alias: shaderStudioAliases },
});
