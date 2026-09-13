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
  // Two workers locally, not more: measured 1 -> 23.0s, 2 -> 14.7s, 4 -> 15.6s,
  // so a fourth window buys nothing while each one costs a full VS Code with its
  // own GPU context.
  //
  // This only works because the launch disables occluded-window backgrounding:
  // parallel windows overlap, and Chromium marks occluded windows hidden, which
  // stops requestAnimationFrame and stalls the webview's capture loop.
  //
  // One worker on CI: the dedup spec drives 24 textures through a VS Code window
  // and a second Chromium, and sharing the runner's GPU with another window
  // starves the other spec's capture loop past the 60s expect timeout. The
  // runner has the headroom in wall time but not in GPU.
  workers: process.env.CI ? 1 : 2,
  // Tests within a file share one VS Code and build state across each other, so
  // they must stay serial; separate files parallelise across workers.
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  // The release workflow narrows the suite to a subset; honoured here so that
  // filter keeps working now the runner has changed. The inverse splits the
  // suite by runner: specs tagged @gpu are the ones measured to fail without a
  // real adapter and stay on macOS, everything else runs on Linux.
  ...(process.env.SHADER_STUDIO_E2E_GREP
    ? { grep: new RegExp(process.env.SHADER_STUDIO_E2E_GREP) }
    : {}),
  ...(process.env.SHADER_STUDIO_E2E_GREP_INVERT
    ? { grepInvert: new RegExp(process.env.SHADER_STUDIO_E2E_GREP_INVERT) }
    : {}),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
