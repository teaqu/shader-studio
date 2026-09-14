import { expect, test, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { centrePixel } from './canvas-pixel.mjs';

test.use({ vscodeKey: 'script-uniforms-debug-panel' });

// Script values belong to the Script tab of the config panel. The debug panel's
// Uniforms section lists the engine's built-in inputs only, in every language.
const cases = [
  { language: 'glsl', file: 'script-runtime-glsl.glsl', scriptNames: ['uLevel', 'uCalls', 'uFps', 'uFrame'], red: [185, 197] },
  { language: 'slang', file: 'script-runtime-slang.slang', scriptNames: ['uLevel', 'uCalls', 'uFps', 'uFrame'], red: [185, 197] },
  { language: 'wgsl', file: 'script-uniform-chain/chain.wgsl', scriptNames: ['gain', 'tint', 'unused'], red: [85, 105] },
];

test.describe('debug panel uniforms @gpu', () => {
  test.beforeEach(async ({ vscode }) => {
    await vscode.evaluateInHost(async (api) => {
      await api.commands.executeCommand('workbench.action.closeAllEditors');
    });
  });

  for (const { language, file, scriptNames, red } of cases) {
    test(`${language} keeps script values out of the debug Uniforms section`, async ({ vscode }) => {
      await vscode.evaluateInHost(async (api, path) => {
        const document = await api.workspace.openTextDocument(api.Uri.file(path));
        await api.window.showTextDocument(document, {
          viewColumn: api.ViewColumn.One, preserveFocus: false, preview: false,
        });
        await api.commands.executeCommand('shader-studio.view');
        await api.commands.executeCommand('notifications.clearAll');
      }, join(workspacePath, file));
      const frame = await vscode.shaderFrame();
      await expect(frame.locator('.menu-bar')).toBeVisible();
      // The red channel only reaches this range once the script's values render.
      await expect.poll(async () => {
        const [pixelRed] = await centrePixel(frame);
        return pixelRed >= red[0] && pixelRed <= red[1];
      }, { message: `the ${language} script values never reached the shader` }).toBe(true);

      const debugButton = frame.getByLabel('Toggle debug mode');
      await expect(debugButton).toBeEnabled();
      if (await debugButton.isVisible()) {
        await debugButton.click();
      } else {
        await frame.getByLabel('Open options menu', { exact: true }).click();
        await frame.locator('.options-menu-item[aria-label="Toggle debug mode"]').click();
      }
      const panel = frame.locator('.debug-panel');
      await expect(panel).toBeVisible();
      if (await panel.locator('.variables-section').count() === 0) {
        await panel.getByLabel('Toggle variable inspector').click();
      }
      const uniformNames = panel.locator('.uniforms-section .uniform-name');
      await expect(uniformNames.filter({ hasText: /^iTime$/ })).toBeVisible();
      await expect(uniformNames.filter({ hasText: /^iCameraDir$/ })).toBeVisible();
      for (const name of scriptNames) {
        await expect(uniformNames.filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(0);
      }
    });
  }
});
