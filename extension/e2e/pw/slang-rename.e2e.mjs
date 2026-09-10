import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

test.use({ vscodeKey: 'slang-rename' });

for (const common of [false, true]) {
  test(`renames a Slang ${common ? 'Common' : 'local'} helper through F2 and saves every reference`, async ({ vscode }) => {
    const basename = `slang-rename-${common ? 'common' : 'local'}`;
    const shaderPath = join(workspacePath, `${basename}.slang`);
    const configPath = join(workspacePath, `${basename}.sha.json`);
    const commonPath = join(workspacePath, `${basename}.common.slang`);
    const declaration = 'float tone(float value) { return value * 0.5; }\n';
    const pass = 'float4 mainImage(float2 coord) { return float4(tone(coord.x)); }\n';
    const source = common ? pass : declaration + pass;
    try {
      writeFileSync(shaderPath, source);
      if (common) writeFileSync(commonPath, declaration);
      writeFileSync(configPath, JSON.stringify({ version: '1.0', passes: {
        ...(common ? { common: { path: `${basename}.common.slang` } } : {}),
        Image: { inputs: {} },
      } }));
      await vscode.evaluateInHost(async (vscode, path) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
        await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
      }, shaderPath);
      await vscode.window.locator('.view-line').getByText('tone', { exact: true }).last().dblclick();
      await vscode.window.keyboard.press('F2');
      const input = vscode.window.locator('.rename-box input').first();
      await expect(input).toBeVisible();
      await input.fill('curve');
      await input.press('Enter');
      await expect(vscode.window.locator('.view-line').filter({ hasText: /curve\(coord\.x\)/ })).toBeVisible();
      await vscode.evaluateInHost(async (vscode, paths) => {
        for (const path of paths) {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
          await document.save();
        }
      }, common ? [shaderPath, commonPath] : [shaderPath]);
      expect(readFileSync(shaderPath, 'utf8')).toBe(source.replaceAll('tone', 'curve'));
      if (common) expect(readFileSync(commonPath, 'utf8')).toBe(declaration.replace('tone', 'curve'));
    } finally {
      await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
      for (const path of [shaderPath, configPath, commonPath]) {
        try { rmSync(path); } catch { /* fixture cleanup */ }
      }
    }
  });
}
