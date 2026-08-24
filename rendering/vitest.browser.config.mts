import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const chromiumArgs = process.platform === 'linux'
  ? [
      '--enable-unsafe-webgpu',
      '--enable-webgpu-developer-features',
      '--use-gpu-in-tests',
      '--enable-accelerated-2d-canvas',
      '--use-webgpu-power-preference=default-high-performance',
    ]
  : ['--enable-unsafe-webgpu'];

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          // Headless Linux needs explicit GPU-test opt-in for WebGPU canvas
          // command submission and readback. Keep local browser defaults.
          args: chromiumArgs,
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
