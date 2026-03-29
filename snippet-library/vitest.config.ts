import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [
        svelte({
            hot: !process.env.VITEST,
            compilerOptions: {
                css: 'injected',
            },
            preprocess: [],
        }),
    ],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        pool: 'vmThreads',
        poolOptions: { vmThreads: { maxThreads: 4 } },
    },
    resolve: {
        alias: [
            {
                find: /^svelte$/,
                replacement: fileURLToPath(new URL('../node_modules/svelte/src/index-client.js', import.meta.url)),
            },
        ],
    },
});
