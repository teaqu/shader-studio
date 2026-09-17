import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { replaceSource as edit, expectCanvasPixels as pixels, setPreviewLocked, revertFixtureEditors, unlockPreviewForCleanup } from './editor-actions.mjs';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';

test.use({ vscodeKey: 'named-channels' });
// Workers share one workspace, so each keeps its own fixture directory: a
// repeated run must not delete another worker's texture or config mid-reload.
const fixtureDir = () => join(workspacePath, 'named-channels', `worker-${test.info().parallelIndex}`);
test.beforeEach(async ({ vscode }) => {
  await revertFixtureEditors(vscode, fixtureDir());
  await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
});
test.afterEach(async ({ vscode }) => {
  await revertFixtureEditors(vscode, fixtureDir());
  await expect.poll(() => vscode.evaluateInHost((vscode, directory) => vscode.workspace.textDocuments
    .filter(document => document.isDirty && document.uri.fsPath.startsWith(directory + '/'))
    .map(document => document.uri.fsPath), fixtureDir())).toEqual([]);
  const frame = await vscode.shaderFrame();
  await unlockPreviewForCleanup(vscode, frame);
  await expectPreviewLock(frame, false);
});
async function open(vscode, path) {
  await vscode.evaluateInHost(async (vscode, path) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
  }, path);
}
async function errors(vscode, path) {
  return vscode.evaluateInHost((vscode, path) => vscode.languages.getDiagnostics(vscode.Uri.file(path))
    .filter(d => d.severity === vscode.DiagnosticSeverity.Error).map(d => d.message), path);
}
async function expectPauseTooltip(vscode, frame, text) {
  await frame.getByLabel('Toggle pause', { exact: true }).hover();
  try {
    await expect(frame.locator('.error-tooltip.visible')).toContainText(text, { timeout: 20_000 });
  } catch (failure) {
    const state = await frame.evaluate(() => ({
      buttonHovered: document.querySelector('[aria-label="Toggle pause"]')?.matches(':hover') ?? null,
      buttonClass: document.querySelector('[aria-label="Toggle pause"]')?.className ?? null,
      tooltips: Array.from(document.querySelectorAll('.error-tooltip'), el => `${el.className}: ${el.textContent?.slice(0, 80)}`),
    })).catch(error => ({ evaluateFailed: String(error) }));
    const current = await vscode.shaderFrame(5_000).catch(() => null);
    throw new Error(`${failure.message}\nDIAG ${JSON.stringify({ detached: frame.isDetached(), sameFrame: current === frame, state })}`);
  }
}
async function expectPreviewLock(frame, locked) {
  const lock = frame.locator('button.collapse-lock');
  await expect(lock).toHaveClass(locked ? /active/ : /^(?!.*active)/);
}
async function expectNoNotificationToast(vscode) {
  await expect.poll(() => vscode.window.locator('.notification-toast').count()).toBe(0);
}
async function saveReload(vscode, path, source, frame) {
  await vscode.window.locator('.monaco-editor .view-lines').filter({ visible: true }).first().click();
  await vscode.window.keyboard.press('ControlOrMeta+S');
  await expect.poll(() => readFileSync(path, 'utf8')).toBe(source);
  await vscode.evaluateInHost(vscode => {
    setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
  });
  await expect.poll(() => frame.isDetached()).toBe(true);
  await expectNoNotificationToast(vscode);
  await open(vscode, path);
  await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('shader-studio.view'));
  return vscode.shaderFrame();
}

