import { test, expect, workspacePath } from './fixtures.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { expectCanvasPixels } from './editor-actions.mjs';

const fixtureDir = join(workspacePath, `capture-preview-${process.pid}`);
test.use({ vscodeKey: 'capture-preview', fakeMediaDevices: true });

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('opens a synced capture preview inside VS Code @gpu', async ({ vscode }) => {
  const available = await vscode.evaluateInHost(async vscode => (await vscode.commands.getCommands(true)).includes('workbench.action.browser.open'));
  test.skip(!available, 'This VS Code version uses the external-browser fallback, covered by unit tests.');
  mkdirSync(fixtureDir, { recursive: true });
  const shaderPath = join(fixtureDir, 'capture.glsl');
  writeFileSync(shaderPath, 'void mainImage(out vec4 c, in vec2 p) { float wave = texture(sound.sampler, vec2(.5,.75)).r; vec3 frame = texture(camera.sampler, vec2(.5)).rgb; bool ok = sound.loaded == 1 && sound.size.x == 512. && sound.size.y == 2. && camera.loaded == 1 && camera.size.x > 0. && wave > .1 && dot(frame,frame) > 0.; c = ok ? vec4(0,1,0,1) : vec4(1,0,0,1); }');
  writeFileSync(join(fixtureDir, 'capture.sha.json'), JSON.stringify({ version: '1', passes: { Image: { inputs: { camera: { type: 'webcam' }, sound: { type: 'microphone' }, music: { type: 'microphone' } } } } }));
  const port = await freePort();
  try {
    await vscode.evaluateInHost(async (vscode, shaderPath, port) => {
      await vscode.workspace.getConfiguration('shader-studio').update('webServerPort', port, vscode.ConfigurationTarget.Global);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(shaderPath));
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('shader-studio.openCapturePreview');
    }, shaderPath, port);
    await expect.poll(async () => (await vscode.app.windows()).map(page => page.url()).some(url => url.startsWith(`http://localhost:${port}`))).toBe(true);
    const page = (await vscode.app.windows()).find(page => page.url().startsWith(`http://localhost:${port}`));
    await expectCanvasPixels(page, [0, 255, 0]);
    expect(await page.evaluate(() => ({
      camera: document.permissionsPolicy?.allowsFeature('camera') ?? document.featurePolicy?.allowsFeature('camera'),
      microphone: document.permissionsPolicy?.allowsFeature('microphone') ?? document.featurePolicy?.allowsFeature('microphone'),
      capture: typeof navigator.mediaDevices?.getUserMedia,
    }))).toEqual({ camera: true, microphone: true, capture: 'function' });
    await page.getByLabel('Toggle config panel').click();
    for (const type of ['webcam', 'mic']) {
      const preview = page.getByLabel(`Live ${type} preview`).first();
      await expect(preview).toBeVisible();
      await expect.poll(() => preview.evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 !== 3 && value > 0))).toBe(true);
    }
    await page.locator('.channel-row').filter({ hasText: 'music' }).click();
    await page.getByLabel('Audio device').selectOption('default');
    await page.getByRole('button', { name: 'Change device', exact: true }).click();
    const musicPreview = page.getByLabel('Live mic preview').first();
    await expect(musicPreview).toBeVisible();
    await expect.poll(() => musicPreview.evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 !== 3 && value > 0))).toBe(true);
    await page.getByRole('button', { name: 'Stop mic', exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await vscode.evaluateInHost(async (vscode, shaderPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(shaderPath));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1, 0, 0, 1); }');
      await vscode.workspace.applyEdit(edit);
      await document.save();
    }, shaderPath);
    await expectCanvasPixels(page, [255, 0, 0]);
  } finally {
    await vscode.evaluateInHost(async vscode => {
      await vscode.commands.executeCommand('shader-studio.stopWebServer');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.getConfiguration('shader-studio').update('webServerPort', undefined, vscode.ConfigurationTarget.Global);
    });
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
