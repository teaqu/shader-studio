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
  // VS Code windows are heavyweight and the suite drives a real GPU; running
  // them concurrently starves the renderer and produces timing failures that
  // have nothing to do with the code under test.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
