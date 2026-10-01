import { defineConfig } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '..', '..');

export default defineConfig({
  globalSetup: join(here, 'global-setup.mjs'),
  testDir: here,
  testMatch: '**/*.e2e.mjs',
  // The corpus rig needs the corpus root as its workspace; it has its own
  // config (playwright.corpus.config.mjs, `test:e2e:vscode:corpus`).
  testIgnore: '**/corpus-extension-host.e2e.mjs',
  outputDir: join(extensionPath, '.playwright'),
  // Two workers, locally and on CI. On the ci-runner Mac (Sept 2026, pinned
  // VS Code 1.109.5) two workers took the @gpu selection from 245s to 133s and
  // the rest from 168s to 95s. Each extra worker is a full VS Code with its own
  // GPU context, so don't raise this without measuring on the hosted runners.
  //
  // This only works because the launch disables occluded-window backgrounding:
  // parallel windows overlap, and Chromium marks occluded windows hidden, which
  // stops requestAnimationFrame and stalls the webview's capture loop.
  //
  // CI used to run one worker because the dedup spec's browser journey drove
  // 24 textures through a second Chromium on the real adapter, starving the
  // other window's capture loop on the hosted macOS GPU. That journey now uses
  // a small fixture; the 24-input budget stays in its webview journey.
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
