import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const fixtureDir = join(workspacePath, 'wgsl-debug-parity');
const imagePath = join(fixtureDir, 'image.wgsl');
const commonPath = join(fixtureDir, 'common.wgsl');
const loopParametersPath = join(fixtureDir, 'loop-parameters.wgsl');
const computeImagePath = join(fixtureDir, 'compute-image.wgsl');
const computeUpdatePath = join(fixtureDir, 'compute-update.wgsl');
const matrixPath = join(fixtureDir, 'matrix.wgsl');
const matrixCommonPath = join(fixtureDir, 'matrix-common.wgsl');

test.use({ vscodeKey: 'wgsl-debug-parity' });

async function showFileAtLine(vscode, targetPath, line) {
  await vscode.evaluateInHost(async (vscode, path, lineNumber) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
    });
    const position = new vscode.Position(lineNumber, 4);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }, targetPath, line);
}

async function ensureShaderView(vscode) {
  const hasPreview = await Promise.all(vscode.window.frames().map(async frame => (
    (await frame.locator('.canvas-container').count().catch(() => 0)) > 0
  ))).then(results => results.some(Boolean));
  if (!hasPreview) {
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
  }
}

async function enableVariableInspector(frame) {
  await expect.poll(() => frame.evaluate(() => !document.querySelector(
    'button.collapse-debug[aria-label="Toggle debug mode"]')?.disabled,
  ), { message: 'WGSL shader never finished loading', timeout: 90_000 }).toBe(true);

  await frame.evaluate(() => {
    const button = document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]');
    if (button instanceof HTMLElement && !button.classList.contains('active')) {
      button.click();
    }
  });
  await expect(frame.locator('.debug-panel')).toBeVisible();
  if (await frame.locator('.variables-section').count() === 0) {
    await frame.getByLabel('Toggle variable inspector').click();
  }
  await expect(frame.locator('.variables-section')).toBeVisible();
}

async function setPreviewLocked(frame, locked) {
  const toolbarButton = frame.locator('button.collapse-lock');
  if (await toolbarButton.evaluate(element => element.classList.contains('active')) === locked) {
    return;
  }
  if (await toolbarButton.isVisible()) {
    await toolbarButton.click();
  } else {
    await frame.getByLabel('Open options menu', { exact: true }).click();
    await frame.locator('.options-menu-item[aria-label="Toggle lock"]').click();
  }
}

async function setInlineRendering(frame, enabled) {
  const button = frame.getByLabel('Toggle inline rendering', { exact: true });
  if (await button.evaluate(element => element.classList.contains('active')) !== enabled) {
    await button.click();
  }
}

async function setParameterExpression(frame, name, value) {
  const selector = `[aria-label="Expression for ${name}"]`;
  await expect(frame.locator(selector)).toBeVisible();
  await frame.evaluate(({ selector, value }) => {
    const editor = document.querySelector(selector);
    if (!(editor instanceof HTMLElement)) {
      throw new Error(`missing expression editor: ${selector}`);
    }
    editor.focus();
    editor.textContent = value;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
    editor.blur();
  }, { selector, value });
}

function variableRow(frame, name) {
  return frame.locator('.var-row').filter({
    has: frame.locator('.var-name', { hasText: new RegExp(`^${name}$`) }),
  });
}

async function expectCanvasColor(frame, predicate, message) {
  const canvas = frame.locator('.canvas-container canvas').first();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => {
    const screenshot = await canvas.screenshot();
    const rgb = await frame.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const probe = document.createElement('canvas');
      probe.width = bitmap.width;
      probe.height = bitmap.height;
      const context = probe.getContext('2d');
      context?.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context
        ? [...context.getImageData(Math.floor(probe.width / 2), Math.floor(probe.height / 2), 1, 1).data].slice(0, 3)
        : [];
    }, screenshot.toString('base64'));
    return predicate(rgb);
  }, { message }).toBe(true);
}

async function expectComputeOutput(frame) {
  await expectCanvasColor(
    frame,
    rgb => rgb.length === 3 && rgb[0] >= 150 && rgb[0] <= 170 && rgb[1] <= 5 && rgb[2] <= 5,
    'Compute-linked image never displayed its deterministic red output',
  );
}

