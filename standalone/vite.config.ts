import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { shaderStudioAliasEntries } from '../vite.aliases.mjs';
import { slangAssetManifestPlugin } from '../ui/viteSlangAssetManifest';

// The standalone web shell. It owns the app entry and composes the viewer
// (`@shader-studio/ui`) with the explorer, supplying both with the browser-only
// capabilities they cannot provide for themselves.
export default defineConfig({
  plugins: [svelte(), slangAssetManifestPlugin()],
  base: './',
  resolve: {
    alias: [
      ...shaderStudioAliasEntries,
      { find: '@shader-studio/ui', replacement: path.resolve(__dirname, '../ui/src') },
      { find: '@shader-studio/shader-explorer', replacement: path.resolve(__dirname, '../shader-explorer/src') },
    ],
  },
  optimizeDeps: {
    // The language-service worker is the first importer of the protocol types,
    // so on a cold cache Vite only finds them once the worker loads, optimises
    // them, and force-reloads the page, killing that worker before it answers.
    include: ['monaco-editor', 'vscode-languageserver-protocol'],
  },
  build: {
    cssCodeSplit: false,
  },
});
