import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'

export default defineConfig({
    plugins: [svelte()],
    base: './', // Use relative paths for assets
    build: {
        outDir: 'dist',
        assetsDir: 'assets'
    },
    resolve: {
        alias: {
            '@shader-studio/glsl-debug': path.resolve(__dirname, '../debug/src'),
            '@shader-studio/monaco': path.resolve(__dirname, '../monaco/src'),
            '@shader-studio/rendering': path.resolve(__dirname, '../rendering/src'),
            '@shader-studio/types': path.resolve(__dirname, '../types/src'),
        }
    }
})
