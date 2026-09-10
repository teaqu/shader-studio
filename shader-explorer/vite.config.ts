import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { shaderStudioAliases } from '../vite.aliases.mjs'

// https://vite.dev/config/
export default defineConfig({
    plugins: [svelte()],
    base: './', // Use relative paths for assets
    build: {
        outDir: 'dist',
        assetsDir: 'assets'
    },
    resolve: {
        alias: { ...shaderStudioAliases }
    }
})
