import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import path from 'path';

export default defineConfig({
    plugins: [svelte({ hot: !process.env.VITEST })],
    resolve: {
        alias: [
            { find: '@shader-studio/rendering', replacement: path.resolve(__dirname, '../rendering/src') },
            { find: '@shader-studio/types', replacement: path.resolve(__dirname, '../types/src') },
            {
                find: /^svelte$/,
                replacement: fileURLToPath(new URL('../node_modules/svelte/src/index-client.js', import.meta.url)),
            },
        ],
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
    },
});
