import { defineConfig } from '@playwright/test';
import { standaloneE2eEndpoints } from './ports.mjs';

const { productionPort, developmentPort, productionOrigin, developmentOrigin } = standaloneE2eEndpoints();

export default defineConfig({
  testDir: '.',
  projects: [
    // Headless Chromium otherwise exposes navigator.gpu but returns no adapter.
    { name: 'chromium', testMatch: ['web.e2e.mjs', 'compile-errors.e2e.mjs', 'source-navigation.e2e.mjs', 'wgsl-storage.e2e.mjs', 'wgsl-module-globals-inspector.e2e.mjs', 'wgsl-vertex-editor.e2e.mjs', 'symbol-rename.e2e.mjs', 'workspace-references.e2e.mjs', 'wgsl-language-service.e2e.mjs', 'canvas-focus.e2e.mjs', 'named-channels.e2e.mjs', 'wgsl-authoring-parity.e2e.mjs', 'wgsl-native-entrypoints.e2e.mjs', 'swizzle-completion.e2e.mjs', 'reset.e2e.mjs', 'buffer-output-format.e2e.mjs', 'wgsl-compute-sample.e2e.mjs', 'pass-file-editor.e2e.mjs', 'mouse-input.e2e.mjs', 'camera-shader-switch.e2e.mjs'], use: { browserName: 'chromium', launchOptions: { args: ['--enable-unsafe-webgpu'] } } },
    { name: 'firefox-exports', testMatch: 'web.e2e.mjs', use: { browserName: 'firefox' }, grep: /exports a standalone/ },
    // The dev server ships the app unbundled, which breaks language-service
    // paths the built bundle hides.
    { name: 'chromium-dev', testMatch: 'dev-server.e2e.mjs', use: { browserName: 'chromium', baseURL: developmentOrigin } },
  ],
  use: {
    baseURL: productionOrigin,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${productionPort}`,
      port: productionPort,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${developmentPort}`,
      port: developmentPort,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
