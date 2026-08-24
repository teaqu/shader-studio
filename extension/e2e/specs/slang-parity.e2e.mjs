import assert from 'node:assert/strict';
import { join } from 'node:path';

const workspacePath = process.env.SHADER_STUDIO_E2E_WORKSPACE;
const validationPath = join(workspacePath, 'validation.slang');
const computePath = join(workspacePath, 'passes', 'pattern.compute.slang');

let shaderStudioWebview;

async function showFileAtLine(filePath, zeroBasedLine) {
  await shaderStudioWebview?.close();
  await browser.executeWorkbench(async (vscode, targetPath, line) => {
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
  await browser.pause(350);
  const workbench = await browser.getWorkbench();
  shaderStudioWebview = await workbench.getWebviewByTitle('Shader Studio');
  await shaderStudioWebview.open();
}

async function waitForText(selector, expected, timeout = 30_000) {
  await browser.waitUntil(async () => {
    const texts = await browser.execute((targetSelector) =>
      Array.from(document.querySelectorAll(targetSelector), (element) => element.textContent?.trim() ?? ''),
    selector);
    return texts.includes(expected);
  }, { timeout, timeoutMsg: `Expected ${selector} to contain ${expected}` });
}

async function waitForCapturedText(selector, expected, timeout = 30_000) {
  let captureError = '';
  await browser.waitUntil(async () => {
    const result = await browser.execute((targetSelector, targetText) => {
      const texts = Array.from(document.querySelectorAll(targetSelector), (element) => element.textContent?.trim() ?? '');
      const error = document.querySelector('.variables-section .error-text')?.textContent?.trim() ?? '';
      return { found: texts.includes(targetText), error };
    }, selector, expected);
    captureError = result.error;
    return result.found || captureError.length > 0;
  }, { timeout, timeoutMsg: `Expected captured ${selector} to contain ${expected}` });
  assert.equal(captureError, '', captureError);
}

async function waitForNoCaptureError() {
  await browser.waitUntil(async () => {
    const errors = await browser.execute(() =>
      Array.from(document.querySelectorAll('.variables-section .error-text'), (element) => element.textContent?.trim() ?? ''),
    );
    return errors.length === 0;
  }, { timeout: 30_000, timeoutMsg: 'Variable capture reported an error' });
}

async function setExpression(name, value) {
  const selector = `[aria-label="Expression for ${name}"]`;
  const editor = await $(selector);
  await editor.waitForDisplayed();
  await browser.execute((targetSelector, nextValue) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing expression editor: ${targetSelector}`);
    }
    element.focus();
    element.textContent = nextValue;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
    element.blur();
  }, selector, value);
}

async function expressionText(name) {
  return browser.execute((targetName) =>
    document.querySelector(`[aria-label="Expression for ${targetName}"]`)?.textContent?.trim() ?? '',
  name);
}

async function isActive(selector) {
  return browser.execute((targetSelector) =>
    Array.from(document.querySelectorAll(targetSelector))
      .some((candidate) => candidate.classList.contains('active')),
  selector);
}

async function hasVisibleControl(selector) {
  return browser.execute((targetSelector) =>
    Array.from(document.querySelectorAll(targetSelector))
      .some((candidate) => candidate.getClientRects().length > 0),
  selector);
}

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

async function ensureButtonState(selector, active) {
  if (!await hasVisibleControl(selector)) {
    await activate('[aria-label="Open options menu"]');
  }
  try {
    await browser.waitUntil(() => hasVisibleControl(selector), {
      timeoutMsg: `No visible control matched ${selector}`,
    });
  } catch (error) {
    const diagnostics = await browser.execute((targetSelector) => ({
      viewportWidth: window.innerWidth,
      menuBarWidth: document.querySelector('.menu-bar')?.getBoundingClientRect().width ?? null,
      controls: Array.from(document.querySelectorAll(targetSelector)).map((candidate) => ({
        className: candidate.className,
        display: getComputedStyle(candidate).display,
        visibility: getComputedStyle(candidate).visibility,
        width: candidate.getBoundingClientRect().width,
      })),
      optionsText: document.querySelector('.options-menu-portal')?.textContent?.trim() ?? null,
    }), selector);
    throw new Error(`${error.message}\nControl diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
  }
  if (await isActive(selector) !== active) {
    await activate(selector);
  }
  await browser.waitUntil(async () => await isActive(selector) === active);
}

describe('Slang parity in the VS Code webview', () => {
  before(async () => {
    assert.ok(workspacePath, 'SHADER_STUDIO_E2E_WORKSPACE was not configured');
    await browser.executeWorkbench(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false,
      });
      const position = new vscode.Position(6, 0);
      editor.selection = new vscode.Selection(position, position);
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

    const debugButton = await $('button.collapse-debug[aria-label="Toggle debug mode"]');
    await debugButton.waitForExist({ timeout: 60_000 });
    await browser.waitUntil(async () => !(await debugButton.getAttribute('disabled')), {
      timeout: 60_000,
      timeoutMsg: 'Shader Studio did not finish loading the Slang shader',
    });
    if (!(await debugButton.getAttribute('class')).split(/\s+/).includes('active')) {
      await browser.execute(() => {
        document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]')?.click();
      });
    }
    await $('.debug-panel').waitForDisplayed({ timeout: 30_000 });
    await ensureButtonState('[aria-label="Toggle lock"]', true);
  });

  after(async () => {
    try {
      await shaderStudioWebview?.close();
    } catch {
      // A shader refresh may replace the iframe before the final cleanup.
    }
  });

  it('keeps explicit parameter overrides and resets to deterministic defaults', async () => {
    await showFileAtLine(validationPath, 6);
    await waitForText('.fn-name', 'debugHelper');
    assert.equal(await expressionText('gain'), '0.5');
    assert.equal(await expressionText('bias'), '0.5');

    await setExpression('gain', '0.00');
    await setExpression('bias', '0.0');
    await browser.pause(500);
    assert.equal(await expressionText('gain'), '0.00');
    assert.equal(await expressionText('bias'), '0.0');

    await activate('[aria-label="Reset parameters"]');
    await browser.waitUntil(async () =>
      await expressionText('gain') === '0.5' && await expressionText('bias') === '0.5'
    );
  });

  it('honours inline rendering, normalize, and step controls', async () => {
    await ensureButtonState('[aria-label="Toggle inline rendering"]', true);
    await activate('[aria-label="Toggle inline rendering"]');
    await browser.waitUntil(async () => !await isActive('[aria-label="Toggle inline rendering"]'));

    await $('[aria-label="Cycle normalize mode"]').waitForDisplayed();
    await activate('[aria-label="Cycle normalize mode"]');
    await browser.waitUntil(async () => await isActive('[aria-label="Cycle normalize mode"]'));

    await ensureButtonState('[aria-label="Toggle step threshold"]', true);
    await $('[aria-label="Step edge threshold"]').waitForDisplayed();
    await waitForNoCaptureError();

    await activate('[aria-label="Toggle step threshold"]');
    await activate('[aria-label="Cycle normalize mode"]');
    await activate('[aria-label="Cycle normalize mode"]');
    await activate('[aria-label="Toggle inline rendering"]');
    await browser.waitUntil(async () => await isActive('[aria-label="Toggle inline rendering"]'));
  });

  it('captures both declarations from one Slang statement', async () => {
    await ensureButtonState('[aria-label="Toggle variable inspector"]', true);
    await showFileAtLine(validationPath, 13);
    await waitForCapturedText('.var-name', 'pulse', 60_000);
    await waitForCapturedText('.var-name', 'grid', 60_000);
    await waitForNoCaptureError();
  });

  it('captures variables from the native compute pass', async () => {
    await ensureButtonState('[aria-label="Toggle variable inspector"]', true);
    await showFileAtLine(computePath, 8);
    await waitForText('.fn-name', 'buildPattern', 60_000);
    await waitForCapturedText('.var-name', 'wave', 60_000);
    await waitForCapturedText('.var-name', 'color', 60_000);
    await waitForNoCaptureError();
  });

});
