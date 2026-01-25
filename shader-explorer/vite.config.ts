import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
    plugins: [svelte()],
    base: './', // Use relative paths for assets
    build: {
        outDir: 'dist',
        assetsDir: 'assets'
    },
    resolve: {
        alias: {
            '@shader-studio/rendering': path.resolve(__dirname, '../rendering/src'),
            '@shader-studio/types': path.resolve(__dirname, '../types/src'),
        }
    }
})
