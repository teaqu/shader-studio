import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { replaceSource, expectCanvasPixels, setPreviewLocked, revertFixtureEditors, setParameterExpression } from './editor-actions.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
test.use({ vscodeKey: 'common-storage-debug' });
const directory = join(workspacePath, 'common-storage-debug');
test.beforeEach(async ({ vscode }) => {
  await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
});
async function showFileAtLine(vscode, targetPath, line, { beside = false } = {}) {
  await vscode.evaluateInHost(async (vscode, path, lineNumber, openBeside) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: openBeside ? vscode.ViewColumn.Beside : vscode.ViewColumn.One, preserveFocus: false, preview: false,
    });
    const position = new vscode.Position(lineNumber, 4);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }, targetPath, line, beside);
}

async function ensureShaderView(vscode) {
  const hasPreview = await Promise.all(vscode.window.frames().map(async frame => (
    (await frame.locator('.canvas-container').count().catch(() => 0)) > 0
  ))).then(results => results.some(Boolean));
  if (!hasPreview) {
    await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
  }
}

async function enableVariableInspector(vscode, frame) {
  const button = frame.locator('button.collapse-debug[aria-label="Toggle debug mode"]');
  await expect(button).toBeEnabled();
  await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('notifications.clearAll'));
  if (!await button.evaluate(element => element.classList.contains('active'))) {
    if (await button.isVisible()) {
      await button.click();
    } else {
      await frame.getByLabel('Open options menu', { exact: true }).click();
      await frame.locator('.options-menu-item[aria-label="Toggle debug mode"]').click();
    }
  }
  await expect(frame.locator('.debug-panel')).toBeVisible();
  if (await frame.locator('.variables-section').count() === 0) {
    await frame.getByLabel('Toggle variable inspector').click();
  }
  await expect(frame.locator('.variables-section')).toBeVisible();
}

function row(frame, name) {
  return frame.locator('.var-row').filter({ has: frame.locator('.var-name', { hasText: new RegExp(`^${name}$`) }) });
}
for (const language of ['glsl', 'slang', 'wgsl']) {
  test(`${language} Common selection captures the authored value and follows an edit`, async ({ vscode }) => {
    mkdirSync(directory, { recursive: true });
    const root = join(directory, `image.${language}`);
    const common = join(directory, `common.${language}`);
    const config = join(directory, 'image.sha.json');
    const source = language === 'wgsl'
      ? 'fn commonValue() -> f32 {\n  let shade = 0.375;\n  return shade;\n}'
      : 'float commonValue() {\n  float shade = 0.375;\n  return shade;\n}';
    writeFileSync(common, source);
    writeFileSync(root, language === 'wgsl'
      ? 'fn mainImage(p: vec2f) -> vec4f {\n  let rootOnly = commonValue();\n  return vec4f(rootOnly,0,0,1);\n}'
      : language === 'slang'
        ? 'float4 mainImage(float2 p) {\n  float rootOnly = commonValue();\n  return float4(rootOnly,0,0,1);\n}'
        : 'void mainImage(out vec4 c, in vec2 p) {\n  float rootOnly = commonValue();\n  c = vec4(rootOnly,0,0,1);\n}');
    writeFileSync(config, JSON.stringify({ version: '1', passes: { common: { path: `common.${language}` }, Image: {} } }));
    try {
      await showFileAtLine(vscode, root, 1);
      await ensureShaderView(vscode);
      let frame = await vscode.shaderFrame();
      await enableVariableInspector(vscode, frame);
      await setPreviewLocked(vscode, frame, true);
      await showFileAtLine(vscode, common, 1);
      frame = await vscode.shaderFrame();
      await expect(frame.locator('.header-info:not(.fn-name):not(.fn-type)')).toContainText('L2');
      await expect(frame.locator('.fn-name', { hasText: 'commonValue' })).toBeVisible();
      await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.375');
      await expect(row(frame, 'rootOnly')).toHaveCount(0);
      await expect(frame.getByLabel('Show capture errors')).toHaveCount(0);
      // A real editor action changes the value; stale or constant rows cannot pass.
      await replaceSource(vscode, source.replace('0.375', '0.625'));
      await showFileAtLine(vscode, common, 1);
      frame = await vscode.shaderFrame();
      await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.625');
      await expect(frame.locator('.fn-name', { hasText: 'commonValue' })).toBeVisible();
      await expect(frame.getByLabel('Show capture errors')).toHaveCount(0);
    } finally {
      await revertFixtureEditors(vscode, directory);
      for (const path of [root, common, config]) {
        rmSync(path, { force: true });
      }
    }
  });
}

