import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: './', // Use relative paths for assets
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  build: {
    // Merge all CSS into a single file. VS Code webviews cannot load
    // dynamically code-split CSS chunks — their URLs resolve against the
    // webview origin and get 403 Forbidden.
    cssCodeSplit: false,
  },
})
