import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const fixtureDir = join(workspacePath, 'wgsl-authoring');
const imagePath = join(fixtureDir, 'image.wgsl');
const diagnosticPath = join(fixtureDir, 'diagnostic.wgsl');

test.use({ vscodeKey: 'wgsl-authoring' });

async function showShader(vscode, targetPath) {
  await vscode.evaluateInHost(async (vscode, path) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
  }, targetPath);
}

async function expectPreview(frame, rgb, vscode) {
  // WGSL debugging is plan-based, so the debug toggle enables once the shader
  // has loaded; readiness is still the visible canvas plus rendered pixels.
  await expect(frame.getByLabel('Toggle debug mode', { exact: true }).first()).toBeEnabled();
  if (vscode) {
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('notifications.clearAll'));
  }
  await expect(frame.locator('.canvas-container canvas').first()).toBeVisible();
  await expect.poll(async () => {
    // Screenshot the presented WebGPU canvas: toDataURL may observe a cleared
    // swapchain after presentation, rather than what the user sees.
    const screenshot = await frame.locator('.canvas-container canvas').first().screenshot();
    const pixel = await frame.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const pixel = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      bitmap.close();
      return pixel.slice(0, 3);
    }, screenshot.toString('base64'));
    return Math.max(...pixel.map((value, index) => Math.abs(value - rgb[index])));
  }, { message: `preview never displayed ${rgb.join(', ')}` }).toBeLessThanOrEqual(1);
  await expect(frame.locator('[aria-label="Toggle pause"]')).not.toHaveClass(/error/);
}

async function waitForDiagnostic(vscodeFixture, uri, message, present = true) {
  let diagnostic = null;
  await expect.poll(async () => {
    diagnostic = await vscodeFixture.evaluateInHost(async (vscode, documentUri, expected) => {
      const found = vscode.languages.getDiagnostics(vscode.Uri.parse(documentUri))
        .find((item) => item.message.toLocaleLowerCase().includes(expected.toLocaleLowerCase()));
      return found ? { message: found.message, source: found.source } : null;
    }, uri, message);
    return Boolean(diagnostic);
  }, {
    timeout: 15_000,
    intervals: [100],
    message: `expected diagnostic ${JSON.stringify(message)} to be ${present ? 'published' : 'cleared'}`,
  }).toBe(present);
  return diagnostic;
}

