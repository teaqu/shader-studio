import { test, expect, workspacePath, vscodeBinary, cleanEnv } from './fixtures.mjs';
import { _electron as electron } from 'playwright';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { openConfigPanel } from './config-panel.mjs';
import { openEditorOverlay } from './editor-overlay.mjs';
import { hasXvfb, openWindowDisplay } from './private-display.mjs';

// Workers run in parallel, one VS Code window each. On a shared X display a
// window that starts up takes input focus from the others, and the preview
// webview - an out-of-process frame Playwright does not emulate focus for -
// blurs: open menus close and Monaco cancels its suggest widget mid-test. Here
// a second VS Code, launched on the display a worker would get, stands in for
// the other worker. SHADER_STUDIO_E2E_SHARED_DISPLAY=1 reproduces the failure.
const fixtureDir = join(workspacePath, `webview-window-focus-${process.env.TEST_WORKER_INDEX ?? process.pid}`);
const shaderPath = join(fixtureDir, 'focus.glsl');
const configPath = join(fixtureDir, 'focus.sha.json');

test.use({ vscodeKey: 'webview-window-focus' });

async function startOtherWorkerWindow() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ss-pw-other-worker-'));
  const display = await openWindowDisplay();
  try {
    const app = await electron.launch({
      executablePath: vscodeBinary(),
      env: cleanEnv(display.env),
      args: [
        '--no-sandbox',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        '--disable-extensions',
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${join(userDataDir, 'extensions')}`,
      ],
      timeout: 120_000,
    });
    const window = await app.firstWindow({ timeout: 60_000 });
    await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });
    // A window that activates after startup does the same as one starting up.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await window.waitForTimeout(1_000);
    return async () => {
      await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 15_000))]).catch(() => {});
      await display.close();
      rmSync(userDataDir, { recursive: true, force: true });
    };
  } catch (error) {
    await display.close();
    rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

test.describe('the preview webview while another worker opens a window', () => {
  // Only Linux workers get displays of their own; elsewhere windows share one.
  test.skip(process.platform !== 'linux' || !hasXvfb(), 'workers share one display on this platform');

  test.beforeAll(async ({ vscode }) => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(shaderPath, 'void mainImage(out vec4 color, in vec2 coord) {\n  color = vec4(1.0);\n}\n');
    writeFileSync(configPath, JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } }, null, 2));
    await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);
  });

  test.afterAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }).catch(() => { /* the host may already be going away */ });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test('keeps the config panel add menu open', async ({ vscode }) => {
    const frame = await vscode.shaderFrame();
    await openConfigPanel(frame);
    await expect(frame.locator('.config-panel')).toBeVisible();
    await frame.getByRole('button', { name: '+ New' }).click();
    const script = frame.getByRole('menuitem', { name: 'Script' });
    await expect(script).toBeVisible();

    const closeOther = await startOtherWorkerWindow();
    try {
      await expect(script).toBeVisible({ timeout: 5_000 });
      await script.click();
      await expect(frame.locator('.script-tab-content')).toBeVisible();
    } finally {
      await closeOther();
    }
    await openConfigPanel(frame);
    await expect(frame.locator('.config-panel')).toBeHidden();
  });

  test('keeps the overlay suggest widget open', async ({ vscode }) => {
    const frame = await openEditorOverlay(vscode);
    await frame.locator('.editor-overlay .view-line').filter({ hasText: 'color = vec4(1.0);' }).click();
    const input = frame.locator('.editor-overlay textarea.inputarea').first();
    await input.press('End');
    await input.press('Enter');
    await input.pressSequentially('iResol', { delay: 50 });
    // A Shader Studio built-in absent from this shader's text, so only the
    // language service can offer it.
    const suggestion = frame.locator('.editor-overlay .suggest-widget .monaco-list-row')
      .filter({ hasText: /^iResolution/ })
      .first();
    await expect(suggestion).toBeVisible();

    const closeOther = await startOtherWorkerWindow();
    try {
      await expect(suggestion).toBeVisible({ timeout: 5_000 });
    } finally {
      await closeOther();
    }
    await input.press('Escape');
  });
});
