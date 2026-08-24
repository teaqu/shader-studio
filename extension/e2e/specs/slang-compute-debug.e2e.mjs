import assert from 'node:assert/strict';
import { join } from 'node:path';

const workspacePath = process.env.SHADER_STUDIO_E2E_WORKSPACE;
const validationPath = join(workspacePath, 'validation.slang');
const computePath = join(workspacePath, 'passes', 'pattern.compute.slang');

let shaderStudioWebview;

async function activate(selector) {
  await browser.execute((targetSelector) => {
    const element = Array.from(document.querySelectorAll(targetSelector))
      .find((candidate) => candidate.getClientRects().length > 0);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing control: ${targetSelector}`);
    }
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, isPrimary: true }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, isPrimary: true }));
    element.click();
  }, selector);
}

async function ensureActiveControl(selector) {
  const isVisible = () => browser.execute((targetSelector) =>
    Array.from(document.querySelectorAll(targetSelector))
      .some((candidate) => candidate.getClientRects().length > 0),
  selector);
  const isActive = () => browser.execute((targetSelector) =>
    Array.from(document.querySelectorAll(targetSelector))
      .some((candidate) => candidate.classList.contains('active')),
  selector);

  if (!await isVisible()) {
    await activate('[aria-label="Open options menu"]');
    await browser.waitUntil(isVisible, { timeoutMsg: `No visible control matched ${selector}` });
  }
  if (!await isActive()) {
    await activate(selector);
  }
  await browser.waitUntil(isActive, { timeoutMsg: `Control did not become active: ${selector}` });
}

async function waitForText(selector, expected) {
  await browser.waitUntil(async () => {
    const texts = await browser.execute((targetSelector) =>
      Array.from(document.querySelectorAll(targetSelector), (element) => element.textContent?.trim() ?? ''),
    selector);
    return texts.includes(expected);
  }, { timeout: 60_000, timeoutMsg: `Expected ${selector} to contain ${expected}` });
}

async function waitForCapturedText(selector, expected) {
  let captureError = '';
  await browser.waitUntil(async () => {
    const result = await browser.execute((targetSelector, targetText) => ({
      found: Array.from(document.querySelectorAll(targetSelector),
        (element) => element.textContent?.trim() ?? '').includes(targetText),
      error: document.querySelector('.variables-section .error-text')?.textContent?.trim() ?? '',
    }), selector, expected);
    captureError = result.error;
    return result.found || captureError.length > 0;
  }, { timeout: 60_000, timeoutMsg: `Expected captured ${selector} to contain ${expected}` });
  assert.equal(captureError, '', captureError);
}

describe('Slang compute debugging in the VS Code webview', () => {
  before(async () => {
    assert.ok(workspacePath, 'SHADER_STUDIO_E2E_WORKSPACE was not configured');
    await browser.executeWorkbench(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false,
      });
      await vscode.commands.executeCommand('shader-studio.view');
    }, validationPath);

    const workbench = await browser.getWorkbench();
    shaderStudioWebview = await workbench.getWebviewByTitle('Shader Studio');
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand('shader-studio.refreshCurrentShader');
    });
    await browser.pause(1_000);
    await shaderStudioWebview.open();

    const canvas = await $('.canvas-container canvas');
    await canvas.waitForDisplayed({ timeout: 60_000 });
    await browser.waitUntil(async () => Number(await canvas.getAttribute('width')) > 0, {
      timeout: 60_000,
      timeoutMsg: 'Shader canvas never acquired a render size',
    });

    const debugSelector = 'button.collapse-debug[aria-label="Toggle debug mode"]';
    const debugButton = await $(debugSelector);
    await debugButton.waitForExist({ timeout: 60_000 });
    await browser.waitUntil(async () => !(await debugButton.getAttribute('disabled')), {
      timeout: 60_000,
      timeoutMsg: 'Shader Studio did not finish loading the Slang shader',
    });
    if (!(await debugButton.getAttribute('class')).split(/\s+/).includes('active')) {
      await browser.execute((targetSelector) => {
        document.querySelector(targetSelector)?.click();
      }, debugSelector);
    }
    await $('.debug-panel').waitForDisplayed({ timeout: 30_000 });
    await ensureActiveControl('[aria-label="Toggle lock"]');
    await ensureActiveControl('[aria-label="Toggle variable inspector"]');
  });

  after(async () => {
    try {
      await shaderStudioWebview?.close();
    } catch {
      // The renderer may have already closed after the native compute workload.
    }
  });

  it('captures variables from the native compute pass', async () => {
    await shaderStudioWebview?.close();
    await browser.executeWorkbench(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false,
      });
      const position = new vscode.Position(8, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }, computePath);
    await browser.pause(350);
    const workbench = await browser.getWorkbench();
    shaderStudioWebview = await workbench.getWebviewByTitle('Shader Studio');
    await shaderStudioWebview.open();

    await waitForText('.fn-name', 'buildPattern');
    await waitForCapturedText('.var-name', 'wave');
    await waitForCapturedText('.var-name', 'color');
  });
});
