import { defineConfig } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '..', '..');

// Corpus-only run of the extension-host rig. Kept separate from
// playwright.config.mjs so the default suite (whose workspace is the
// scratch fixtures directory) never picks this file up: `@/` source paths
// resolve against the workspace folder, so this rig only works with the
// corpus root as its workspace (see the `test:e2e:vscode:corpus` script).
export default defineConfig({
  globalSetup: join(here, 'global-setup.mjs'),
  testDir: here,
  testMatch: '**/corpus-extension-host.e2e.mjs',
  outputDir: join(extensionPath, '.playwright'),
  // The rig opens 27 projects serially in one window; files never parallelise
  // with anything here, but hold the worker count at one on CI anyway — a
  // second VS Code window would share the runner's GPU.
  workers: process.env.CI ? 1 : 2,
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
