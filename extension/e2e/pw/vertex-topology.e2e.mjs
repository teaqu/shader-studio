import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { openConfigPanel } from './config-panel.mjs';

test.setTimeout(90_000);
test.use({ vscodeKey: 'vertex-topology' });

const IMAGE = {
  glsl: 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }',
  slang: 'float4 mainImage(float2 coord) { return float4(1.0); }',
  wgsl: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }',
};

// Six hexagon corners ordered so consecutive triples tile it as a strip.
const HEXAGON = {
  glsl: `const vec2 points[6] = vec2[6](vec2(0.25, 0.433), vec2(-0.25, 0.433), vec2(0.5, 0.0), vec2(-0.5, 0.0), vec2(0.25, -0.433), vec2(-0.25, -0.433));
void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
  position = vec3(points[vertexIndex], 0.0);
}`,
  slang: `static const float2 points[6] = { float2(0.25, 0.433), float2(-0.25, 0.433), float2(0.5, 0.0), float2(-0.5, 0.0), float2(0.25, -0.433), float2(-0.25, -0.433) };
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  position = float3(points[vertexIndex], 0.0);
}`,
  wgsl: `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  var points = array<vec2f, 6>(vec2f(0.25, 0.433), vec2f(-0.25, 0.433), vec2f(0.5, 0.0), vec2f(-0.5, 0.0), vec2f(0.25, -0.433), vec2f(-0.25, -0.433));
  *position = vec3f(points[vertexIndex], 0.0);
}`,
};

/** RGB of the presented canvas at fractional position (fx, fy), y from the top. */
async function pixelAt(frame, fx, fy) {
  const screenshot = await frame.locator('.canvas-container canvas').first().screenshot();
  return frame.evaluate(async ([base64, x, y]) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return [...context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data].slice(0, 3);
    } finally {
      bitmap.close();
    }
  }, [screenshot.toString('base64'), fx, fy]);
}

const isWhite = ([r, g, b]) => r > 200 && g > 200 && b > 200;
const isBlack = ([r, g, b]) => r < 40 && g < 40 && b < 40;

/** Centre covered; above the flat top and in the corner left black. */
async function expectHexagon(frame) {
  await expect.poll(async () => isWhite(await pixelAt(frame, 0.5, 0.5)), { message: 'hexagon centre not drawn', timeout: 30_000 }).toBe(true);
  await expect.poll(async () => isBlack(await pixelAt(frame, 0.5, 0.15)), { message: 'pixel above the hexagon covered' }).toBe(true);
  await expect.poll(async () => isBlack(await pixelAt(frame, 0.05, 0.05)), { message: 'corner covered' }).toBe(true);
}

async function openShader(vscode, path) {
  await vscode.evaluateInHost(async (vscode, path) => {
    const previews = vscode.window.tabGroups.all.flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputWebview);
    await vscode.window.tabGroups.close(previews);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand('shader-studio.view');
  }, path);
  return vscode.shaderFrame();
}

for (const language of ['glsl', 'slang', 'wgsl']) {
  test.describe(`${language} fullscreen vertexCount and topology in VS Code${language === 'glsl' ? '' : ' @gpu'}`, () => {
    const fixtureDir = join(workspacePath, 'vertex-topology', language);
    const shaderPath = join(fixtureDir, `hexagon.${language}`);
    const vertexPath = join(fixtureDir, `hexagon.vert.${language}`);
    const configPath = join(fixtureDir, 'hexagon.sha.json');
    const geometry = () => JSON.parse(readFileSync(configPath, 'utf8')).passes.Image.geometry;

    test.afterEach(async ({ vscode }) => {
      await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    test('draws a configured hexagon, edits topology in the config panel, and keeps it after reload', async ({ vscode }) => {
      rmSync(fixtureDir, { recursive: true, force: true });
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(shaderPath, IMAGE[language]);
      writeFileSync(vertexPath, HEXAGON[language]);
      writeFileSync(configPath, JSON.stringify({
        version: '1.0',
        passes: { Image: { vertex: `hexagon.vert.${language}`, geometry: { type: 'fullscreen', vertexCount: 6, topology: 'triangle-strip' } } },
      }, null, 2));

      let frame = await openShader(vscode, shaderPath);
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
      await expectHexagon(frame);

      // The config panel shows the configured fields for the fullscreen Image pass.
      await openConfigPanel(frame);
      await expect(frame.locator('.config-panel')).toBeVisible();
      await frame.getByRole('button', { name: 'Image', exact: true }).click();
      await expect(frame.getByLabel('Vertices')).toHaveValue('6');
      await expect(frame.getByLabel('Topology')).toHaveValue('triangle-strip');

      // Six 1px points leave the centre uncovered.
      await frame.getByLabel('Topology').selectOption('point-list');
      await expect.poll(geometry).toEqual({ type: 'fullscreen', vertexCount: 6, topology: 'point-list' });
      await expect.poll(async () => isBlack(await pixelAt(frame, 0.5, 0.5)), { message: 'points still fill the centre', timeout: 30_000 }).toBe(true);

      // Back to the strip.
      await frame.getByLabel('Topology').selectOption('triangle-strip');
      await expect.poll(geometry).toEqual({ type: 'fullscreen', vertexCount: 6, topology: 'triangle-strip' });
      await expectHexagon(frame);

      // Invalid counts are rejected without writing.
      await frame.getByLabel('Vertices').fill('0');
      await frame.getByLabel('Vertices').dispatchEvent('change');
      await expect(frame.getByRole('alert')).toContainText('Vertex count must be a whole number from 1 to 2147483647');
      expect(geometry()).toEqual({ type: 'fullscreen', vertexCount: 6, topology: 'triangle-strip' });

      // The edit persists across a window reload.
      await vscode.evaluateInHost(vscode => {
        setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
      });
      await expect.poll(() => frame.isDetached(), { timeout: 30_000 }).toBe(true);
      frame = await openShader(vscode, shaderPath);
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
      await expectHexagon(frame);
      await openConfigPanel(frame);
      await frame.getByRole('button', { name: 'Image', exact: true }).click();
      await expect(frame.getByLabel('Vertices')).toHaveValue('6');
      await expect(frame.getByLabel('Topology')).toHaveValue('triangle-strip');

      // Switching to a mesh drops both fields and hides the controls.
      await frame.getByLabel('Geometry').selectOption('cube');
      await expect.poll(geometry).toEqual({ type: 'cube' });
      await expect(frame.getByLabel('Vertices')).toBeHidden();
      await expect(frame.getByLabel('Topology')).toBeHidden();
    });

    test('reports vertexCount on mesh geometry as a config error', async ({ vscode }) => {
      rmSync(fixtureDir, { recursive: true, force: true });
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(shaderPath, IMAGE[language]);
      writeFileSync(configPath, JSON.stringify({
        version: '1.0',
        passes: { Image: { geometry: { type: 'sphere', vertexCount: 6 } } },
      }, null, 2));

      const frame = await openShader(vscode, shaderPath);
      const pause = frame.getByLabel('Toggle pause', { exact: true });
      await expect(pause).toHaveClass(/error/, { timeout: 30_000 });
      await pause.hover();
      await expect(frame.locator('.error-tooltip.visible'))
        .toContainText('vertexCount is only supported for fullscreen geometry, not sphere');
    });
  });
}
