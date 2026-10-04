import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { revertFixtureEditors } from './editor-actions.mjs';

const fixtureDir = join(workspacePath, `panel-focus-${process.env.TEST_WORKER_INDEX ?? process.pid}`);
const shaderPath = join(fixtureDir, 'typing.glsl');
const typed = '  // typed while the preview settles';

test.use({ vscodeKey: 'panel-focus-typing' });

test('opening the preview does not take keyboard focus from typing in the shader editor', async ({ vscode }) => {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(shaderPath, 'void mainImage(out vec4 color, in vec2 coord) {\n  color = vec4(0.0, 1.0, 0.0, 1.0);\n}\n');
  try {
    await vscode.evaluateInHost(async (vscode, path) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);
    // The user returns to the shader straight away and keeps typing while the
    // new preview panel settles into its editor group.
    const line = vscode.window.locator('.monaco-editor .view-line').filter({ hasText: 'color = vec4(0.0, 1.0, 0.0, 1.0);' });
    await line.click();
    await vscode.window.keyboard.press('End');
    await vscode.window.keyboard.press('Enter');
    for (const character of typed.trimStart()) {
      await vscode.window.keyboard.type(character);
      await vscode.window.waitForTimeout(60);
    }
    await expect.poll(() => vscode.evaluateInHost((vscode, path) => (
      vscode.workspace.textDocuments.find((document) => document.uri.fsPath === vscode.Uri.file(path).fsPath)?.getText() ?? ''
    ), shaderPath)).toContain(typed.trimStart());
    expect(await vscode.evaluateInHost(vscode => vscode.window.tabGroups.activeTabGroup.viewColumn)).toBe(1);
    await vscode.window.keyboard.press('ControlOrMeta+S');
    await expect.poll(() => readFileSync(shaderPath, 'utf8')).toContain(typed.trimStart());
  } finally {
    await revertFixtureEditors(vscode, fixtureDir);
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
