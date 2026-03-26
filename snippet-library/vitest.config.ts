import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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
        conditions: process.env.VITEST ? ['browser'] : undefined,
    },
});
