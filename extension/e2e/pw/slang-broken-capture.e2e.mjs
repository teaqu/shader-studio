import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'broken-capture.slang');

test.use({ vscodeKey: 'slang-broken-capture' });

/**
 * Slang plans a capture from the whole module, so a statement it cannot parse
 * used to fail every variable at every line. The plan now runs against a copy
 * cut above the break, which still holds the values declared before it.
 */
test.describe('Slang capture around a broken statement', () => {
  let state;

  test.beforeAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(0, 0);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    let frame = await vscode.shaderFrame();
    await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);

    // The toggle stays disabled until the shader has loaded, and a click that
    // lands before then does nothing at all.
    await expect.poll(
      () => frame.evaluate(() => !document.querySelector(
        'button.collapse-debug[aria-label="Toggle debug mode"]')?.disabled),
      { message: 'debug mode never became available', timeout: 90_000 },
    ).toBe(true);
    await frame.evaluate(() => {
      const debugButton = document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]');
      if (debugButton && !debugButton.classList.contains('active')) debugButton.click();
    });
    await expect.poll(() => frame.locator('.debug-panel').count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await frame.getByLabel('Toggle variable inspector').click();

    // Cursor below the break, where nothing used to capture at all.
    await vscode.evaluateInHost(async (vscode, targetPath, line) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(line, 4);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }, shaderPath, 10);

    frame = await vscode.shaderFrame();
    // The panel must actually follow the cursor before anything is read from it.
    await expect.poll(
      () => frame.evaluate(() => document.querySelector('.header-info')?.textContent?.trim() ?? ''),
      { message: 'debug panel never followed the cursor to line 11', timeout: 30_000 },
    ).toContain('L11');
    await expect.poll(async () => {
      const names = await frame.locator('.variables-section .var-name').count();
      if (names > 0) return 'captured';
      return frame.evaluate(() => document.querySelector('.variables-section')?.textContent
        ?.replace(/\s+/g, ' ').slice(0, 160) ?? 'no section');
    }, { message: 'variables never captured', timeout: 45_000 }).toBe('captured');

    state = await frame.evaluate(() => ({
      varNames: Array.from(document.querySelectorAll('.var-name'), (el) => el.textContent?.trim()),
      pauseError: (document.querySelector('[aria-label="Toggle pause"]')?.className ?? '').includes('error'),
    }));
  });

  test('captures the values declared above the break', () => {
    expect(state.varNames).toContain('uv');
    expect(state.varNames).toContain('col');
  });

  test('includes the value on the line immediately above the break', () => {
    // The cut keeps that line and returns from the break, so the value has been
    // assigned by the time the capture runs.
    expect(state.varNames).toContain('tx');
  });


  test('still reports that the shader itself does not compile', () => {
    expect(state.pauseError).toBe(true);
  });
});
