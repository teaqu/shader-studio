import { defineConfig } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '..', '..');

export default defineConfig({
  globalSetup: join(here, 'global-setup.mjs'),
  testDir: here,
  testMatch: '**/*.e2e.mjs',
  outputDir: join(extensionPath, '.playwright'),
  // Two workers, not more: there are only four spec files, and measured locally
  // 1 -> 23.0s, 2 -> 14.7s, 4 -> 15.6s, so the fourth window buys nothing while
  // each one costs a full VS Code with its own GPU context. CI runners have
  // fewer cores than a dev machine, which is the other reason not to push it.
  //
  // This only works because the launch disables occluded-window backgrounding:
  // parallel windows overlap, and Chromium marks occluded windows hidden, which
  // stops requestAnimationFrame and stalls the webview's capture loop.
  workers: 2,
  // Tests within a file share one VS Code and build state across each other, so
  // they must stay serial; separate files parallelise across workers.
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  // The release workflow narrows the suite to a subset; honoured here so that
  // filter keeps working now the runner has changed.
  ...(process.env.SHADER_STUDIO_E2E_GREP
    ? { grep: new RegExp(process.env.SHADER_STUDIO_E2E_GREP) }
    : {}),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
