import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'web.e2e.mjs',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox-exports', use: { browserName: 'firefox' }, grep: /exports a standalone/ },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4174',
    port: 4174,
    reuseExistingServer: !process.env.CI,
  },
});