for (const language of ['glsl', 'slang', 'wgsl']) {
  test(`edits, saves and reloads ${language} named sampling in VS Code`, async ({ vscode }) => {
    const good = language === 'glsl'
      ? 'void mainImage(out vec4 c, in vec2 p) { c = albedo.loaded == 1 && albedo.size.x == 2. && albedo.time == 0. ? texture(albedo.sampler,vec2(0.25)) : vec4(1,0,0,1); }'
      : language === 'slang'
        ? 'float4 mainImage(float2 p) { return albedo.loaded && albedo.size.x == 2 && albedo.time == 0 ? sample2DLevel(albedo.texture, albedo.sampler, float2(0.25), 0) : float4(1,0,0,1); }'
        : 'fn mainImage(p: vec2f) -> vec4f { if (albedo.loaded && albedo.size.x == 2 && albedo.time == 0) { return sample2DLevel(albedoTexture, albedoSampler, vec2f(0.25), 0); } return vec4f(1,0,0,1); }';
    const initial = language === 'glsl' ? 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1,0,0,1); }'
      : language === 'slang' ? 'float4 mainImage(float2 p) { return float4(1,0,0,1); }'
        : 'fn mainImage(p: vec2f) -> vec4f { return vec4f(1,0,0,1); }';
    mkdirSync(fixtureDir(), { recursive: true });
    const path = join(fixtureDir(), `named.${language}`);
    const config = join(fixtureDir(), 'named.sha.json');
    const texture = join(fixtureDir(), 'albedo.png');
    const png = new PNG({ width: 2, height: 2 });
    for (let offset = 0; offset < png.data.length; offset += 4) {
      png.data.set([0, 255, 0, 255], offset);
    }
    writeFileSync(texture, PNG.sync.write(png));
    writeFileSync(path, initial);
    writeFileSync(config, JSON.stringify({ version: '1', passes: { Image: { inputs: { albedo: { type: 'texture', path: 'albedo.png' } } } } }));
    try {
      await open(vscode, path);
      await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('shader-studio.view'));
      let frame = await vscode.shaderFrame();
      await pixels(frame, [255, 0, 0]);
      await open(vscode, path);
      await edit(vscode, good.replaceAll('albedo', 'missingAlbedo'));
      frame = await vscode.shaderFrame();
      await expect(frame.getByLabel('Toggle pause', { exact: true })).toHaveClass(/error/);
      await expect.poll(async () => (await errors(vscode, path)).join(' ')).toContain('missingAlbedo');
      await edit(vscode, good);
      await pixels(frame, [0, 255, 0]);
      await expect.poll(() => errors(vscode, path)).toEqual([]);
      frame = await saveReload(vscode, path, good, frame);
      await pixels(frame, [0, 255, 0]);
      await expect.poll(() => errors(vscode, path)).toEqual([]);
    } finally {
      await revertFixtureEditors(vscode, fixtureDir());
      rmSync(path, { force: true }); rmSync(config, { force: true }); rmSync(texture, { force: true });
    }
  });
}

