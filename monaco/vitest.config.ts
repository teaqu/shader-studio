import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        pool: 'vmThreads',
        poolOptions: { vmThreads: { maxThreads: 4 } },
    }
});