async function expectWaveLinePreview(frame) {
  await expectCanvasColor(
    frame,
    rgb => rgb.length === 3 && rgb.every(channel => channel >= 150 && channel <= 170),
    'the selected compute wave never displayed its scalar line preview',
  );
}

test.describe('WGSL debug parity in the VS Code webview', () => {
  test('captures a visible value from a configured Common pass', async ({ vscode }) => {
    await showFileAtLine(vscode, imagePath, 1);
    await ensureShaderView(vscode);
    let frame = await vscode.shaderFrame();
    await expect(frame.locator('.canvas-container canvas').first()).toBeVisible();
    await enableVariableInspector(frame);
    // Keep Image as the owning shader while following the cursor into Common.
    await setPreviewLocked(frame, true);


    // Keep a root-file inferred-local check in this host flow: Task 9 must not
    // regress the already supported single-file path while adding composition.
    await showFileAtLine(vscode, imagePath, 1);
    frame = await vscode.shaderFrame();
    await expect(frame.locator('.var-row').filter({
      has: frame.locator('.var-name', { hasText: /^tint$/ }),
    })).toBeVisible({ timeout: 45_000 });

    // The production compiler prepends Common to Image. Selecting this local
    // must plan and compile against that composed program while preserving the
    // Common source location for capture ownership.
    await showFileAtLine(vscode, commonPath, 1);
    // Switching editor documents recreates the webview in this host, so use
    // the newly attached frame for the cursor-driven assertions.
    frame = await vscode.shaderFrame();
    await expect.poll(
      () => frame.evaluate(() => document.querySelector('.header-info')?.textContent?.trim() ?? ''),
      { message: 'debug panel never followed the Common-pass cursor', timeout: 30_000 },
    ).toContain('L2');
    await expect(frame.locator('.fn-name', { hasText: 'commonTint' })).toBeVisible();

    const shade = frame.locator('.var-row').filter({
      has: frame.locator('.var-name', { hasText: /^shade$/ }),
    });
    await expect(shade).toBeVisible({ timeout: 45_000 });
    await expect(shade.locator('.var-value')).toHaveText('0.375');
    await expect(frame.locator('[aria-label="Show capture errors"]')).toHaveCount(0);
  });

  test('applies parameter overrides and loop caps while debugging a WGSL helper', async ({ vscode }) => {
    for (const existingFrame of vscode.window.frames()) {
      if (await existingFrame.locator('.canvas-container').count()) {
        await setPreviewLocked(existingFrame, false);
      }
    }
    await showFileAtLine(vscode, loopParametersPath, 4);
    await ensureShaderView(vscode);
    let frame = await vscode.shaderFrame();
    await expect(frame.locator('.canvas-container canvas').first()).toBeVisible();
    await enableVariableInspector(frame);

    // Select the helper's loop, then relock so both controls re-plan that
    // selected scope instead of following later editor movement.
    await showFileAtLine(vscode, loopParametersPath, 4);
    frame = await vscode.shaderFrame();
    await expect.poll(
      () => frame.locator('.fn-name').allTextContents(),
      { message: 'debug panel never followed the accumulator loop' },
    ).toContain('debugAccumulator');
    await setPreviewLocked(frame, true);

    const accumulator = variableRow(frame, 'accumulator');
    await expect(accumulator).toBeVisible();
    await expect(frame.locator('[aria-label="Expression for gain"]')).toHaveText('0.5');
    await expect.poll(async () => (await accumulator.locator('.var-value').innerText()).trim(), {
      message: 'default helper capture never settled',
    }).toBe('6.000');

    await setParameterExpression(frame, 'gain', '0.75');
    await expect.poll(
      () => frame.locator('[aria-label="Expression for gain"]').textContent(),
    ).toContain('0.75');
    await expect.poll(async () => (await accumulator.locator('.var-value').innerText()).trim(), {
      message: 'parameter override did not change the captured accumulator',
    }).toBe('9.000');

    const loopCap = frame.getByLabel('Max iterations for loop at line 4', { exact: true });
    await expect(loopCap).toBeVisible();
    await loopCap.fill('1');
    await expect.poll(async () => (await accumulator.locator('.var-value').innerText()).trim(), {
      message: 'loop cap did not change the captured accumulator',
    }).toBe('2.250');
    await expect(frame.locator('[aria-label="Show capture errors"]')).toHaveCount(0);
  });

  test('captures a WGSL compute-pass local through an Image-linked output', async ({ vscode }) => {
    // The preceding loop-controls test leaves the shared webview locked.
    // Compute must follow the editor cursor to form a compute replay plan.
    for (const existingFrame of vscode.window.frames()) {
      if (await existingFrame.locator('.canvas-container').count()) {
        await setPreviewLocked(existingFrame, false);
      }
    }
    await showFileAtLine(vscode, computeImagePath, 1);
    await ensureShaderView(vscode);
    let frame = await vscode.shaderFrame();
    await expectComputeOutput(frame);
    await enableVariableInspector(frame);

    // Image owns the preview and samples Compute's output. Lock before opening
    // the compute file so the capture plan keeps the real configured pass graph.
    await setPreviewLocked(frame, true);
    await showFileAtLine(vscode, computeUpdatePath, 2);
    frame = await vscode.shaderFrame();
    await expect.poll(
      () => frame.evaluate(() => document.querySelector('.header-info')?.textContent?.trim() ?? ''),
      { message: 'debug panel never followed the Compute-pass cursor' },
    ).toContain('L3');
    await expect(frame.locator('.fn-name', { hasText: 'update' })).toBeVisible();

    const wave = variableRow(frame, 'wave');
    await expect(wave).toBeVisible({ timeout: 45_000 });
    await expect(wave.locator('.var-value')).toHaveText('0.625');
    await expect(variableRow(frame, 'id')).toBeVisible();
    await expect(frame.locator('[aria-label="Show capture errors"]')).toHaveCount(0);

    await expectWaveLinePreview(frame);
    await setInlineRendering(frame, false);
    await expectComputeOutput(frame);
    await setInlineRendering(frame, true);
    await expectWaveLinePreview(frame);
  });

  test('captures WGSL 2x2 matrices in authored column order from Image and Common', async ({ vscode }) => {
    for (const existingFrame of vscode.window.frames()) {
      if (await existingFrame.locator('.canvas-container').count()) {
        await setPreviewLocked(existingFrame, false);
      }
    }
    await showFileAtLine(vscode, matrixPath, 2);
    await ensureShaderView(vscode);
    let frame = await vscode.shaderFrame();
    await expect(frame.locator('.canvas-container canvas').first()).toBeVisible();
    await enableVariableInspector(frame);
    await setPreviewLocked(frame, true);

    await showFileAtLine(vscode, matrixPath, 2);
    frame = await vscode.shaderFrame();
    await expect.poll(
      () => frame.evaluate(() => document.querySelector('.header-info')?.textContent?.trim() ?? ''),
      { message: 'debug panel never followed the matrix cursor', timeout: 30_000 },
    ).toContain('L3');
    // Four distinct components prove the column-major order Slang's float2x2 uses.
    const annotated = variableRow(frame, 'annotated');
    await expect(annotated).toBeVisible({ timeout: 45_000 });
    await expect(annotated.locator('.var-type')).toHaveText('mat2x2f');
    await expect(annotated.locator('.var-value')).toHaveText(/^\(0\.125,\s*0\.250,\s*0\.500,\s*0\.750\)$/);
    const inferred = variableRow(frame, 'inferred');
    await expect(inferred.locator('.var-type')).toHaveText('mat2x2<f32>');
    await expect(inferred.locator('.var-value')).toHaveText(/^\(0\.750,\s*0\.500,\s*0\.250,\s*0\.125\)$/);
    await expect(frame.locator('[aria-label="Show capture errors"]')).toHaveCount(0);

    await showFileAtLine(vscode, matrixCommonPath, 1);
    frame = await vscode.shaderFrame();
    await expect(frame.locator('.fn-name', { hasText: 'commonBasis' })).toBeVisible({ timeout: 30_000 });
    const basis = variableRow(frame, 'basis');
    await expect(basis).toBeVisible({ timeout: 45_000 });
    await expect(basis.locator('.var-value')).toHaveText(/^\(0\.500,\s*0\.250,\s*0\.125,\s*0\.750\)$/);
    await expect(frame.locator('[aria-label="Show capture errors"]')).toHaveCount(0);
  });
});
