import { readFileSync, writeFileSync } from 'node:fs';
import { openConfigPanel } from './config-panel.mjs';

export function registerPollingRateScenario(test, expect, scenario) {
  const originalConfig = readFileSync(scenario.configPath, 'utf8');

  test.describe(`${scenario.label} script Max Polling Rate control`, () => {
    test.afterAll(() => writeFileSync(scenario.configPath, originalConfig));

    const openScriptTab = async (vscode) => {
      await vscode.evaluateInHost(async (vscode, filePath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        await vscode.commands.executeCommand('shader-studio.view');
      }, scenario.shaderPath);
      const frame = await vscode.shaderFrame();
      await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('notifications.clearAll'));
      if (!await frame.locator('.polling-section').count()) {
        await openConfigPanel(frame);
        const scriptTab = frame.locator('.tab-label', { hasText: 'Script' });
        await expect.poll(() => scriptTab.count(), { timeout: 30_000 }).toBeGreaterThan(0);
        await scriptTab.first().click();
      }
      await expect.poll(() => frame.locator('.polling-section').count(), { timeout: 30_000 }).toBeGreaterThan(0);
      return frame;
    };

    test('writes the chosen rate to the shader config and keeps it across a reload', async ({ vscode }) => {
      const frame = await openScriptTab(vscode);
      await expect.poll(() => frame.locator('.polling-value').first().innerText(), {
        message: 'the panel never showed the configured rate', timeout: 30_000,
      }).toMatch(/^30fps/);
      await frame.locator('.preset-btn', { hasText: '60fps' }).first().click();
      await expect.poll(() => JSON.parse(readFileSync(scenario.configPath, 'utf8')).scriptMaxPollingFps, {
        message: 'the chosen polling rate never reached the shader config', timeout: 30_000,
      }).toBe(60);
      const written = JSON.parse(readFileSync(scenario.configPath, 'utf8'));
      expect(written.script).toBe(scenario.script);
      expect(written.passes.Image).toBeTruthy();
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
      const reloaded = await openScriptTab(vscode);
      await expect.poll(() => reloaded.locator('.polling-value').first().innerText(), {
        message: 'the reloaded panel lost the configured rate', timeout: 30_000,
      }).toMatch(/^60fps/);
    });
  });
}
