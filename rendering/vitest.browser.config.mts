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
    // WebGPU devices and readback buffers are scarce on hosted runners.
    // Run browser test files serially so concurrent Slang canvases cannot
    // starve one another before their capture requests are submitted.
    fileParallelism: false,
  },
});
