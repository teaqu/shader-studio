import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { shaderStudioAliases } from '../vite.aliases.mjs';
import { slangAssetManifestPlugin } from '../ui/viteSlangAssetManifest';

// The standalone web shell. It owns the app entry and composes the viewer
// (`@shader-studio/ui`) with the explorer, supplying both with the browser-only
// capabilities they cannot provide for themselves.
export default defineConfig({
  plugins: [svelte(), slangAssetManifestPlugin()],
  base: './',
  resolve: {
    alias: {
      ...shaderStudioAliases,
      '@shader-studio/ui': path.resolve(__dirname, '../ui/src'),
      '@shader-studio/shader-explorer': path.resolve(__dirname, '../shader-explorer/src'),
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  build: {
    cssCodeSplit: false,
  },
});
