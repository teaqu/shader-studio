import { test as base, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const platformBinary = () => {
  const cache = join(extensionPath, '.vscode-test');
  if (process.platform === 'darwin') {
    const arch = process.arch === 'x64' ? 'x64' : 'arm64';
    return join(cache, `vscode-darwin-${arch}-${VSCODE_VERSION}`,
      'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron');
  }
  if (process.platform === 'win32') {
    return join(cache, `vscode-win32-x64-archive-${VSCODE_VERSION}`, 'Code.exe');
  }
  return join(cache, `vscode-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}-${VSCODE_VERSION}`, 'code');
};

const vscodeBinary = () => process.env.SHADER_STUDIO_PW_VSCODE_BIN ?? platformBinary();

/**
 * Set SHADER_STUDIO_E2E_VSIX to drive the packaged artifact instead of the
 * source tree. The development host resolves everything through the repo's
 * node_modules, so it cannot see what `--no-dependencies` leaves out - which is
 * how 1.1.0 shipped a script bundler that could not load its own engine.
 */
const packagedVsix = process.env.SHADER_STUDIO_E2E_VSIX
  ? resolve(process.env.SHADER_STUDIO_E2E_VSIX)
  : null;

/** Unpacks the VSIX into an extensions directory VS Code will load it from. */
function installPackagedExtension(extensionsDir) {
  const manifest = JSON.parse(readFileSync(join(extensionPath, 'package.json'), 'utf8'));
  const target = join(extensionsDir, `${manifest.publisher}.${manifest.name}-${manifest.version}`);
  const staging = mkdtempSync(join(tmpdir(), 'ss-vsix-install-'));
  try {
    execFileSync('unzip', ['-q', '-o', packagedVsix, '-d', staging], { stdio: 'inherit' });
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    // The VSIX keeps the extension under `extension/`; VS Code expects its
    // contents at the root of the installed folder.
    execFileSync('cp', ['-R', join(staging, 'extension'), target], { stdio: 'inherit' });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return target;
}

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
    if (value) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(message ?? 'condition never became true');
    }
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

    // Seed the profile before launch. Applying these through the configuration
    // API afterwards makes VS Code prompt that a setting changed and needs a
    // restart - security.workspace.trust.enabled is restart-required - on every
    // single run.
    mkdirSync(join(userDataDir, 'User'), { recursive: true });
    writeFileSync(join(userDataDir, 'User', 'settings.json'), JSON.stringify(USER_SETTINGS, null, 2), 'utf8');

    const extensionsDir = join(userDataDir, 'extensions');
    if (packagedVsix) {
      installPackagedExtension(extensionsDir);
    }

    const app = await electron.launch({
      executablePath: vscodeBinary(),
      env: cleanEnv({ SHADER_STUDIO_PW_PORT_FILE: portFile, SHADER_STUDIO_E2E_WORKSPACE: workspacePath }),
      args: [
        '--no-sandbox',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        // Against a packaged build the installed extension IS the subject, so
        // it must not be disabled and must not be loaded from source as well.
        ...(packagedVsix ? [] : ['--disable-extensions', `--extensionDevelopmentPath=${extensionPath}`]),
        `--extensionDevelopmentPath=${join(extensionPath, 'e2e', 'pw', 'bridge-extension')}`,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--enable-unsafe-webgpu',
        // Reproduces a runner with no GPU (the Linux CI machines) so a spec can
        // be checked against software rendering before it is trusted there.
        ...(process.env.SHADER_STUDIO_E2E_SOFTWARE_GL
          ? ['--disable-gpu', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
          : []),
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
      if (!result.ok) {
        throw new Error(`extension host: ${result.error}`);
      }
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
          if (!transient || Date.now() >= deadline) {
            throw error;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };

    // Do not let the first real call be the one that races activation.
    await evaluateInHost(async (vscode) => vscode.workspace.name ?? null);

    /** The frame hosting the Shader Studio app, found by content: VS Code's
     *  internal webview frame names differ across versions. */
    const shaderFrame = async (timeout = 90_000) => waitFor(async () => {
      for (const frame of window.frames()) {
        try {
          if (await frame.locator('.canvas-container').count()) {
            return frame;
          }
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
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }, { scope: 'worker' }],
});

export { expect };
