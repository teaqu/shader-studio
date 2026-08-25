import { test as base, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultWorkspace = join(extensionPath, 'e2e', 'fixtures', 'slang-parity-validation');

export const workspacePath = resolve(process.env.SHADER_STUDIO_E2E_WORKSPACE ?? defaultWorkspace);

const VSCODE_VERSION = process.env.SHADER_STUDIO_E2E_VSCODE_VERSION ?? '1.109.5';

/**
 * global-setup.mjs downloads the pinned VS Code before any worker starts and
 * publishes the path here. Resolving it per worker instead would have every
 * worker race to populate the same cache directory on a cold checkout.
 */
const vscodeBinary = () => process.env.SHADER_STUDIO_PW_VSCODE_BIN
  ?? join(extensionPath, '.vscode-test', `vscode-darwin-arm64-${VSCODE_VERSION}`,
    'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron');

const USER_SETTINGS = {
  'security.workspace.trust.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'workbench.startupEditor': 'none',
  'window.commandCenter': false,
  'extensions.ignoreRecommendations': true,
  'git.openRepositoryInParentFolders': 'never',
};

/**
 * A VS Code extension host exports ELECTRON_RUN_AS_NODE and a pile of VSCODE_*
 * variables to its children. Inherited, the Electron binary boots as plain Node
 * and never opens a window, so the suite has to launch from a cleaned env.
 */
function cleanEnv(extra) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_')),
  );
  return { ...base, ...extra };
}

async function waitFor(predicate, { timeout = 60_000, interval = 250, message }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(message ?? 'condition never became true');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export const test = base.extend({
  /**
   * Changing a worker-scoped option makes Playwright start a fresh worker, and
   * with it a fresh VS Code. Each spec file sets its own key so files cannot
   * inherit each other's window state - the language-server toggles and debug
   * panel state the specs leave behind are not safe to share.
   */
  vscodeKey: ['default', { scope: 'worker', option: true }],

  // Worker-scoped: one VS Code window per worker, shared by every test in a
  // file. The specs build up state across tests (debug mode on, lock engaged)
  // exactly as they did under the previous runner, and a fresh window per test
  // would both break that and make the suite far slower.
  vscode: [async ({ vscodeKey }, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), `ss-pw-${vscodeKey}-`));
    const portFile = join(userDataDir, 'bridge-port');

    const app = await electron.launch({
      executablePath: vscodeBinary(),
      env: cleanEnv({ SHADER_STUDIO_PW_PORT_FILE: portFile, SHADER_STUDIO_E2E_WORKSPACE: workspacePath }),
      args: [
        '--no-sandbox',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        '--disable-extensions',
        `--extensionDevelopmentPath=${extensionPath}`,
        `--extensionDevelopmentPath=${join(extensionPath, 'e2e', 'pw', 'bridge-extension')}`,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${join(userDataDir, 'extensions')}`,
        '--enable-unsafe-webgpu',
        // rAF does not fire in a hidden document, and Chromium marks occluded
        // windows hidden. Without these, any window covering the test window
        // stalls the webview's capture loop.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        workspacePath,
      ],
      timeout: 120_000,
    });

    const window = await app.firstWindow({ timeout: 60_000 });
    await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });

    const port = Number(await waitFor(
      () => (existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : null),
      { timeout: 60_000, message: 'extension-host bridge never reported a port' },
    ));

    // The extension host restarts during startup, taking the bridge server with
    // it and leaving a stale port behind, so the port is re-read per call.
    const currentPort = () => Number(readFileSync(portFile, 'utf8').trim());

    const callHost = async (fn, ...args) => {
      const response = await fetch(`http://127.0.0.1:${currentPort()}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: fn.toString(), args }),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(`extension host: ${result.error}`);
      return result.value;
    };

    /**
     * Run a function inside the extension host with the real `vscode` module.
     * VS Code cancels API calls while it is still activating, surfacing as
     * "Canceled"; that is a readiness signal rather than a real failure, so
     * retry briefly instead of failing the whole file in beforeAll.
     */
    const evaluateInHost = async (fn, ...args) => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          return await callHost(fn, ...args);
        } catch (error) {
          const detail = String(error?.message ?? error) + String(error?.cause?.code ?? '');
          const transient = /Canceled|ECONNREFUSED|ECONNRESET|fetch failed/i.test(detail);
          if (!transient || Date.now() >= deadline) throw error;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };

    // Do not let the first real call be the one that races activation.
    await evaluateInHost(async (vscode) => vscode.workspace.name ?? null);

    await evaluateInHost(async (vscode, settings) => {
      for (const [key, value] of Object.entries(settings)) {
        const dot = key.lastIndexOf('.');
        await vscode.workspace.getConfiguration(key.slice(0, dot))
          .update(key.slice(dot + 1), value, vscode.ConfigurationTarget.Global);
      }
    }, USER_SETTINGS);

    /** The frame hosting the Shader Studio app, found by content: VS Code's
     *  internal webview frame names differ across versions. */
    const shaderFrame = async (timeout = 90_000) => waitFor(async () => {
      for (const frame of window.frames()) {
        try {
          if (await frame.locator('.canvas-container').count()) return frame;
        } catch { /* frame detached mid-scan */ }
      }
      return null;
    }, { timeout, message: 'no frame hosting the Shader Studio app appeared' });

    await use({ app, window, evaluateInHost, shaderFrame, workspacePath });

    // A wedged extension host can leave close() pending, which surfaces as a
    // worker teardown timeout and hides whatever actually failed.
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]).catch(() => { /* the process is going away regardless */ });
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }, { scope: 'worker' }],
});

export { expect };
