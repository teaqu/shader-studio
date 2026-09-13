import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { centrePixel } from './canvas-pixel.mjs';

export function registerScriptContextTests(language) {
  const suffix = language === 'slang' ? '-slang' : '';


  const shaderPath = join(workspacePath, `script-context${suffix}.${language}`);

  test.use({ vscodeKey: `script-context${suffix}` });

  /**
 * Uniform scripts run in the extension host, which has no shader of its own.
 * It used to invent the context it hands them: a wall clock for `iTime`, a
 * fixed 800x600 for `iResolution`, a permanently zero `iMouse`. A script
 * positioning anything from those was quietly working from fiction.
 *
 * The fixture checks itself: it feeds what the script was told back into the
 * shader, which compares it against the renderer's own uniforms and paints one
 * channel per agreement. White is agreement; any disagreement is visible.
 */
  test.describe(`the context a uniform script is given ${language} ${language === 'slang' ? '@gpu' : ''}`, () => {
    const centre = centrePixel;

    const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    test('matches the shader on resolution, time, and mouse - through a pause', async ({ vscode }) => {
      await vscode.evaluateInHost(async (vscode, targetPath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        await vscode.commands.executeCommand('shader-studio.view');
      }, shaderPath);

      const frame = await vscode.shaderFrame();
      await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);

      // Resolution and time agree from the first values that arrive.
      await expect.poll(() => centre(frame), {
        message: 'the script was given a resolution or clock the shader does not share',
        timeout: 90_000,
      }).toEqual([255, 255, 255]);

      // The mouse the script sees is the viewer's, not a zero placeholder.
      // Two canvases exist (one per backend); the first is the live one that
      // querySelector reads above.
      const canvas = frame.locator('.canvas-container canvas').first();
      const box = await canvas.boundingBox();
      await frame.page().mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
      await settle(700);
      expect(await centre(frame), 'the script never saw the mouse move').toEqual([255, 255, 255]);

      // A pause is where a wall clock and the shader's clock part company: the
      // shader's time stops, so a script still counting seconds drifts away.
      await frame.getByLabel('Toggle pause').click();
      await settle(2500);
      await frame.getByLabel('Toggle pause').click();
      await settle(700);

      await expect.poll(() => centre(frame), {
        message: 'the script kept counting through the pause the shader sat out',
        timeout: 30_000,
      }).toEqual([255, 255, 255]);
    });
  });

}
