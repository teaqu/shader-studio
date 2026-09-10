import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const shaderPath = join(workspacePath, 'glsl-rename-boundary.glsl');
const source = 'float tone(float value) { return value * 0.5; }\nvoid mainImage(out vec4 color, vec2 coord) { color = vec4(tone(coord.x)); }\n';

test.use({ vscodeKey: 'glsl-rename-boundary' });

test('renames a GLSL reference selected through the editor', async ({ vscode }) => {
  try {
    writeFileSync(shaderPath, source);
    await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
      return true;
    }, shaderPath);
    const window = vscode.window;
    await window.locator('.view-line').getByText('tone', { exact: true }).last().dblclick();
    await window.keyboard.press('F2');
    const input = window.locator('.rename-box input, .rename-input input').first();
    await expect(input).toBeVisible();
    await input.fill('curve');
    await input.press('Enter');
    await expect(window.locator('.view-line').filter({ hasText: /curve\(coord\.x\)/ })).toBeVisible();
    await expect(window.locator('.view-line').filter({ hasText: /float\s+curve\(float/ })).toBeVisible();
    await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await document.save();
      return true;
    }, shaderPath);
    expect(readFileSync(shaderPath, 'utf8')).toBe(source.replaceAll('tone', 'curve'));
  } finally {
    try { rmSync(shaderPath); } catch { /* fixture cleanup */ }
  }
});
