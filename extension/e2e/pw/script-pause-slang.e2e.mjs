import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'script-pause-slang.slang');

test.use({ vscodeKey: 'script-pause-slang' });

/**
 * The WebGPU/Slang mirror of script-pause.e2e.mjs: uniform scripts run in the
 * extension host however the shader renders, so a paused Slang picture must
 * freeze just like the WebGL one. Only the real host shows this: it needs the
 * extension's polling loop and the viewer's pause together.
 *
 * A WebGPU canvas has no WebGL context to read back from, so the centre pixel
 * comes from a screenshot of the presented canvas, the way the slang-dedup
 * spec reads its preview.
 */
test.describe('a paused Slang shader driven by a uniform script @gpu', () => {
  const redAtCentre = async (frame) => {
    try {
      // Screenshot the presented WebGPU canvas: toDataURL may observe a
      // cleared swapchain after presentation, rather than what the user sees.
      const screenshot = await frame.locator('.canvas-container canvas').first().screenshot();
      return await frame.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const pixel = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
        bitmap.close();
        return pixel[0];
      }, screenshot.toString('base64'));
    } catch {
      return null;
    }
  };

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