test('WGSL Common diagnostics retain authored ownership and line after editing and reopening', async ({ vscode }) => {
  mkdirSync(fixtureDir(), { recursive: true });
  const path = join(fixtureDir(), 'attribution.wgsl');
  const common = join(fixtureDir(), 'attribution.common.wgsl');
  const config = join(fixtureDir(), 'attribution.sha.json');
  const good = '\n\ndiagnostic(off, derivative_uniformity);\nfn tint() -> vec4f {\n  return vec4f(0,1,0,1);\n}';
  writeFileSync(path, 'fn mainImage(p: vec2f) -> vec4f { return tint(); }');
  writeFileSync(common, good);
  writeFileSync(config, JSON.stringify({ version: '1', passes: { common: { path: 'attribution.common.wgsl' }, Image: {} } }));
  try {
    await open(vscode, path);
    await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('shader-studio.view'));
    let frame = await vscode.shaderFrame();
    await pixels(frame, [0,255,0]);
    await setPreviewLocked(vscode, frame, true);
    await open(vscode, common);
    await edit(vscode, good.replace('vec4f(0,1,0,1)', 'missingCommon'));
    frame = await vscode.shaderFrame();
    await expect(frame.getByLabel('Toggle pause', { exact: true })).toHaveClass(/error/);
    await frame.getByLabel('Toggle pause', { exact: true }).hover();
    await expect(frame.locator('.error-tooltip.visible')).toContainText(/Common.*L5:10/s);
    const expectCommonDiagnostic = async () => expect.poll(() => vscode.evaluateInHost((vscode, path) =>
      vscode.languages.getDiagnostics(vscode.Uri.file(path)).filter(d => d.severity === vscode.DiagnosticSeverity.Error)
        .map(d => ({ line: d.range.start.line, column: d.range.start.character })), common)).toEqual([{ line: 4, column: 9 }]);
    await expectCommonDiagnostic();
    await open(vscode, common);
    await vscode.window.locator('.monaco-editor .view-lines').filter({ visible: true }).first().click();
    await vscode.window.keyboard.press('ControlOrMeta+S');
    await expect.poll(() => readFileSync(common, 'utf8')).toBe(good.replace('vec4f(0,1,0,1)', 'missingCommon'));
    await open(vscode, path);
    frame = await saveReload(vscode, path, readFileSync(path, 'utf8'), frame);
    await expectCommonDiagnostic();
    await setPreviewLocked(vscode, frame, true);
    await open(vscode, common);
    await edit(vscode, good);
    frame = await vscode.shaderFrame();
    await pixels(frame, [0,255,0]);
    await expect.poll(() => errors(vscode, common)).toEqual([]);
    await vscode.window.locator('.monaco-editor .view-lines').filter({ visible: true }).first().click();
    await vscode.window.keyboard.press('ControlOrMeta+S');
    await expect.poll(() => readFileSync(common, 'utf8')).toBe(good);
    // Deliberately leave this panel engaged: the suite teardown owns shared
    // lock state, and the following compute case proves it starts clean.
    await setPreviewLocked(vscode, await vscode.shaderFrame(), true);
    await expectPreviewLock(await vscode.shaderFrame(), true);
  } finally {
    await revertFixtureEditors(vscode, fixtureDir());
    for (const file of [path, common, config]) {
      rmSync(file, { force: true });
    }
  }
});

test('WGSL compute recovers from implicit sampling through an editor correction, save and reload', async ({ vscode }) => {
  mkdirSync(fixtureDir(), { recursive: true });
  const path = join(fixtureDir(), 'compute.wgsl');
  const update = join(fixtureDir(), 'update.wgsl');
  const config = join(fixtureDir(), 'compute.sha.json');
  const invalid = '@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) { writeOutput(id.xy, vec4f(0,1,0,1) + keysSample(vec2f(0))); }';
  const valid = invalid.replace('keysSample(vec2f(0))', 'sample2DLevel(keysTexture, keysSampler, vec2f(0), 0)');
  writeFileSync(path, 'fn mainImage(p: vec2f) -> vec4f { return resultSampleLevel(p / iResolution.xy, 0); }');
  writeFileSync(update, valid);
  writeFileSync(config, JSON.stringify({ version: '1', passes: {
    Image: { inputs: { result: { type: 'buffer', source: 'Compute' } } },
    Compute: { type: 'compute', path: 'update.wgsl', entryPoint: 'update', inputs: { keys: { type: 'keyboard' } } },
  } }));
  try {
    await open(vscode, path);
    await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('shader-studio.view'));
    let frame = await vscode.shaderFrame();
    await pixels(frame, [0,255,0]);
    // This test must acquire the lock itself. This catches the prior shared
    // panel leak: a preceding test could leave the lock active, making
    // setPreviewLocked a no-op and preserving a late webview-focus report.
    await expectPreviewLock(frame, false);
    await setPreviewLocked(vscode, frame, true);
    await open(vscode, update);
    await edit(vscode, invalid);
    frame = await vscode.shaderFrame();
    await expect(frame.getByLabel('Toggle pause', { exact: true })).toHaveClass(/error/);
    await frame.getByLabel('Toggle pause', { exact: true }).hover();
    await expect(frame.locator('.error-tooltip.visible')).toContainText(/compute|fragment|textureSample/i);
    await open(vscode, update);
    await edit(vscode, valid);
    await pixels(frame, [0,255,0]);
    await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
    await expect.poll(() => errors(vscode, update)).toEqual([]);
    await vscode.window.locator('.monaco-editor .view-lines').filter({ visible: true }).first().click();
    await vscode.window.keyboard.press('ControlOrMeta+S');
    await expect.poll(() => readFileSync(update, 'utf8')).toBe(valid);
    await open(vscode, path);
    frame = await saveReload(vscode, path, readFileSync(path, 'utf8'), frame);
    await pixels(frame, [0,255,0]);
  } finally {
    await revertFixtureEditors(vscode, fixtureDir());
    for (const file of [path, update, config]) {
      rmSync(file, { force: true });
    }
  }
});

