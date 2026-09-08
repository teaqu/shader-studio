import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { centrePixel } from './canvas-pixel.mjs';
import { openConfigPanel } from './config-panel.mjs';

export function registerScriptConstantTests(language) {
  const suffix = language === 'slang' ? '-slang' : '';


  const shaderPath = join(workspacePath, `script-constants${suffix}.${language}`);
  const helperPath = join(workspacePath, `script-constants-helper.${language}`);

  test.use({ vscodeKey: `script-constants${suffix}` });

  /**
 * The host sends every script value once, then only the ones that change - so
 * a uniform the script holds constant is heard from exactly once. Opening a
 * helper with no mainImage previews the bare file with no script context, and
 * that preview used to wipe the client's uniform state: the constant never
 * came back (nothing resends a value that never changed) and every effect it
 * drove silently sat at zero, with the panel's Script tab losing the row. Only
 * the real host shows this: it needs the extension's delta batches and the
 * viewer's compile together.
 */
  test.describe(`a script constant across a bare-file preview ${language} ${language === 'slang' ? '@gpu' : ''}`, () => {
    const centreRed = async (frame) => (await centrePixel(frame))[0];

    const uniformNames = (frame) => frame.evaluate(
      () => [...document.querySelectorAll('.uniform-name')].map((el) => el.textContent?.trim()),
    );

    const uniformValues = (frame) => frame.evaluate(
      () => [...document.querySelectorAll('.uniform-value')].map((el) => el.textContent?.trim()),
    );

    const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const openFile = (vscode, targetPath) => vscode.evaluateInHost(async (vscode, filePath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      await vscode.commands.executeCommand('shader-studio.view');
    }, targetPath);

    test('keeps the constant after opening a helper with no mainImage', async ({ vscode }) => {
      await openFile(vscode, shaderPath);

      const frame = await vscode.shaderFrame();
      await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);

      // Red is the constant (0.75 * 255 = 191): the script is alive and bound.
      await expect.poll(() => centreRed(frame), {
        message: 'the script constant never reached the shader',
        timeout: 90_000,
      }).toBeGreaterThan(170);

      // Startup notifications can cover the toolbar in VS Code.
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('notifications.clearAll'));

      // The panel is opened before the detour: a failed compile hides the
      // toolbar, so nothing here can click afterwards - but the rows are already
      // rendered, and losing the uniform state takes them away reactively.
      await openConfigPanel(frame);
      const scriptTab = frame.locator('.tab-label', { hasText: 'Script' });
      await expect.poll(() => scriptTab.count(), { timeout: 30_000 }).toBeGreaterThan(0);
      await scriptTab.first().click();
      await expect.poll(() => uniformValues(frame), { timeout: 30_000 }).toEqual(
        expect.arrayContaining(['0.750']),
      );

      // Detour through a file that carries no config and no script context, long
      // enough for the preview and several delta-only poll batches to arrive.
      await openFile(vscode, helperPath);
      await settle(2000);

      // The constant must still be listed at the value the script set: without
      // the fix the preview empties the Script tab and the host never sends the
      // constant again, so the row is gone for the life of the shader.
      await expect.poll(() => uniformNames(frame), {
        message: 'the bare-file preview threw away the script uniforms',
        timeout: 30_000,
      }).toEqual(expect.arrayContaining(['uLevel', 'uTick']));
      await expect.poll(() => uniformValues(frame), {
        message: 'the script constant never came back after the preview',
        timeout: 30_000,
      }).toEqual(expect.arrayContaining(['0.750']));

      await openFile(vscode, shaderPath);
      await expect.poll(() => centreRed(frame), {
        message: 'the constant was displayed but not restored to the renderer',
        timeout: 30_000,
      }).toBeGreaterThan(170);
      await expect.poll(() => uniformValues(frame)).toEqual(expect.arrayContaining(['0.750']));
    });
  });

}