for (const [language, compute] of [['slang', false], ['slang', true], ['wgsl', false], ['wgsl', true]]) {
  test(`${language} ${compute ? 'compute' : 'fragment'} debug rows read the live GPU storage value`, async ({ vscode }) => {
    mkdirSync(directory, { recursive: true });
    const root = join(directory, `storage.${language}`);
    const config = join(directory, 'storage.sha.json');
    const computePath = join(directory, `storage.compute.${language}`);
    writeFileSync(root, language === 'wgsl'
      ? 'fn mainImage(p: vec2f) -> vec4f {\n  let shade = values[0];\n  return vec4f(shade,1,0,1);\n}'
      : 'float4 mainImage(float2 p) {\n  float shade = values[0];\n  return float4(shade,1,0,1);\n}');
    if (compute) {
      writeFileSync(root, language === 'wgsl'
        ? 'fn mainImage(p: vec2f) -> vec4f { return resultSampleLevel(p / iResolution.xy, 0); }'
        : 'float4 mainImage(float2 p) { return sample2DLevel(result.texture, result.sampler, p / iResolution.xy, 0); }');
      writeFileSync(computePath, language === 'wgsl'
        ? '@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) {\n  let shade = values[0];\n  writeOutput(id.xy, vec4f(shade,1,0,1));\n}'
        : '[shader("compute")] [numthreads(1,1,1)] void update(uint3 id : SV_DispatchThreadID) {\n  float shade = values[0];\n  writeOutput(id.xy, float4(shade,1,0,1));\n}');
    }
    writeFileSync(config, JSON.stringify({ version: '1', storage: { values: { count: 1, elementType: language === 'wgsl' ? 'f32' : 'float' } }, passes: compute ? {
      Image: { inputs: { result: { type: 'buffer', source: 'Compute' } } },
      Compute: { type: 'compute', path: `storage.compute.${language}`, entryPoint: 'update' },
    } : { Image: {} } }));
    try {
      await showFileAtLine(vscode, root, 1);
      await ensureShaderView(vscode);
      let frame = await vscode.shaderFrame();
      await expectCanvasPixels(frame, [0, 255, 0]);
      await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('notifications.clearAll'));
      await expect(frame.getByLabel('Toggle debug mode', { exact: true }).first()).toBeEnabled();
      await frame.getByLabel('Toggle config panel', { exact: true }).click();
      await frame.locator('.config-panel').getByRole('button', { name: 'Storage', exact: true }).click();
      await frame.getByLabel('Inspect values', { exact: true }).click();
      const inspector = frame.getByLabel('Inspect values', { exact: true });
      const input = inspector.getByLabel('Element 0 component 0', { exact: true });
      await input.fill('0.375');
      await input.press('Tab');
      await inspector.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(input).toHaveValue('0.375');
      await enableVariableInspector(vscode, frame);
      await setPreviewLocked(vscode, frame, true);
      await showFileAtLine(vscode, compute ? computePath : root, 1);
      frame = await vscode.shaderFrame();
      await expect(frame.locator('.header-info:not(.fn-name):not(.fn-type)')).toContainText('L2');
      await expect(frame.locator('.fn-name', { hasText: compute ? 'update' : 'mainImage' })).toBeVisible();
      await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.375');
      await frame.getByText('Config', { exact: true }).click();
      await input.fill('0.625');
      await input.press('Tab');
      await frame.getByText('Debug', { exact: true }).click();
      await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.625');
      await expect(frame.getByLabel('Show capture errors')).toHaveCount(0);
    } catch (error) {
      const frame = await vscode.shaderFrame();
      await test.info().attach('storage-debug-state', { body: await frame.locator('body').innerText(), contentType: 'text/plain' });
      throw error;
    } finally {
      for (const path of [root, config, computePath]) {
        rmSync(path, { force: true });
      }
    }
  });
}

