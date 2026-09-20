import { test, expect, workspacePath } from './fixtures.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectCanvasPixels, revertFixtureEditors } from './editor-actions.mjs';

const fixtureDir = join(workspacePath, `wgsl-entrypoint-${process.env.TEST_WORKER_INDEX ?? process.pid}`);
test.use({ vscodeKey: 'wgsl-entrypoint' });

test('opens a WGSL entry point with a return type before and after reloading VS Code @gpu', async ({ vscode }) => {
  mkdirSync(fixtureDir, { recursive: true });
  const path = join(fixtureDir, 'entry.wgsl');
  writeFileSync(path, 'fn mainImage(p: vec2f) -> vec4<f32> { return commonGreen(); }\n');
  writeFileSync(join(fixtureDir, 'common.wgsl'), 'fn commonGreen() -> vec4f { return vec4f(0, 1, 0, 1); }\n');
  writeFileSync(join(fixtureDir, 'entry.sha.json'), JSON.stringify({ version: '1', passes: { common: { path: 'common.wgsl' }, Image: { inputs: {} } } }));
  try {
    await vscode.evaluateInHost(async (vscode, path) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(document, { preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
    }, path);
    await expectCanvasPixels(await vscode.shaderFrame(), [0, 255, 0]);
    const frame = await vscode.shaderFrame();
    await vscode.window.keyboard.press('F1');
    await vscode.window.locator('.quick-input-widget input').fill('>Developer: Reload Window');
    await vscode.window.keyboard.press('Enter');
    await expect.poll(() => frame.isDetached()).toBe(true);
    // Shader Studio has no webview serializer. Reopen the saved shader using
    // the public command after reloading, as in the existing WGSL host flow.
    await vscode.evaluateInHost(async (vscode, path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.window.showTextDocument(document, { preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
    }, path);
    await expectCanvasPixels(await vscode.shaderFrame(), [0, 255, 0]);
  } finally {
    await revertFixtureEditors(vscode, fixtureDir);
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
