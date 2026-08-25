import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const validationPath = join(workspacePath, 'validation.slang');
const computePath = join(workspacePath, 'passes', 'pattern.compute.slang');
const commonPath = join(workspacePath, 'common.slang');

function helpers(vscode) {
  let frame;

  const app = () => frame;

  async function refreshFrame() {
    frame = await vscode.shaderFrame();
    return frame;
  }

  async function showFileAtLine(filePath, zeroBasedLine) {
    await vscode.evaluateInHost(async (vscode, targetPath, line) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false,
      });
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }, filePath, zeroBasedLine);
    // The webview is torn down and rebuilt on a file switch; the original suite
    // settled here too before reattaching.
    await new Promise((resolve) => setTimeout(resolve, 350));
    await refreshFrame();
  }

  const texts = (selector) => app().evaluate(
    (sel) => Array.from(document.querySelectorAll(sel), (el) => el.textContent?.trim() ?? ''),
    selector,
  );

  async function waitForText(selector, expected) {
    await expect.poll(() => texts(selector), {
      message: `expected ${selector} to contain ${expected}`,
    }).toContain(expected);
  }

  const captureError = () => app().evaluate(
    () => document.querySelector('.variables-section .error-text')?.textContent?.trim() ?? '',
  );

  async function waitForCapturedText(selector, expected) {
    await expect.poll(async () => {
      const [found, error] = await Promise.all([texts(selector), captureError()]);
      return found.includes(expected) || error.length > 0;
    }, { message: `expected captured ${selector} to contain ${expected}` }).toBe(true);
    expect(await captureError(), 'variable capture reported an error').toBe('');
  }

  async function waitForNoCaptureError() {
    await expect.poll(() => app().evaluate(
      () => document.querySelectorAll('.variables-section .error-text').length,
    ), { message: 'variable capture reported an error' }).toBe(0);
  }

  const isActive = (selector) => app().evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).some((el) => el.classList.contains('active')),
    selector,
  );

  const hasVisibleControl = (selector) => app().evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).some((el) => el.getClientRects().length > 0),
    selector,
  );

  const activate = (selector) => app().evaluate((sel) => {
    const element = Array.from(document.querySelectorAll(sel))
      .find((candidate) => candidate.getClientRects().length > 0);
    if (!(element instanceof HTMLElement)) throw new Error(`missing control: ${sel}`);
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, isPrimary: true }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, isPrimary: true }));
    element.click();
  }, selector);

  async function ensureButtonState(selector, active) {
    if (!await hasVisibleControl(selector)) {
      await activate('[aria-label="Open options menu"]');
    }
    await expect.poll(() => hasVisibleControl(selector), {
      message: `no visible control matched ${selector}`,
    }).toBe(true);
    if (await isActive(selector) !== active) await activate(selector);
    await expect.poll(() => isActive(selector)).toBe(active);
  }

  async function setExpression(name, value) {
    const selector = `[aria-label="Expression for ${name}"]`;
    await expect.poll(() => hasVisibleControl(selector)).toBe(true);
    await app().evaluate(({ sel, next }) => {
      const element = document.querySelector(sel);
      if (!(element instanceof HTMLElement)) throw new Error(`missing expression editor: ${sel}`);
      element.focus();
      element.textContent = next;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
      element.blur();
    }, { sel: selector, next: value });
  }

  const expressionText = (name) => app().evaluate(
    (n) => document.querySelector(`[aria-label="Expression for ${n}"]`)?.textContent?.trim() ?? '',
    name,
  );

  return {
    app, refreshFrame, showFileAtLine, waitForText, waitForCapturedText, waitForNoCaptureError,
    isActive, hasVisibleControl, activate, ensureButtonState, setExpression, expressionText,
  };
}