for (const language of ['wgsl', 'slang']) {
  test(`${language} keyword-prefix assignment captures the updated value`, async ({ vscode }) => {
    mkdirSync(directory, { recursive: true });
    const root = join(directory, `assignment.${language}`);
    const source = language === 'wgsl'
      ? 'fn mainImage(p: vec2f) -> vec4f {\n  var formula: f32 = 0.125;\n  formula = 0.375;\n  return vec4f(formula);\n}'
      : 'float4 mainImage(float2 p) {\n  float formula = 0.125;\n  formula = 0.375;\n  return float4(formula);\n}';
    writeFileSync(root, source);
    try {
      await showFileAtLine(vscode, root, 2);
      await ensureShaderView(vscode);
      let frame = await vscode.shaderFrame();
      await setPreviewLocked(vscode, frame, false);
      await enableVariableInspector(vscode, frame);
      await showFileAtLine(vscode, root, 2);
      await expect(frame.locator('.fn-name')).toHaveText('mainImage');
      await expect(frame.locator('.header-info:not(.fn-name):not(.fn-type)')).toContainText('L3');
      await expect(row(frame, 'formula').locator('.var-value')).toHaveText('0.375');
      await expectCanvasPixels(frame, [96, 96, 96]);
      await replaceSource(vscode, source.replace('0.375', '0.625'));
      await showFileAtLine(vscode, root, 2);
      frame = await vscode.shaderFrame();
      await expect(row(frame, 'formula').locator('.var-value')).toHaveText('0.625');
      await expectCanvasPixels(frame, [159, 159, 159]);
      await vscode.evaluateInHost(vscode => vscode.window.activeTextEditor.document.save());
      await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeActiveEditor'));
      // Closing the only editor collapses its group, so column One is now the
      // preview's group. Reopen beside it: stacked on top, the preview is hidden.
      await showFileAtLine(vscode, root, 2, { beside: true });
      frame = await vscode.shaderFrame();
      await expect(row(frame, 'formula').locator('.var-value')).toHaveText('0.625');
      await expect(frame.getByLabel('Show capture errors')).toHaveCount(0);
    } finally {
      await revertFixtureEditors(vscode, directory);
      rmSync(root, { force: true });
    }
  });
}

test('Slang compute replay refuses subgroup results and recovers after an edit', async ({ vscode }) => {
  mkdirSync(directory, { recursive: true });
  const root = join(directory, 'replay.slang');
  const compute = join(directory, 'replay.compute.slang');
  const config = join(directory, 'replay.sha.json');
  const source = '[shader("compute")] [numthreads(1,1,1)] void update(uint3 id : SV_DispatchThreadID) {\n  float shade = WaveActiveSum(0.125);\n  writeOutput(id.xy, float4(0, shade > 0 ? 1 : 0, 0, 1));\n}';
  writeFileSync(root, 'float4 mainImage(float2 p) { return sample2DLevel(result.texture,result.sampler,p / iResolution.xy,0); }');
  writeFileSync(compute, source);
  writeFileSync(config, JSON.stringify({ version: '1', passes: {
    Image: { inputs: { result: { type: 'buffer', source: 'Compute' } } },
    Compute: { type: 'compute', path: 'replay.compute.slang', entryPoint: 'update' },
  } }));
  try {
    await showFileAtLine(vscode, root, 0);
    await ensureShaderView(vscode);
    let frame = await vscode.shaderFrame();
    await setPreviewLocked(vscode, frame, false);
    await expectCanvasPixels(frame, [0,255,0]);
    await enableVariableInspector(vscode, frame);
    await setPreviewLocked(vscode, frame, true);
    await showFileAtLine(vscode, compute, 1);
    frame = await vscode.shaderFrame();
    await expect(frame.locator('.line-tooltip')).toContainText('Slang compute replay does not support subgroup operations');
    await frame.getByLabel('Show capture errors').hover();
    await expect(frame.locator('.error-tooltip')).toContainText('Slang compute replay does not support subgroup operations');
    await expect(row(frame, 'shade')).toHaveCount(0);
    await replaceSource(vscode, source.replace('WaveActiveSum(0.125)', '0.625'));
    await showFileAtLine(vscode, compute, 1);
    frame = await vscode.shaderFrame();
    await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.625');
    await expect(frame.getByLabel('Show capture errors')).toHaveCount(0);
  } finally {
    await revertFixtureEditors(vscode, directory);
    for (const path of [root, compute, config]) {
      rmSync(path, { force: true });
    }
  }
});

