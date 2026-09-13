import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { revertFixtureEditors } from './editor-actions.mjs';

const fixtureDir = join(workspacePath, `panel-focus-${process.env.TEST_WORKER_INDEX ?? process.pid}`);
const shaderPath = join(fixtureDir, 'typing.glsl');
const typed = '  // typed while the preview settles';

test.use({ vscodeKey: 'panel-focus' });

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
      vscode.workspace.textDocuments.find((document) => document.uri.fsPath === path)?.getText() ?? ''
    ), shaderPath)).toContain(typed.trimStart());
    expect(await vscode.evaluateInHost(vscode => vscode.window.tabGroups.activeTabGroup.viewColumn)).toBe(1);
    await vscode.window.keyboard.press('ControlOrMeta+S');
    await expect.poll(() => readFileSync(shaderPath, 'utf8')).toContain(typed.trimStart());
  } finally {
    await revertFixtureEditors(vscode, fixtureDir);
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});


test('preview remains available while another file opens before its group is activated and locked', async ({ vscode }) => {
  mkdirSync(fixtureDir, { recursive: true });
  const otherPath = join(fixtureDir, 'other.glsl');
  writeFileSync(shaderPath, 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0,1,0,1); }');
  writeFileSync(otherPath, 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1,0,0,1); }');
  try {
    await vscode.evaluateInHost(async (vscode, paths) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const shader = await vscode.workspace.openTextDocument(vscode.Uri.file(paths[0]));
      await vscode.window.showTextDocument(shader, { viewColumn: vscode.ViewColumn.One, preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
      const other = await vscode.workspace.openTextDocument(vscode.Uri.file(paths[1]));
      await vscode.window.showTextDocument(other, { preview: true });
    }, [shaderPath, otherPath]);
    const frame = await vscode.shaderFrame();
    await expect(frame.locator('.canvas-container')).toBeVisible();
    expect(await vscode.evaluateInHost(vscode => ({
      active: vscode.window.activeTextEditor?.document.uri.fsPath,
      previews: vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.label === 'Shader Studio').length,
    }))).toEqual({ active: otherPath, previews: 1 });
    const previewGroup = vscode.window.locator('.editor-group-container').filter({ has: vscode.window.getByRole('tab', { name: /Shader Studio, Editor Group/ }) });
    await expect(previewGroup).not.toHaveClass(/locked/);
    await vscode.window.getByRole('tab', { name: /Shader Studio, Editor Group/ }).click();
    await expect(previewGroup).toHaveClass(/locked/);
    // Opening from the now-active preview group must keep the preview in place.
    await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(document, { preview: true });
    }, shaderPath);
    await expect(frame.locator('.canvas-container')).toBeVisible();
    expect(await vscode.evaluateInHost(vscode => vscode.window.tabGroups.all
      .filter(group => group.tabs.some(tab => tab.label === 'Shader Studio'))
      .map(group => group.tabs.map(tab => tab.label)))).toEqual([['Shader Studio']]);
  } finally {
    await revertFixtureEditors(vscode, fixtureDir);
    await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
