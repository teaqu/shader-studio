import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderA = join(workspacePath, 'open-config-shows-shader-a.glsl');
const configB = join(workspacePath, 'open-config-shows-shader-b.sha.json');

test.use({ vscodeKey: 'open-config-shows-shader' });

/**
 * Opening a shader's config used to sit inert until the user actually edited
 * it — the preview kept showing whatever it showed before, with no signal
 * that the config even belonged to a different shader. Config files hot-load
 * exactly like shader source: opening one must show its shader immediately,
 * the same way focusing a .glsl file already does.
 */
test('opening a config file shows its own shader immediately, with no edit required', async ({ vscode }) => {
  await vscode.evaluateInHost(async (vscode, targetPath) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
    });
    await vscode.commands.executeCommand('shader-studio.view');
  }, shaderA);

  const frame = await vscode.shaderFrame();
  await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);

  async function pixelAt() {
    return frame.evaluate(() => {
      const canvas = document.querySelector('.canvas-container canvas');
      const context = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
      if (!context) return null;
      const pixel = new Uint8Array(4);
      context.readPixels(
        Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
        context.RGBA, context.UNSIGNED_BYTE, pixel,
      );
      return [...pixel];
    });
  }

  await expect.poll(pixelAt, { timeout: 60_000, message: 'shader A never rendered red' })
    .toEqual([255, 0, 0, 255]);

  // Open the UNRELATED shader B's config — no edit at all — in the same
  // editor column the shader files use (not the preview panel's own column).
  await vscode.evaluateInHost(async (vscode, targetPath) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
    });
  }, configB);

  await expect.poll(pixelAt, { timeout: 30_000, message: 'opening the config never switched the preview to shader B' })
    .toEqual([0, 255, 0, 255]);
});
