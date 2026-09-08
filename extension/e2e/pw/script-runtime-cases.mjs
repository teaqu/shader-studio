import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { openConfigPanel } from './config-panel.mjs';

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openShader(vscode, name) {
  await vscode.evaluateInHost(async (vscode, path) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
    });
    await vscode.commands.executeCommand('shader-studio.view');
    await vscode.commands.executeCommand('notifications.clearAll');
  }, join(workspacePath, name));
  const frame = await vscode.shaderFrame();
  await expect(frame.locator('.menu-bar')).toBeVisible();
  await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('notifications.clearAll'));
  return frame;
}

async function scriptTab(frame) {
  if (!await frame.locator('.script-tab-content').count()) {
    if (!await frame.locator('.tab-label').filter({ hasText: /^Script$/ }).count()) {
      await openConfigPanel(frame);
    }
    await frame.locator('.tab-label').filter({ hasText: /^Script$/ }).first().click();
  }
  await expect(frame.locator('.script-tab-content')).toBeVisible();
}

function value(frame, name) {
  return frame.locator('.uniform-row').filter({
    has: frame.locator('.uniform-name', { hasText: new RegExp(`^${name}$`) }),
  }).locator('.uniform-value');
}

export function registerScriptRuntimeTests(language) {
  test.use({ vscodeKey: `script-runtime-${language}` });
  test.describe(`script runtime parity ${language} ${language === 'slang' ? '@gpu' : ''}`, () => {
    test.beforeEach(async ({ vscode }) => {
      await vscode.evaluateInHost(async (vscode) => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      });
    });

    test('shows constant values even when the new backend cannot compile @gpu', async ({ vscode }) => {
      const other = language === 'glsl' ? 'slang' : 'glsl';
      let frame = await openShader(vscode, `script-runtime-${other}.${other}`);
      await scriptTab(frame);
      await expect(value(frame, 'uLevel')).toHaveText('0.750');
      await frame.getByLabel('Toggle pause', { exact: true }).click();
      await settle(500);

      frame = await openShader(vscode, `script-runtime-${language}-broken.${language}`);
      await scriptTab(frame);
      await expect(frame.locator('.error-tooltip')).toContainText('missingUniform');
      await expect(value(frame, 'uLevel')).toHaveText('0.750');
      await expect(value(frame, 'uCalls')).not.toHaveText('—');
      // Replaying a failed shader clears the panel, even though WebGPU never
      // installed its declarations. No polling runs while paused to refill it.
      await frame.getByLabel('Reset shader', { exact: true }).click();
      await expect(value(frame, 'uLevel')).toHaveText('0.750');
    });

    test('keeps a paused script snapshot when Reset recompiles the shader', async ({ vscode }) => {
      const frame = await openShader(vscode, `script-runtime-${language}.${language}`);
      await scriptTab(frame);
      await expect(value(frame, 'uLevel')).toHaveText('0.750');
      await expect.poll(async () => Number(await value(frame, 'uCalls').innerText())).toBeGreaterThan(2);
      await frame.getByLabel('Toggle pause', { exact: true }).click();
      // Drain the input/report throttle before recording the frozen snapshot.
      await settle(500);
      const frozen = await value(frame, 'uCalls').innerText();
      await frame.getByLabel('Reset shader', { exact: true }).click();
      await expect(value(frame, 'uLevel')).toHaveText('0.750');
      await expect(value(frame, 'uCalls')).toHaveText(frozen);
      await settle(500);
      await expect(value(frame, 'uCalls')).toHaveText(frozen);
      await frame.getByLabel('Toggle pause', { exact: true }).click();
      await expect.poll(async () => Number(await value(frame, 'uCalls').innerText())).toBeGreaterThan(Number(frozen));
    });

    test('updates script FPS after changing the renderer limit', async ({ vscode }) => {
      const frame = await openShader(vscode, `script-runtime-${language}.${language}`);
      await scriptTab(frame);
      await expect(value(frame, 'uLevel')).toHaveText('0.750');
      await frame.getByLabel('Change FPS limit').click();
      for (const limit of [30, 60, 30]) {
        await frame.getByRole('button', { name: `${limit} FPS`, exact: true }).click();
        // Assert the real renderer settled before checking the script's copy.
        await expect.poll(async () => Math.abs(parseFloat(await frame.getByLabel('Change FPS limit').innerText()) - limit)).toBeLessThan(5);
        await expect.poll(async () => Math.abs(Number(await value(frame, 'uFps').innerText()) - limit)).toBeLessThan(5);
      }
    });
  });
}
