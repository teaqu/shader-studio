import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { openConfigPanel } from './config-panel.mjs';

test.setTimeout(90_000);
test.use({ vscodeKey: 'vertex-topology' });

// White at half alpha: opaque white without blending, mid grey over black with alpha blending.
const IMAGE = {
  glsl: 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0, 1.0, 1.0, 0.5); }',
  slang: 'float4 mainImage(float2 coord) { return float4(1.0, 1.0, 1.0, 0.5); }',
  wgsl: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0, 1.0, 1.0, 0.5); }',
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

// The hexagon, except every vertex of instance 0 collapses: only a second instance can draw it.
const HEXAGON_SKIPPING_FIRST_INSTANCE = {
  glsl: HEXAGON.glsl.replace(/\n}$/, '\n  if (iInstanceIndex == 0) { position = vec3(0.0); }\n}'),
  slang: HEXAGON.slang.replace(/\n}$/, '\n  if (iInstanceIndex == 0u) { position = float3(0.0); }\n}'),
  wgsl: HEXAGON.wgsl.replace(/\n}$/, '\n  if (iInstanceIndex == 0u) { *position = vec3f(0.0); }\n}'),
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
const isGrey = ([r, g, b]) => [r, g, b].every((channel) => channel > 100 && channel < 160);

/** Centre covered; above the flat top and in the corner left black. */
async function expectHexagon(frame) {
  await expect.poll(async () => isWhite(await pixelAt(frame, 0.5, 0.5)), { message: 'hexagon centre not drawn', timeout: 30_000 }).toBe(true);
  await expect.poll(async () => isBlack(await pixelAt(frame, 0.5, 0.15)), { message: 'pixel above the hexagon covered' }).toBe(true);
  await expect.poll(async () => isBlack(await pixelAt(frame, 0.05, 0.05)), { message: 'corner covered' }).toBe(true);
}

