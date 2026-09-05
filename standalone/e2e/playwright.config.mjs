import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  projects: [
    { name: 'chromium', testMatch: 'web.e2e.mjs', use: { browserName: 'chromium' } },
    { name: 'firefox-exports', testMatch: 'web.e2e.mjs', use: { browserName: 'firefox' }, grep: /exports a standalone/ },
    // The dev server ships the app unbundled, which breaks language-service
    // paths the built bundle hides.
    { name: 'chromium-dev', testMatch: 'dev-server.e2e.mjs', use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4175' } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
  },
  webServer: [
    {
      command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4174',
      port: 4174,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 4175',
      port: 4175,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
