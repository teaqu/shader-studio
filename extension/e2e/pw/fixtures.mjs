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
const vscodeBinary = join(
  extensionPath, '.vscode-test', `vscode-darwin-arm64-${VSCODE_VERSION}`,
  'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron',
);

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
  // Worker-scoped: one VS Code window per worker, shared by every test in a
  // file. The specs build up state across tests (debug mode on, lock engaged)
  // exactly as they did under the previous runner, and a fresh window per test
  // would both break that and make the suite far slower.
  vscode: [async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'ss-pw-'));
    const portFile = join(userDataDir, 'bridge-port');

    const app = await electron.launch({
      executablePath: vscodeBinary,
      env: cleanEnv({ SHADER_STUDIO_PW_PORT_FILE: portFile, SHADER_STUDIO_E2E_WORKSPACE: workspacePath }),
      args: [
        '--no-sandbox',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        '--disable-extensions',
        `--extensionDevelopmentPath=${extensionPath}`,
        `--extensionTestsPath=${join(extensionPath, 'e2e', 'pw', 'host-bridge.cjs')}`,
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

    /** Run a function inside the extension host with the real `vscode` module. */
    const evaluateInHost = async (fn, ...args) => {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: fn.toString(), args }),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(`extension host: ${result.error}`);
      return result.value;
    };

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

    await app.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }, { scope: 'worker' }],
});

export { expect };
