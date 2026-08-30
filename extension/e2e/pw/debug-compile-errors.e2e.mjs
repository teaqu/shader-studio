import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'broken-capture.glsl');

test.use({ vscodeKey: 'debug-compile-errors' });

/**
 * Debug instrumentation truncates the shader body at the inspected line, so a
 * broken statement below it is not in what gets compiled. The instrumented
 * shader then compiles cleanly and used to report success for the user's
 * shader, clearing the real compiler errors from the panel. Only the real app
 * shows this: it needs debug mode, a cursor position, and a genuine GL compile.
 */
test.describe('compile errors while debug mode is on', () => {
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

    // Park the cursor *below* the broken statement: the capture has to fall
    // back to the last line above the break rather than fail wholesale.
    await vscode.evaluateInHost(async (vscode, targetPath, line) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }, shaderPath, 15);

    // Land inside the broken function first, then move out: the panel must
    // replace what it showed there rather than keep it around.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await vscode.evaluateInHost(async (vscode, targetPath, line) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(line, 4);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }, shaderPath, 56);

    frame = await vscode.shaderFrame();
    // The panel must actually follow the cursor before anything is read from it.
    await expect.poll(
      () => frame.evaluate(() => document.querySelector('.header-info')?.textContent?.trim() ?? ''),
      { message: 'debug panel never followed the cursor to line 57', timeout: 30_000 },
    ).toContain('L57');
    await expect.poll(async () => {
      const names = await frame.locator('.variables-section .var-name').count();
      if (names > 0) return 'captured';
      return frame.evaluate(() => JSON.stringify({
        section: document.querySelector('.variables-section')?.textContent?.replace(/\s+/g, ' ').slice(0, 200) ?? null,
        issues: Array.from(document.querySelectorAll('.error-tooltip-block'), (el) => el.textContent?.trim().slice(0, 90)),
      }));
    }, { message: 'variables never captured', timeout: 45_000 }).toBe('captured');

    // The tooltips are portalled to the body, and only the open one is read.
    const captureIssues = await frame.locator('[aria-label="Show capture errors"]').count();

    await frame.getByLabel('Toggle pause').hover();
    await expect.poll(
      () => frame.locator('.error-tooltip.visible').count(),
      { message: 'pause tooltip never opened', timeout: 10_000 },
    ).toBeGreaterThan(0);

    state = { captureIssues, ...await frame.evaluate(() => ({
      pauseClasses: document.querySelector('[aria-label="Toggle pause"]')?.className ?? '',
      errorBlocks: Array.from(
        document.querySelectorAll('.error-tooltip.visible .error-tooltip-block'),
        (el) => el.textContent?.trim() ?? '',
      ),
      varNames: Array.from(document.querySelectorAll('.var-name'), (el) => el.textContent?.trim()),
      fnName: document.querySelector('.fn-name')?.textContent?.trim() ?? null,
      headerInfo: document.querySelector('.header-info')?.textContent?.trim() ?? null,
    })) };
  });

  test('still reports the real compiler error', () => {
    // The stray token merges with the statement below it, so the driver blames
    // that line - whatever it says, it has to reach the panel.
    expect(state.errorBlocks.join('\n')).toMatch(/ERROR: 0:\d+:/);
    expect(state.pauseClasses).toContain('error');
  });

  test('gives the error its own block', () => {
    expect(state.errorBlocks.length).toBeGreaterThan(0);
  });

  test('resolves the inspected line to the function it is in', () => {
    expect(`${state.fnName} ${state.headerInfo}`).toContain('mainImage');
  });

  test('shows only the variables of the function being inspected', () => {
    // Blanking rather than deleting the cut lines keeps every line number, so
    // the cursor still resolves to mainImage rather than sliding into noise().
    for (const noiseLocal of ['i', 'f', 'a', 'b', 'c']) {
      expect(state.varNames, `noise() local ${noiseLocal} leaked`).not.toContain(noiseLocal);
    }
  });

  test('captures a healthy function while another one is broken', () => {
    // The break is inside noise(); only that function's body is cut, so
    // mainImage still compiles and reports everything in scope.
    expect(state.varNames).toContain('uv');
    expect(state.varNames).toContain('rad');
  });

  test('reports no capture problem when the cursor is in the healthy function', () => {
    expect(state.captureIssues).toBe(0);
  });

  test('keeps the scope right as the cursor moves in and out of the broken function', async ({ vscode }) => {
    // Moving the cursor is the case a single reading cannot catch: the panel
    // has to re-resolve the scope every time, not reuse the last one.
    const frame = await vscode.shaderFrame();

    const inspect = async (line) => {
      await vscode.evaluateInHost(async (vscode, targetPath, zeroBased) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        const editor = await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        const position = new vscode.Position(zeroBased, 4);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
      }, shaderPath, line);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return (await vscode.shaderFrame()).evaluate(() => Array.from(
        document.querySelectorAll('.var-name'), (el) => el.textContent?.trim(),
      ));
    };

    expect(await frame.locator('.variables-section').count()).toBeGreaterThan(0);

    // Inside noise(), then out to mainImage, then back in again.
    for (const [line, forbidden] of [[15, 'uv'], [56, 'i'], [15, 'uv'], [40, 'i']]) {
      const names = await inspect(line);
      expect(names, `line ${line + 1} showed ${forbidden}`).not.toContain(forbidden);
    }
  });
});
