import { test, expect, workspacePath } from './fixtures.mjs';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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


test('persists per-pass viewer camera overrides and follows VS Code settings through reload @gpu', async ({ vscode }) => {
  mkdirSync(fixtureDir, { recursive: true });
  const path = join(fixtureDir, 'camera.wgsl');
  const configPath = join(fixtureDir, 'camera.sha.json');
  writeFileSync(path, 'fn mainVertex(p: ptr<function, vec3f>, n: ptr<function, vec3f>, uv: ptr<function, vec2f>) { *p *= 0.65; }\nfn mainImage(p: vec2f) -> vec4f { return vec4f(0.8, 0.2, 0.1, 1); }\n');
  writeFileSync(configPath, JSON.stringify({ version: '1.0', passes: { Image: { geometry: { type: 'cube' } } } }));
  const previous = await vscode.evaluateInHost(vscode => vscode.workspace.getConfiguration('shader-studio').inspect('webgpu.useViewerCamera')?.globalValue);
  const open = () => vscode.evaluateInHost(async (vscode, path) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('shader-studio.view');
  }, path);
  try {
    await vscode.evaluateInHost(async vscode => vscode.workspace.getConfiguration('shader-studio').update('webgpu.useViewerCamera', true, vscode.ConfigurationTarget.Global));
    await open();
    let frame = await vscode.shaderFrame();
    await frame.getByLabel('Toggle config panel', { exact: true }).click();
    const pass = () => frame.getByLabel('Use viewer camera', { exact: true });
    const shaderDefaults = () => frame.getByText('Viewer camera defaults', { exact: true });
    const shaderCamera = () => frame.getByLabel('Shader viewer camera', { exact: true });
    await expect(shaderDefaults()).toHaveCount(0);
    await expect(shaderCamera()).toHaveCount(0);
    await expect(pass()).toBeChecked();
    await vscode.evaluateInHost(async vscode => vscode.workspace.getConfiguration('shader-studio').update('webgpu.useViewerCamera', false, vscode.ConfigurationTarget.Global));
    await expect(pass()).not.toBeChecked();
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.workspace.getConfiguration('shader-studio').inspect('webgpu.useViewerCamera')?.globalValue)).toBe(false);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).webgpu).toBeUndefined();
    expect(JSON.parse(readFileSync(configPath, 'utf8')).passes.Image.useViewerCamera).toBeUndefined();
    await pass().check();
    await expect(pass()).toBeChecked();
    await expect.poll(() => JSON.parse(readFileSync(configPath, 'utf8')).passes.Image.useViewerCamera).toBe(true);
    await vscode.evaluateInHost(async vscode => {
      setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
    });
    await expect.poll(() => frame.isDetached()).toBe(true);
    await open();
    frame = await vscode.shaderFrame();
    if (!await pass().isVisible()) {
      await frame.getByLabel('Toggle config panel', { exact: true }).click();
    }
    await expect(pass()).toBeChecked();
    await expect(shaderDefaults()).toHaveCount(0);
    await expect(shaderCamera()).toHaveCount(0);
    await frame.getByRole('button', { name: 'Use default', exact: true }).click();
    await expect(pass()).not.toBeChecked();
    await expect.poll(() => JSON.parse(readFileSync(configPath, 'utf8')).passes.Image.useViewerCamera).toBeUndefined();
    await vscode.evaluateInHost(async vscode => vscode.workspace.getConfiguration('shader-studio').update('webgpu.useViewerCamera', true, vscode.ConfigurationTarget.Global));
    await expect(pass()).toBeChecked();
  } finally {
    await vscode.evaluateInHost(async (vscode, previous) => vscode.workspace.getConfiguration('shader-studio').update('webgpu.useViewerCamera', previous ?? undefined, vscode.ConfigurationTarget.Global), previous);
    await revertFixtureEditors(vscode, fixtureDir);
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