test('WGSL helper capture resolves array struct fields and shadowing', async ({ vscode }) => {
  mkdirSync(directory, { recursive: true });
  const root = join(directory, 'aggregate.wgsl');
  const source = 'struct Sample { value: f32, }\nfn helper(gain: f32) -> f32 {\n  let samples = array<Sample, 2>(Sample(0.125), Sample(gain));\n  var shade = 0.125;\n  if (gain > 0.0) {\n    let shade = samples[1].value;\n    return shade;\n  }\n  return shade;\n}\nfn mainImage(p: vec2f) -> vec4f { return vec4f(helper(0.375)); }';
  writeFileSync(root, source);
  try {
    await showFileAtLine(vscode, root, 5);
    await ensureShaderView(vscode);
    let frame = await vscode.shaderFrame();
    await setPreviewLocked(vscode, frame, false);
    await enableVariableInspector(vscode, frame);
    await showFileAtLine(vscode, root, 5);
    await expect(frame.locator('.fn-name')).toHaveText('helper');
    await expect(frame.locator('.line-tooltip-anchor > .header-info')).toHaveText('L6');
    await setParameterExpression(frame, 'gain', '0.375');
    await expect(row(frame, 'shade')).toHaveCount(1);
    await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.375');
    await setParameterExpression(frame, 'gain', '0.625');
    await showFileAtLine(vscode, root, 5);
    frame = await vscode.shaderFrame();
    await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.625');
    await expect(frame.getByLabel('Show capture errors')).toHaveCount(0);
  } finally {
    await revertFixtureEditors(vscode, directory);
    rmSync(root, { force: true });
  }
});

test('WGSL unmatched brace reports an error and recovers without freezing', async ({ vscode }) => {
  mkdirSync(directory, { recursive: true });
  const root = join(directory, 'recovery.wgsl');
  const source = 'fn mainImage(p: vec2f) -> vec4f {\n  let shade = 0.375;\n  return vec4f(shade,0,0,1);\n}';
  writeFileSync(root, source);
  try {
    await showFileAtLine(vscode, root, 1);
    await ensureShaderView(vscode);
    let frame = await vscode.shaderFrame();
    await setPreviewLocked(vscode, frame, false);
    await enableVariableInspector(vscode, frame);
    await showFileAtLine(vscode, root, 1);
    await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.375');
    await replaceSource(vscode, source + '\n}');
    await expect(frame.getByLabel('Toggle pause', { exact: true })).toHaveClass(/error/);
    await replaceSource(vscode, source.replace('0.375', '0.625'));
    await showFileAtLine(vscode, root, 1);
    frame = await vscode.shaderFrame();
    await expect(row(frame, 'shade').locator('.var-value')).toHaveText('0.625');
    await expect(frame.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
    await vscode.evaluateInHost(vscode => vscode.window.activeTextEditor.document.save());
  } finally {
    await revertFixtureEditors(vscode, directory);
    rmSync(root, { force: true });
  }
});
