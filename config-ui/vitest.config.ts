import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
    plugins: [svelte({ hot: !process.env.VITEST })],
    test: {
        environment: 'jsdom',
        globals: true,
        passWithNoTests: true,
        setupFiles: ['./src/test/setup.ts']
    },
    resolve: {
        conditions: process.env.VITEST ? ['browser'] : undefined,
    }
});
