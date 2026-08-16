import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          args: ['--enable-unsafe-webgpu'],
        },
      }),
      instances: [
        { browser: 'chromium' },
      ],
    },
    include: ['src/test/**/*.e2e.test.ts'],
    globals: true,
  },
});
