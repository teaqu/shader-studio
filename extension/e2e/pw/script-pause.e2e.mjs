import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'script-pause.glsl');

test.use({ vscodeKey: 'script-pause' });

/**
 * Uniform scripts run in the extension host, on their own clock. Pausing the
 * shader used to leave that loop running and its values still being uploaded,
 * so a "paused" picture carried on changing - and the script carried on doing
 * whatever it does, hardware and network included. Only the real host shows
 * this: it needs the extension's polling loop and the viewer's pause together.
 */
test.describe('a paused shader driven by a uniform script', () => {
  const redAtCentre = (frame) => frame.evaluate(() => {
    const canvas = document.querySelector('.canvas-container canvas');
    const context = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (!context) {
      return null;
    }
    const pixel = new Uint8Array(4);
    context.readPixels(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
      context.RGBA, context.UNSIGNED_BYTE, pixel,
    );
    return pixel[0];
  });

  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  test('stops changing while paused, and moves again when resumed', async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    const frame = await vscode.shaderFrame();
    await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(() => redAtCentre(frame), {
      message: 'the script uniform never reached the shader', timeout: 90_000,
    }).not.toBeNull();

    // Running: the script's value moves, so the picture moves.
    await expect.poll(async () => {
      const first = await redAtCentre(frame);
      await settle(700);
      return (await redAtCentre(frame)) !== first;
    }, { message: 'the running shader never changed, so this proves nothing', timeout: 30_000 }).toBe(true);

    await frame.getByLabel('Toggle pause').click();
    await settle(700);

    const paused = await redAtCentre(frame);
    await settle(1200);
    expect(await redAtCentre(frame), 'a paused shader kept changing').toBe(paused);

    await frame.getByLabel('Toggle pause').click();

    await expect.poll(async () => (await redAtCentre(frame)) !== paused, {
      message: 'the shader never resumed after unpausing', timeout: 30_000,
    }).toBe(true);
  });
});