test.describe('WGSL authoring in VS Code', () => {
  test.beforeAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
    });
  });

  test('recognizes .wgsl files and provides WGSL completions', async ({ vscode }) => {
    const languageId = await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      return document.languageId;
    }, imagePath);
    expect(languageId).toBe('wgsl');

    const labels = await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      const completions = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(1, 4),
      );
      return (completions?.items ?? []).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
    }, imagePath);
    expect(labels).toContain('select');
  });

  test('renames a Common WGSL helper across its configured pass', async ({ vscode }) => {
    const passPath = join(fixtureDir, 'common-rename.wgsl');
    const commonPath = join(fixtureDir, 'common-rename.common.wgsl');
    const configPath = join(fixtureDir, 'common-rename.sha.json');
    const pass = 'fn mainImage(coord: vec2f) -> vec4f {\n  let tone: f32 = coord.x;\n  return vec4f(sharedTone(coord.x) + tone);\n}\n';
    const common = 'fn sharedTone(value: f32) -> f32 { return value * 0.5; }\n';
    try {
      writeFileSync(passPath, pass);
      writeFileSync(commonPath, common);
      writeFileSync(configPath, JSON.stringify({
        version: '1.0',
        passes: { common: { path: 'common-rename.common.wgsl' }, Image: { path: 'common-rename.wgsl' } },
      }));
      await vscode.evaluateInHost(async (vscode, files) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(files.passPath));
        const source = document.getText();
        const position = document.positionAt(source.indexOf('sharedTone') + 2);
        await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, position);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const commonDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(files.commonPath));
        const commonPosition = commonDocument.positionAt(commonDocument.getText().indexOf('sharedTone') + 2);
        const editor = await vscode.window.showTextDocument(commonDocument, { preview: false, preserveFocus: false });
        editor.selection = new vscode.Selection(commonPosition, commonPosition);
        return true;
      }, { passPath, commonPath, configPath, pass, common });
      const window = vscode.window;
      await window.locator('.view-line').getByText('sharedTone', { exact: true }).dblclick();
      await window.keyboard.press('F2');
      const renameInput = window.locator('.rename-box input, .rename-input input').first();
      await expect(renameInput).toBeVisible();
      // VS Code selects the name after showing the widget. Typing before that
      // readiness transition lets its delayed selection replace typed letters.
      await expect(renameInput).toBeFocused();
      await expect.poll(() => renameInput.evaluate(input => [input.selectionStart, input.selectionEnd]))
        .toEqual([0, 'sharedTone'.length]);
      await renameInput.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await renameInput.pressSequentially('curve');
      await expect(renameInput).toHaveValue('curve');
      await renameInput.press('Enter');
      await expect(window.locator('.view-line').filter({ hasText: /fn\s+curve\(value:/ })).toBeVisible();
      await vscode.evaluateInHost(async (vscode, files) => {
        const commonDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(files.commonPath));
        const passDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(files.passPath));
        await vscode.window.showTextDocument(commonDocument, { preview: false, preserveFocus: false });
        await commonDocument.save();
        await vscode.window.showTextDocument(passDocument, { preview: false, preserveFocus: false });
        if (!passDocument.getText().includes('curve(coord.x)')) {
          throw new Error('rename did not update the visible pass document');
        }
        await passDocument.save();
        return true;
      }, { passPath, commonPath });
      const texts = [readFileSync(passPath, 'utf8'), readFileSync(commonPath, 'utf8')];
      expect(texts[0]).toContain('curve(coord.x)');
      expect(texts[0]).toContain('let tone: f32');
      expect(texts[1]).toContain('fn curve(value: f32)');
    } finally {
      for (const path of [passPath, commonPath, configPath]) {
        try {
          rmSync(path);
        } catch { /* fixture cleanup */ }
      }
    }
  });

  test('publishes and clears WGSL diagnostics', async ({ vscode }) => {
    const brokenSource = 'fn mainImage(coord: vec2f) -> vec4f {\n    let unusedTint = vec3f(0.2, 0.4, 0.6);\n    return vec4f(1.0, 0.0, 0.0, 1.0);\n}\n';
    const uri = await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(0, 0),
      );
      return document.uri.toString();
    }, diagnosticPath);

    const diagnostic = await waitForDiagnostic(vscode, uri, 'unused variable');
    expect(diagnostic, 'expected a WGSL unused-variable diagnostic').toBeTruthy();

    try {
      await vscode.evaluateInHost(async (vscode, documentUri) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
        const edit = new vscode.WorkspaceEdit();
        const end = document.positionAt(document.getText().length);
        edit.replace(
          document.uri,
          new vscode.Range(new vscode.Position(0, 0), end),
          'fn mainImage(coord: vec2f) -> vec4f {\n    return vec4f(1.0, 0.0, 0.0, 1.0);\n}\n',
        );
        await vscode.workspace.applyEdit(edit);
      }, uri);
      await waitForDiagnostic(vscode, uri, 'unused variable', false);
    } finally {
      await vscode.evaluateInHost(async (vscode, documentUri, source) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
        const edit = new vscode.WorkspaceEdit();
        const end = document.positionAt(document.getText().length);
        edit.replace(
          document.uri,
          new vscode.Range(new vscode.Position(0, 0), end),
          source,
        );
        await vscode.workspace.applyEdit(edit);
        await document.save();
      }, uri, brokenSource);
    }
  });

  test('captures WGSL variables at the existing cursor when enabling the debugger', async ({ vscode }) => {
    await showShader(vscode, imagePath);
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
    const frame = await vscode.shaderFrame();
    await expectPreview(frame, [0, 255, 0], vscode);

    // Park the cursor before enabling debug mode. Capturing must not require
    // an extra cursor movement after the debugger opens.
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(1, 4);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }, imagePath);

    await expect.poll(
      () => frame.evaluate(() => !document.querySelector(
        'button.collapse-debug[aria-label="Toggle debug mode"]')?.disabled),
      { message: 'WGSL debug mode never became available', timeout: 90_000 },
    ).toBe(true);
    await frame.evaluate(() => {
      const debugButton = document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]');
      if (debugButton && !debugButton.classList.contains('active')) {
        debugButton.click();
      }
    });
    await expect(frame.locator('.debug-panel')).toBeVisible({ timeout: 30_000 });
    if (await frame.locator('.variables-section').count() === 0) {
      await frame.getByLabel('Toggle variable inspector').click();
    }
    await expect(frame.locator('.variables-section')).toBeVisible();

    await expect.poll(
      () => frame.evaluate(() => document.querySelector('.header-info')?.textContent?.trim() ?? ''),
      { message: 'WGSL debug panel never followed the cursor to line 2', timeout: 30_000 },
    ).toContain('L2');
    let lastState = '';
    try {
      await expect.poll(async () => {
        const names = await frame.locator('.variables-section .var-name').allTextContents();
        lastState = names.join(' ');
        return lastState;
      }, { message: 'WGSL variables never captured', timeout: 45_000 }).toMatch(/coord/);
    } catch (failure) {
      const state = await frame.evaluate(() => ({
        vars: Array.from(document.querySelectorAll('.var-name'), (el) => el.textContent?.trim() ?? ''),
        errors: Array.from(document.querySelectorAll('.error-tooltip-block'), (el) => el.textContent?.trim() ?? ''),
        header: document.querySelector('.header-info')?.textContent?.trim() ?? null,
        debugPanel: !!document.querySelector('.debug-panel'),
        variablesSection: !!document.querySelector('.variables-section'),
      })).catch((probeFailure) => ({ probeFailure: String(probeFailure) }));
      throw new Error([failure.message, `last names: ${lastState}`, `panel state: ${JSON.stringify(state)}`].join('\n'));
    }
    await expect(frame.locator('.variables-section .var-name', { hasText: '_dbgReturn' })).toBeVisible();
    expect(await frame.locator('[aria-label="Show capture errors"]').count()).toBe(0);

    // Leave debug mode off: later tests in this window expect the plain
    // preview, and a restored cursor would otherwise keep previewing.
    await frame.evaluate(() => {
      const debugButton = document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]');
      if (debugButton && debugButton.classList.contains('active')) {
        debugButton.click();
      }
    });
    await expect.poll(() => frame.evaluate(() => document.querySelector(
      'button.collapse-debug[aria-label="Toggle debug mode"]')?.classList.contains('active') ?? false),
    ).toBe(false);
  });

  test('renders a WGSL shader in the preview and survives reload', async ({ vscode }) => {
    await showShader(vscode, imagePath);
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
    let frame = await vscode.shaderFrame();
    await test.step('initial preview', () => expectPreview(frame, [0, 255, 0], vscode));

    await vscode.evaluateInHost(async vscode => {
      setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
    });
    await expect.poll(() => frame.isDetached(), { message: 'VS Code never reloaded its webview' }).toBe(true);
    // The extension does not register a webview serializer: reopen the saved
    // shader through the same command a user runs after restarting VS Code.
    await showShader(vscode, imagePath);
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
    frame = await vscode.shaderFrame();
    await test.step('preview after reload', () => expectPreview(frame, [0, 255, 0], vscode));
  });
});
