import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: './', // Use relative paths for assets
  resolve: {
    alias: {
      '@shader-studio/glsl-debug': path.resolve(__dirname, '../debug/src'),
      '@shader-studio/monaco': path.resolve(__dirname, '../monaco/src'),
      '@shader-studio/rendering': path.resolve(__dirname, '../rendering/src'),
      '@shader-studio/types': path.resolve(__dirname, '../types/src'),
    },
  },
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