async function expectCentre(frame, predicate, message) {
  await expect.poll(async () => predicate(await pixelAt(frame, 0.5, 0.5)), { message, timeout: 30_000 }).toBe(true);
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
  test.describe(`${language} vertices geometry, blend, depth and cull in VS Code${language === 'glsl' ? '' : ' @gpu'}`, () => {
    const fixtureDir = join(workspacePath, 'vertex-topology', language);
    const shaderPath = join(fixtureDir, `hexagon.${language}`);
    const vertexPath = join(fixtureDir, `hexagon.vert.${language}`);
    const configPath = join(fixtureDir, 'hexagon.sha.json');
    const image = () => JSON.parse(readFileSync(configPath, 'utf8')).passes.Image;
    const writeConfig = (Image) => writeFileSync(configPath, JSON.stringify({ version: '1.0', passes: { Image } }, null, 2));
    const CLIP_STRIP = { type: 'vertices', vertexCount: 6, topology: 'triangle-strip', space: 'clip' };

    test.afterEach(async ({ vscode }) => {
      await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    test('edits vertices, blend, depth and cull in the config panel, keeps them after reload, and restores vertices fields after a mesh', async ({ vscode }) => {
      rmSync(fixtureDir, { recursive: true, force: true });
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(shaderPath, IMAGE[language]);
      writeFileSync(vertexPath, HEXAGON[language]);
      writeConfig({ vertex: `hexagon.vert.${language}`, geometry: CLIP_STRIP });

      let frame = await openShader(vscode, shaderPath);
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
      await expectHexagon(frame);

      // The config panel shows the configured vertices fields and the clip-space defaults.
      await openConfigPanel(frame);
      await expect(frame.locator('.config-panel')).toBeVisible();
      await frame.getByRole('button', { name: 'Image', exact: true }).click();
      await expect(frame.getByLabel('Geometry')).toHaveValue('vertices');
      await expect(frame.getByLabel('Vertices')).toHaveValue('6');
      await expect(frame.getByLabel('Topology')).toHaveValue('triangle-strip');
      await expect(frame.getByLabel('Space')).toHaveValue('clip');
      await expect(frame.getByLabel('Blend')).toHaveValue('none');
      await expect(frame.getByLabel('Depth test')).not.toBeChecked();
      await expect(frame.getByLabel('Depth write')).toBeChecked();
      await expect(frame.getByLabel('Compare')).toBeDisabled();
      await expect(frame.getByLabel('Cull')).toHaveValue('none');

      // Topology: six 1px points leave the centre uncovered.
      await frame.getByLabel('Topology').selectOption('point-list');
      await expect.poll(image).toMatchObject({ geometry: { ...CLIP_STRIP, topology: 'point-list' } });
      await expectCentre(frame, isBlack, 'points still fill the centre');
      await frame.getByLabel('Topology').selectOption('triangle-strip');
      await expect.poll(image).toMatchObject({ geometry: CLIP_STRIP });
      await expectHexagon(frame);

      // Vertex count: three vertices draw only the top triangle, above the centre.
      await frame.getByLabel('Vertices').fill('3');
      await frame.getByLabel('Vertices').dispatchEvent('change');
      await expect.poll(image).toMatchObject({ geometry: { ...CLIP_STRIP, vertexCount: 3 } });
      await expectCentre(frame, isBlack, 'a three-vertex strip still covers the centre');
      await frame.getByLabel('Vertices').fill('6');
      await frame.getByLabel('Vertices').dispatchEvent('change');
      await expect.poll(image).toMatchObject({ geometry: CLIP_STRIP });
      await expectHexagon(frame);

      // Invalid counts are rejected without writing.
      await frame.getByLabel('Vertices').fill('0');
      await frame.getByLabel('Vertices').dispatchEvent('change');
      await expect(frame.getByRole('alert')).toContainText('Vertex count must be a whole number from 1 to 2147483647');
      expect(image().geometry).toEqual(CLIP_STRIP);
      await frame.getByLabel('Vertices').fill('6');
      await frame.getByLabel('Vertices').dispatchEvent('change');

      // Space: world space is the default, so choosing it removes the field;
      // the hexagon at the origin still lands on the centre under the orbit camera.
      await frame.getByLabel('Space').selectOption('world');
      await expect.poll(image).toMatchObject({ geometry: { type: 'vertices', vertexCount: 6, topology: 'triangle-strip' } });
      expect(image().geometry).not.toHaveProperty('space');
      await expect(frame.getByLabel('Depth test')).toBeChecked();
      await expectCentre(frame, isWhite, 'world-space hexagon not drawn at the centre');
      await frame.getByLabel('Space').selectOption('clip');
      await expect.poll(image).toMatchObject({ geometry: CLIP_STRIP });

      // Blend: alpha blends the half-alpha white over black.
      await frame.getByLabel('Blend').selectOption('alpha');
      await expect.poll(image).toMatchObject({ blend: 'alpha' });
      await expectCentre(frame, isGrey, 'alpha blending did not darken the hexagon');
      await frame.getByLabel('Blend').selectOption('none');
      await expect.poll(() => image().blend).toBeUndefined();
      await expectCentre(frame, isWhite, 'blend none did not overwrite');

      // Depth: turning the test on and comparing with never hides everything.
      await frame.getByLabel('Depth test').check();
      await expect.poll(image).toMatchObject({ depth: { test: true } });
      await expect(frame.getByLabel('Compare')).toBeEnabled();
      await frame.getByLabel('Compare').selectOption('never');
      await expect.poll(image).toMatchObject({ depth: { test: true, compare: 'never' } });
      await expectCentre(frame, isBlack, 'compare never still drew the hexagon');
      await frame.getByLabel('Compare').selectOption('less');
      await expect.poll(() => image().depth).toEqual({ test: true });
      await expectCentre(frame, isWhite, 'compare less did not draw the hexagon');
      await frame.getByLabel('Depth test').uncheck();
      await expect.poll(() => image().depth).toBeUndefined();
      await frame.getByLabel('Depth write').uncheck();
      await expect.poll(() => image().depth).toEqual({ write: false });

      // Cull: the strip winds counter-clockwise, so culling front faces hides it.
      await frame.getByLabel('Cull').selectOption('front');
      await expect.poll(image).toMatchObject({ cull: 'front' });
      await expectCentre(frame, isBlack, 'cull front kept the counter-clockwise hexagon');
      await frame.getByLabel('Cull').selectOption('back');
      await expect.poll(image).toMatchObject({ cull: 'back' });
      await expectCentre(frame, isWhite, 'cull back removed the counter-clockwise hexagon');

      // Everything persists across a window reload.
      await frame.getByLabel('Blend').selectOption('alpha');
      await expect.poll(image).toMatchObject({ blend: 'alpha' });
      const persisted = { vertex: `hexagon.vert.${language}`, geometry: CLIP_STRIP, blend: 'alpha', depth: { write: false }, cull: 'back' };
      expect(image()).toEqual(persisted);
      await vscode.evaluateInHost(vscode => {
        setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
      });
      await expect.poll(() => frame.isDetached(), { timeout: 30_000 }).toBe(true);
      frame = await openShader(vscode, shaderPath);
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
      await expectCentre(frame, isGrey, 'alpha-blended hexagon not drawn after reload');
      await openConfigPanel(frame);
      await frame.getByRole('button', { name: 'Image', exact: true }).click();
      await expect(frame.getByLabel('Vertices')).toHaveValue('6');
      await expect(frame.getByLabel('Topology')).toHaveValue('triangle-strip');
      await expect(frame.getByLabel('Space')).toHaveValue('clip');
      await expect(frame.getByLabel('Blend')).toHaveValue('alpha');
      await expect(frame.getByLabel('Depth write')).not.toBeChecked();
      await expect(frame.getByLabel('Cull')).toHaveValue('back');

      // Switching to a cube drops the vertices fields and hides their controls,
      // keeping blend, depth and cull, which meshes accept.
      await frame.getByLabel('Geometry').selectOption('cube');
      await expect.poll(image).toEqual({ ...persisted, geometry: { type: 'cube' } });
      await expect(frame.getByLabel('Vertices')).toBeHidden();
      await expect(frame.getByLabel('Space')).toBeHidden();
      await expect(frame.getByLabel('Cull')).toBeVisible();

      // Switching back restores the vertices fields from session memory.
      await frame.getByLabel('Geometry').selectOption('vertices');
      await expect.poll(image).toEqual(persisted);
      await expect(frame.getByLabel('Vertices')).toHaveValue('6');
      await expect(frame.getByLabel('Topology')).toHaveValue('triangle-strip');
      await expect(frame.getByLabel('Space')).toHaveValue('clip');
      await expectCentre(frame, isGrey, 'restored hexagon not drawn');

      // Fullscreen keeps blend but has no depth or cull controls.
      await frame.getByLabel('Geometry').selectOption('fullscreen');
      await expect.poll(image).toEqual({ vertex: `hexagon.vert.${language}`, blend: 'alpha' });
      await expect(frame.getByLabel('Blend')).toBeVisible();
      await expect(frame.getByLabel('Cull')).toBeHidden();
      await expect(frame.getByLabel('Depth test')).toBeHidden();
    });

    test('sets the instance count in the config panel, draws every instance, and keeps it after reload', async ({ vscode }) => {
      rmSync(fixtureDir, { recursive: true, force: true });
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(shaderPath, IMAGE[language]);
      writeFileSync(vertexPath, HEXAGON_SKIPPING_FIRST_INSTANCE[language]);
      writeConfig({ vertex: `hexagon.vert.${language}`, geometry: CLIP_STRIP });

      let frame = await openShader(vscode, shaderPath);
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
      // One instance, and it is collapsed.
      await expectCentre(frame, isBlack, 'the collapsed first instance drew the hexagon');

      await openConfigPanel(frame);
      await frame.getByRole('button', { name: 'Image', exact: true }).click();
      await expect(frame.getByLabel('Instances')).toHaveValue('');
      await expect(frame.getByLabel('Instances')).toHaveAttribute('placeholder', '1');

      // Two instances: the second draws the hexagon.
      await frame.getByLabel('Instances').fill('2');
      await frame.getByLabel('Instances').dispatchEvent('change');
      await expect.poll(image).toMatchObject({ geometry: { ...CLIP_STRIP, instanceCount: 2 } });
      await expectHexagon(frame);

      // Invalid counts are rejected without writing.
      await frame.getByLabel('Instances').fill('0');
      await frame.getByLabel('Instances').dispatchEvent('change');
      await expect(frame.getByRole('alert')).toContainText('Instance count must be a whole number from 1 to 2147483647');
      expect(image().geometry).toEqual({ ...CLIP_STRIP, instanceCount: 2 });

      // The count persists across a window reload.
      await vscode.evaluateInHost(vscode => {
        setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
      });
      await expect.poll(() => frame.isDetached(), { timeout: 30_000 }).toBe(true);
      frame = await openShader(vscode, shaderPath);
      await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
      await expectHexagon(frame);
      await openConfigPanel(frame);
      await frame.getByRole('button', { name: 'Image', exact: true }).click();
      await expect(frame.getByLabel('Instances')).toHaveValue('2');

      // Fullscreen draws once: the field is dropped and the control hidden, then restored.
      await frame.getByLabel('Geometry').selectOption('fullscreen');
      await expect.poll(() => image().geometry).toBeUndefined();
      await expect(frame.getByLabel('Instances')).toBeHidden();
      await frame.getByLabel('Geometry').selectOption('vertices');
      await expect.poll(image).toMatchObject({ geometry: { ...CLIP_STRIP, instanceCount: 2 } });
      await expect(frame.getByLabel('Instances')).toHaveValue('2');

      // Clearing the count returns to the single collapsed instance.
      await frame.getByLabel('Instances').fill('');
      await frame.getByLabel('Instances').dispatchEvent('change');
      await expect.poll(() => image().geometry).toEqual(CLIP_STRIP);
      await expectCentre(frame, isBlack, 'clearing the instance count kept the second instance');
    });

    test('reports vertices, depth and cull fields on the wrong geometry as config errors', async ({ vscode }) => {
      rmSync(fixtureDir, { recursive: true, force: true });
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(shaderPath, IMAGE[language]);
      const cases = [
        [{ geometry: { type: 'sphere', vertexCount: 6 } }, 'vertexCount is only supported for vertices geometry, not sphere'],
        [{ geometry: { type: 'fullscreen', space: 'clip' } }, 'space is only supported for vertices geometry, not fullscreen'],
        [{ cull: 'back' }, 'cull is not supported for fullscreen geometry'],
        [{ geometry: { type: 'fullscreen' }, depth: { write: false } }, 'depth is not supported for fullscreen geometry'],
        [{ geometry: { type: 'fullscreen', instanceCount: 2 } }, 'instanceCount is not supported for fullscreen geometry'],
        [{ geometry: { type: 'cube', instanceCount: 0 } }, 'instanceCount must be an integer from 1 to 2147483647'],
      ];

      for (const [config, message] of cases) {
        writeConfig(config);
        const frame = await openShader(vscode, shaderPath);
        const pause = frame.getByLabel('Toggle pause', { exact: true });
        await expect(pause).toHaveClass(/error/, { timeout: 30_000 });
        await pause.hover();
        await expect(frame.locator('.error-tooltip.visible')).toContainText(message);
      }
    });
  });
}