test.describe('Slang parity in the VS Code webview', () => {
  /** @type {ReturnType<typeof helpers>} */
  let h;

  test.beforeAll(async ({ vscode }) => {
    h = helpers(vscode);

    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      // Start away from the first assertion's target so selecting that line
      // always emits a cursor change, even on a fresh VS Code profile.
      const position = new vscode.Position(0, 0);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('shader-studio.view');
    }, validationPath);

    await h.refreshFrame();
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.commands.executeCommand('shader-studio.refreshCurrentShader');
    });
    await h.refreshFrame();

    await expect.poll(() => h.app().evaluate(
      () => document.querySelector('.canvas-container canvas')?.width ?? 0,
    ), { message: 'shader canvas never acquired a render size', timeout: 90_000 })
      .toBeGreaterThan(0);

    await expect.poll(() => h.app().evaluate(
      () => !document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]')?.disabled,
    ), { message: 'Shader Studio did not finish loading the Slang shader', timeout: 90_000 })
      .toBe(true);

    const debugActive = await h.app().evaluate(
      () => document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]')
        ?.classList.contains('active') ?? false,
    );
    if (!debugActive) {
      await h.app().evaluate(() => {
        document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]')?.click();
      });
    }
    await expect.poll(() => h.hasVisibleControl('.debug-panel')).toBe(true);
    await h.ensureButtonState('[aria-label="Toggle lock"]', true);
  });

  test('keeps explicit parameter overrides and resets to deterministic defaults', async () => {
    await h.showFileAtLine(validationPath, 6);
    await h.waitForText('.fn-name', 'debugHelper');
    expect(await h.expressionText('gain')).toBe('0.5');
    expect(await h.expressionText('bias')).toBe('0.5');

    await h.setExpression('gain', '0.00');
    await h.setExpression('bias', '0.0');
    await expect.poll(() => h.expressionText('gain')).toBe('0.00');
    await expect.poll(() => h.expressionText('bias')).toBe('0.0');

    await h.activate('[aria-label="Reset parameters"]');
    await expect.poll(async () => [await h.expressionText('gain'), await h.expressionText('bias')])
      .toEqual(['0.5', '0.5']);
  });

  test('honours inline rendering, normalize, and step controls', async () => {
    await h.ensureButtonState('[aria-label="Toggle inline rendering"]', true);
    await h.activate('[aria-label="Toggle inline rendering"]');
    await expect.poll(() => h.isActive('[aria-label="Toggle inline rendering"]')).toBe(false);

    await expect.poll(() => h.hasVisibleControl('[aria-label="Cycle normalize mode"]')).toBe(true);
    await h.activate('[aria-label="Cycle normalize mode"]');
    await expect.poll(() => h.isActive('[aria-label="Cycle normalize mode"]')).toBe(true);

    await h.ensureButtonState('[aria-label="Toggle step threshold"]', true);
    await expect.poll(() => h.hasVisibleControl('[aria-label="Step edge threshold"]')).toBe(true);
    await h.waitForNoCaptureError();

    await h.activate('[aria-label="Toggle step threshold"]');
    await h.activate('[aria-label="Cycle normalize mode"]');
    await h.activate('[aria-label="Cycle normalize mode"]');
    await h.activate('[aria-label="Toggle inline rendering"]');
    await expect.poll(() => h.isActive('[aria-label="Toggle inline rendering"]')).toBe(true);
  });

  test('captures both declarations from one Slang statement', async () => {
    await h.ensureButtonState('[aria-label="Toggle variable inspector"]', true);
    await h.showFileAtLine(validationPath, 13);
    await h.waitForCapturedText('.var-name', 'pulse');
    await h.waitForCapturedText('.var-name', 'grid');
    await h.waitForNoCaptureError();
  });

  test('debugs native compute and linked common-module functions in the same VS Code window', async () => {
    await h.ensureButtonState('[aria-label="Toggle variable inspector"]', true);
    await h.showFileAtLine(computePath, 8);
    await h.waitForText('.fn-name', 'buildPattern');
    await h.waitForCapturedText('.var-name', 'wave');
    await h.waitForCapturedText('.var-name', 'color');
    await h.waitForNoCaptureError();

    await h.showFileAtLine(commonPath, 15);
    await h.waitForText('.fn-name', 'parityGrid');
    await h.waitForCapturedText('.var-name', 'cell');

    await h.showFileAtLine(commonPath, 20);
    await h.waitForText('.fn-name', 'parityPalette');
    await h.waitForText('.param-name', 'value');
    await h.waitForCapturedText('.var-name', 'value');
    await h.waitForNoCaptureError();
  });
});
