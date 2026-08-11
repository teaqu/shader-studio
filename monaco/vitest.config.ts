import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        pool: 'forks',
        poolOptions: { forks: { maxForks: 1 } },
    }
});