for (const owner of ['Image', 'Common', 'vertex']) {
  test(`WGSL hoisted directive diagnostics keep ${owner} source coordinates`, async ({ vscode }) => {
    mkdirSync(fixtureDir(), { recursive: true });
    const path = join(fixtureDir(), 'directive.wgsl');
    const common = join(fixtureDir(), 'directive.common.wgsl');
    const vertex = join(fixtureDir(), 'directive.vertex.wgsl');
    const config = join(fixtureDir(), 'directive.sha.json');
    const imageSource = 'fn mainImage(p: vec2f) -> vec4f { return vec4f(0,1,0,1); }';
    const commonSource = 'fn helper() -> f32 { return 1; }';
    const vertexSource = 'fn mainVertex(p: ptr<function, vec3f>, n: ptr<function, vec3f>, uv: ptr<function, vec2f>) {}';
    const target = owner === 'Image' ? path : owner === 'Common' ? common : vertex;
    const original = owner === 'Image' ? imageSource : owner === 'Common' ? commonSource : vertexSource;
    writeFileSync(path, imageSource); writeFileSync(common, commonSource); writeFileSync(vertex, vertexSource);
    writeFileSync(config, JSON.stringify({ version: '1', passes: { common: { path: 'directive.common.wgsl' }, Image: { vertex: 'directive.vertex.wgsl' } } }));
    try {
      await open(vscode, path);
      await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('shader-studio.view'));
      let frame = await vscode.shaderFrame();
      await pixels(frame, [0,255,0]);
      await setPreviewLocked(vscode, frame, true);
      await open(vscode, target);
      await edit(vscode, '\n\n  requires\n    unknown_extension;\n' + original);
      frame = await vscode.shaderFrame();
      await expect(frame.getByLabel('Toggle pause', { exact: true })).toHaveClass(/error/);
      await expectPauseTooltip(vscode, frame, owner === 'vertex'
        ? 'Image (vertex): L4:5' : `${owner}: WGSL L4:5`);
      await expect.poll(() => vscode.evaluateInHost((vscode, path) => vscode.languages.getDiagnostics(vscode.Uri.file(path))
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error).map(d => ({ line: d.range.start.line, column: d.range.start.character })), target))
        .toEqual([{ line: 3, column: 4 }]);
      await open(vscode, target);
      await edit(vscode, original);
      await pixels(await vscode.shaderFrame(), [0,255,0]);
      await expect.poll(() => errors(vscode, target)).toEqual([]);
      if (owner === 'vertex') {
        await open(vscode, target);
        await edit(vscode, '\n\n' + original.replace('{}', '{\n  missingVertex();\n}'));
        frame = await vscode.shaderFrame();
        await expect(frame.getByLabel('Toggle pause', { exact: true })).toHaveClass(/error/);
        await expectPauseTooltip(vscode, frame, 'Image (vertex): L4:3');
        await expect.poll(() => vscode.evaluateInHost((vscode, path) => vscode.languages.getDiagnostics(vscode.Uri.file(path))
          .filter(d => d.severity === vscode.DiagnosticSeverity.Error).map(d => ({ line: d.range.start.line, column: d.range.start.character })), target))
          .toEqual([{ line: 3, column: 2 }]);
        await open(vscode, target);
        await edit(vscode, original);
        await pixels(await vscode.shaderFrame(), [0,255,0]);
        await expect.poll(() => errors(vscode, target)).toEqual([]);
      }
    } finally {
      await revertFixtureEditors(vscode, fixtureDir());
      for (const file of [path, common, vertex, config]) {
        rmSync(file, { force: true });
      }
    }
  });
}
