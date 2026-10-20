import { defineConfig } from 'vitest/config';
import { scriptStreamHarness } from './src/test/e2e/node/ScriptStreamHarness';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [scriptStreamHarness()],
  resolve: { alias: { '@shader-studio/types': fileURLToPath(new URL('../types/src/index.ts', import.meta.url)) } },
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  test: {
    include: ['src/test/e2e/ScriptOutputs.e2e.test.ts'], testTimeout: 60000,
    browser: { enabled: true, screenshotFailures: false, headless: true,
      provider: playwright({ launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] } }),
      instances: [{ browser: 'chromium' }] },
  },
});
