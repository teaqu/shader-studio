import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { revertFixtureEditors } from './editor-actions.mjs';

const fixtureDir = join(workspacePath, `panel-locking-${process.env.TEST_WORKER_INDEX ?? process.pid}`);
const shaderPath = join(fixtureDir, 'typing.glsl');

// Closing the focus scenario's locked editor group is asynchronous inside VS
// Code. Its own spec gives this independent race regression a fresh host.
test.use({ vscodeKey: 'panel-focus-locking' });

test('preview remains available while another file opens before its group is activated and locked', async ({ vscode }) => {
  mkdirSync(fixtureDir, { recursive: true });
  const otherPath = join(fixtureDir, 'other.glsl');
  writeFileSync(shaderPath, 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0,1,0,1); }');
  writeFileSync(otherPath, 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1,0,0,1); }');
  try {
    await vscode.evaluateInHost(async (vscode, paths) => {
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
