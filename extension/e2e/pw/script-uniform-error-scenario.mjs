import { rmSync, writeFileSync } from 'node:fs';
import { openConfigPanel } from './config-panel.mjs';

export function registerScriptUniformErrorScenario(test, expect, scenario) {
  const tooltipText = (frame) => frame.evaluate(() => document.querySelector('.error-tooltip')?.textContent ?? '');
  test.describe(`${scenario.label} uniform-script errors`, () => {
    test.afterAll(() => {
      if (scenario.restoreScript) {
        writeFileSync(scenario.missingScriptPath, scenario.restoreScript, 'utf8');
      } else {
        rmSync(scenario.missingScriptPath, { force: true });
      }
    });

    const open = async (vscode, path) => {
      await vscode.evaluateInHost(async (vscode, targetPath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        await vscode.commands.executeCommand('shader-studio.view');
      }, path);
      return vscode.shaderFrame();
    };

    test('shows the valid script uniform and constant value while the source fails', async ({ vscode }) => {
      const frame = await open(vscode, scenario.scriptTabShaderPath);
      await expect.poll(() => tooltipText(frame), { message: 'the broken shader was never reported', timeout: 90_000 }).toMatch(/error/i);
      await vscode.evaluateInHost(async (vscode) => vscode.commands.executeCommand('notifications.clearAll'));
      await openConfigPanel(frame);
      const scriptTab = frame.locator('.tab-label', { hasText: 'Script' });
      await expect.poll(() => scriptTab.count(), { timeout: 30_000 }).toBeGreaterThan(0);
      await scriptTab.first().click();
      await expect.poll(
        () => frame.evaluate(() => [...document.querySelectorAll('.uniform-name')].map((el) => el.textContent)),
        { message: 'the panel never listed the script uniform', timeout: 30_000 },
      ).toContain('uGood');
      await expect.poll(
        () => frame.evaluate(() => [...document.querySelectorAll('.uniform-value')].map((el) => el.textContent?.trim())),
        { message: 'the panel listed the script uniform without its constant value', timeout: 30_000 },
      ).toContain('0.500');
      expect(await frame.locator('.uniforms-empty').count()).toBe(0);
    });

    test('names the missing script alongside the undeclared uniform, and clears once the script exists', async ({ vscode }) => {
      rmSync(scenario.missingScriptPath, { force: true });
      const frame = await open(vscode, scenario.missingScriptShaderPath);
      await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);
      await expect.poll(() => tooltipText(frame), { message: 'the undeclared uniform was never reported', timeout: 90_000 }).toContain('iDayOfWeek');
      await expect.poll(() => tooltipText(frame), { message: 'the report never named the script that failed to load', timeout: 30_000 })
        .toContain(`Script file not found: ${scenario.scriptReference}`);
      writeFileSync(scenario.missingScriptPath, scenario.repairScript, 'utf8');
      await vscode.evaluateInHost(async (vscode, targetPath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        const editor = await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), '\n'));
        await editor.edit((builder) => builder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0))));
      }, scenario.missingScriptShaderPath);
      const pause = frame.getByLabel('Toggle pause', { exact: true });
      await expect(pause).toBeVisible();
      await expect(pause, 'the shader never compiled once its script existed').not.toHaveClass(/error/);
    });
  });
}
