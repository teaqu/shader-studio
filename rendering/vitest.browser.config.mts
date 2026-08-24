import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const chromiumArgs = process.env.CI
  ? [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=swiftshader',
      '--use-vulkan=swiftshader',
      '--disable-vulkan-surface',
    ]
  : ['--enable-unsafe-webgpu'];

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
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
