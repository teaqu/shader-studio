import { test, expect, workspacePath } from './fixtures.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectCanvasPixels, revertFixtureEditors } from './editor-actions.mjs';

test.use({ vscodeKey: 'wgsl-step-trace' });

async function openProjectTrace(vscode, path) {
  await vscode.evaluateInHost(async (vscode, path) => {
    await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    editor.selection = new vscode.Selection(1, 2, 1, 2);
    await vscode.commands.executeCommand('shader-studio.view');
  }, path);
  const frame = await vscode.shaderFrame();
  const debugButton = frame.locator('button.collapse-debug');
  const debugEnabled = await debugButton.count() > 0
    && await debugButton.evaluate(element => element.classList.contains('active'));
  if (!debugEnabled) {
    if (await debugButton.isVisible()) {
      await debugButton.click();
    } else {
      await frame.getByLabel('Open options menu', { exact: true }).click();
      await frame.locator('.options-menu-item[aria-label="Toggle debug mode"]').click();
    }
  }
  const inspectorToggle = frame.getByLabel('Toggle inspector', { exact: true });
  if (!await inspectorToggle.evaluate(element => element.classList.contains('active'))) {
    await inspectorToggle.click();
  }
  const inline = frame.getByLabel('Toggle inline rendering', { exact: true });
  if (await inline.count() && await inline.evaluate(element => element.classList.contains('active'))) {
    await inline.click();
  }
  const canvas = frame.locator('.canvas-container canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixel = { x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) };
  await canvas.hover({ position: pixel });
  // The shared preview retains the previous test's selected pixel. Canvas
  // clicks toggle the lock, so only click when this pixel is not locked yet.
  const zoom = frame.locator('.pixel-inspector-section canvas');
  if (!await zoom.evaluate(element => element.classList.contains('locked'))) {
    await canvas.click({ position: pixel });
  }
  await expect(zoom).toHaveClass(/locked/);
  await expect.poll(() => frame.locator('.pixel-inspector-section').textContent()).toContain('fragCoord');
  await expect(frame.getByRole('button', { name: 'Start Trace', exact: true })).toBeEnabled();
  return frame;
}

async function nextTraceLocals(vscode) {
  return vscode.evaluateInHost(async vscode => {
    const session = vscode.debug.activeDebugSession;
    await session.customRequest('next', { threadId: 1 });
    const stack = await session.customRequest('stackTrace', { threadId: 1 });
    const variables = await session.customRequest('variables', { variablesReference: 1 });
    return { stack, variables };
  });
}

test('starts a GPU recording from the inspected pixel and steps it in the shader editor @gpu', async ({ vscode }) => {
  const directory = join(workspacePath, `wgsl-step-trace-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'image.wgsl');
  writeFileSync(path, `fn mainImage(p: vec2f) -> vec4f {
  var value: f32 = p.x;
  for (var i = 0u; i < 3u; i++) {
    value += 0.125;
  }
  return vec4f(0.5, 0.25, 0.75, 1.0);
}\n`);
  writeFileSync(join(directory, 'image.sha.json'), JSON.stringify({ version: '1', passes: { Image: { inputs: {} } } }));
  try {
    await vscode.evaluateInHost(async (vscode, path) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      editor.selection = new vscode.Selection(1, 4, 1, 4);
      await vscode.commands.executeCommand('shader-studio.view');
    }, path);
    const frame = await vscode.shaderFrame();
    await expectCanvasPixels(frame, [128, 64, 191]);
    const debugButton = frame.locator('button.collapse-debug');
    if (await debugButton.isVisible()) {
      await debugButton.click();
    } else {
      await frame.getByLabel('Open options menu', { exact: true }).click();
      await frame.locator('.options-menu-item[aria-label="Toggle debug mode"]').click();
    }
    if (await frame.locator('.variables-section').count() === 0) {
      await frame.getByLabel('Toggle variable inspector', { exact: true }).click();
    }
    const inline = frame.getByLabel('Toggle inline rendering', { exact: true });
    if (await inline.count() && await inline.evaluate(element => element.classList.contains('active'))) {
      await inline.click();
    }
    const canvas = frame.locator('.canvas-container canvas').first();
    await expect(canvas).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const selectedPixel = {
      x: Math.floor(canvasBox.width * 0.25),
      y: Math.floor(canvasBox.height * 0.75),
    };
    await canvas.hover({ position: selectedPixel });
    await canvas.click({ position: selectedPixel });
    const inspectorText = () => frame.locator('.pixel-inspector-section').textContent();
    await expect.poll(inspectorText).toMatch(/fragCoord\s*\d+\.\d,\s*\d+\.\d/);
    const selectedFragCoord = (await inspectorText()).match(/fragCoord\s*(\d+\.\d),\s*(\d+\.\d)/);
    expect(selectedFragCoord).not.toBeNull();
    const selectedX = Number(selectedFragCoord[1]);
    const inspector = () => frame.evaluate(() => [...document.querySelectorAll('.var-row')]
      .find(row => row.querySelector('.var-name')?.textContent?.trim() === 'value')?.textContent ?? '');
    await expect.poll(inspector).toContain('value');
    await vscode.evaluateInHost((vscode, path) => {
      vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(
        new vscode.Location(vscode.Uri.file(path), new vscode.Position(5, 0)),
      )]);
    }, path);
    await frame.getByRole('button', { name: 'Start Trace', exact: true }).click();
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.debug.activeDebugSession?.type ?? null))
      .toBe('shader-studio-wgsl-trace');
    await expect(vscode.window.locator('.debug-toolbar')).toBeVisible();
    await expect.poll(() => vscode.evaluateInHost(async vscode => {
      try {
        return (await vscode.debug.activeDebugSession.customRequest('stackTrace', { threadId: 1 })).stackFrames[0].line;
      } catch {
        return null;
      }
    })).toBe(2);
    // Exercise the same action as the user pressing Step Over in the toolbar.
    await vscode.window.keyboard.press('F10');
    await expect.poll(() => vscode.evaluateInHost(async vscode => {
      return (await vscode.debug.activeDebugSession.customRequest('stackTrace', { threadId: 1 })).stackFrames[0].line;
    })).toBe(3);
    const local = await vscode.evaluateInHost(async vscode => {
      const session = vscode.debug.activeDebugSession;
      const stack = await session.customRequest('stackTrace', { threadId: 1 });
      const variables = await session.customRequest('variables', { variablesReference: 1 });
      return { stack, variables };
    });
    expect(local.stack.stackFrames[0].line).toBe(3);
    expect(local.stack.stackFrames[0].source.sourceReference).toBe(0);
    expect(local.stack.stackFrames[0].source.path).toBe(path);
    // The inspector exposes a top-left pixel index while fragment coordinates
    // point at that pixel's centre, so WGSL sees x + 0.5.
    expect(local.variables.variables.find(variable => variable.name === 'value')?.value).toBe(String(selectedX + 0.5));
    await expect.poll(() => vscode.evaluateInHost((vscode, path) => vscode.window.activeTextEditor?.document.uri.fsPath, path))
      .toBe(path);
    await vscode.evaluateInHost(async vscode => {
      const session = vscode.debug.activeDebugSession;
      await session.customRequest('continue', { threadId: 1 });
    });
    const final = await vscode.evaluateInHost(async vscode => {
      const session = vscode.debug.activeDebugSession;
      return { stack: await session.customRequest('stackTrace', { threadId: 1 }),
        variables: await session.customRequest('variables', { variablesReference: 1 }) };
    });
    expect(final.stack.stackFrames[0].line).toBe(6);
    expect(final.variables.variables.find(variable => variable.name === 'value')?.value).toBe(String(selectedX + 0.875));
    const previous = await vscode.evaluateInHost(async vscode => {
      const session = vscode.debug.activeDebugSession;
      await session.customRequest('stepBack', { threadId: 1 });
      return { stack: await session.customRequest('stackTrace', { threadId: 1 }),
        variables: await session.customRequest('variables', { variablesReference: 1 }) };
    });
    expect(previous.stack.stackFrames[0].line).toBe(4);
    expect(previous.variables.variables.find(variable => variable.name === 'value')?.value).toBe(String(selectedX + 0.75));
    await vscode.evaluateInHost(async vscode => {
      await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
    });
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.debug.activeDebugSession?.type ?? null)).toBe(null);
    await expectCanvasPixels(frame, [128, 64, 191]);
  } finally {
    await vscode.evaluateInHost(async vscode => {
      if (vscode.debug.activeDebugSession?.type === 'shader-studio-wgsl-trace') {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
      }
    });
    await revertFixtureEditors(vscode, directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('launches explicit uniforms and steps else-if with unavailable aggregate values @gpu', async ({ vscode }) => {
  const directory = join(workspacePath, `wgsl-trace-gaps-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'image.wgsl');
  writeFileSync(path, `fn mainImage(p: vec2f) -> vec4f {
  let weights = array<f32, 2>(0.125, 0.25);
  var value = gain;
  if (p.x < 1.0) { value += weights[0]; }
  else if (p.x < 2.0) { value += weights[1]; }
  else { value = 1.0; }
  let color = vec4f(value);
  return color;
}\n`);
  try {
    const started = await vscode.evaluateInHost(async (vscode, path) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
      vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(path), new vscode.Position(7, 0)))]);
      return vscode.debug.startDebugging(undefined, { type: 'shader-studio-wgsl-trace', request: 'launch',
        name: 'WGSL trace gaps', program: path, width: 4, height: 4, pixel: [1, 2], capacity: 64,
        customUniforms: [{ name: 'gain', type: 'float', value: 0.25 }] });
    }, path);
    expect(started).toBe(true);
    await expect.poll(() => vscode.evaluateInHost(async vscode => {
      try {
        return (await vscode.debug.activeDebugSession.customRequest('stackTrace', { threadId: 1 })).stackFrames[0].line;
      } catch {
        return null;
      }
    })).toBe(2);
    const result = await vscode.evaluateInHost(async vscode => {
      const session = vscode.debug.activeDebugSession;
      await session.customRequest('continue', { threadId: 1 });
      return { stack: await session.customRequest('stackTrace', { threadId: 1 }),
        variables: await session.customRequest('variables', { variablesReference: 1 }) };
    });
    expect(result.stack.stackFrames[0].line).toBe(8);
    expect(result.variables.variables.find(variable => variable.name === 'value')?.value).toBe('0.5');
    expect(result.variables.variables.find(variable => variable.name === 'color')?.value).toBe('[0.5, 0.5, 0.5, 0.5]');
    expect(result.variables.variables.find(variable => variable.name === 'weights')?.value).toBe('<not recorded: unsupported or unresolved type>');
  } finally {
    await vscode.evaluateInHost(async vscode => {
      if (vscode.debug.activeDebugSession?.type === 'shader-studio-wgsl-trace') {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
      }
    });
    await revertFixtureEditors(vscode, directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('traces an installed WGSL Image pass with Common and a named texture @gpu', async ({ vscode }) => {
  const directory = join(workspacePath, `wgsl-project-trace-common-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const image = join(directory, 'image.wgsl');
  const common = join(directory, 'common.wgsl');
  const config = join(directory, 'image.sha.json');
  writeFileSync(common, `fn commonGain() -> f32 {
  let commonValue = 0.25;
  return commonValue;
}\n`);
  writeFileSync(image, `fn mainImage(p: vec2f) -> vec4f {
  let key = keysSampleLevel(vec2f(0), 0).x;
  let shade = commonGain() + key;
  return vec4f(shade, 0, 0, 1);
}\n`);
  writeFileSync(config, JSON.stringify({ version: '1', passes: {
    common: { path: 'common.wgsl' }, Image: { inputs: { keys: { type: 'keyboard' } } },
  } }));
  try {
    const frame = await openProjectTrace(vscode, image);
    await expectCanvasPixels(frame, [64, 0, 0]);
    await frame.getByRole('button', { name: 'Start Trace', exact: true }).click();
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.debug.activeDebugSession?.type ?? null))
      .toBe('shader-studio-wgsl-trace');
    await nextTraceLocals(vscode);
    const commonDeclaration = await nextTraceLocals(vscode);
    expect(commonDeclaration.stack.stackFrames[0].source.path).toBe(common);
    expect(commonDeclaration.stack.stackFrames[0].name).toBe('commonGain');
    const commonTrace = await nextTraceLocals(vscode);
    expect(commonTrace.stack.stackFrames[0].source.path).toBe(common);
    expect(commonTrace.variables.variables.find(variable => variable.name === 'commonValue')?.value).toBe('0.25');
    const imageTrace = await nextTraceLocals(vscode);
    expect(imageTrace.stack.stackFrames[0].source.path).toBe(image);
    expect(imageTrace.variables.variables.find(variable => variable.name === 'shade')?.value).toBe('0.25');
  } finally {
    await vscode.evaluateInHost(async vscode => {
      if (vscode.debug.activeDebugSession?.type === 'shader-studio-wgsl-trace') {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
      }
    });
    await revertFixtureEditors(vscode, directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('selects a WGSL compute target and traces its chosen invocation @gpu', async ({ vscode }) => {
  const directory = join(workspacePath, `wgsl-project-trace-compute-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const image = join(directory, 'image.wgsl');
  const compute = join(directory, 'update.wgsl');
  const config = join(directory, 'image.sha.json');
  writeFileSync(image, 'fn mainImage(p: vec2f) -> vec4f { return resultSampleLevel(p / iResolution.xy, 0); }\n');
  writeFileSync(compute, `@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) {
  let invocationX = f32(id.x);
  let traceValue = invocationX + 0.25;
  writeOutput(id.xy, vec4f(0, 1, 0, 1));
}\n`);
  writeFileSync(config, JSON.stringify({ version: '1', passes: {
    Image: { inputs: { result: { type: 'buffer', source: 'Compute' } } },
    Compute: { type: 'compute', path: 'update.wgsl', entryPoint: 'update' },
  } }));
  try {
    const frame = await openProjectTrace(vscode, image);
    await expectCanvasPixels(frame, [0, 255, 0]);
    const pass = frame.locator('.trace-control select');
    await expect(pass).toHaveValue('Image:fragment');
    await pass.selectOption('Compute:compute');
    const invocation = frame.getByLabel('Trace invocation 0', { exact: true });
    await invocation.fill('2');
    await invocation.press('Tab');
    await frame.getByRole('button', { name: 'Start Trace', exact: true }).click();
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.debug.activeDebugSession?.type ?? null))
      .toBe('shader-studio-wgsl-trace');
    // Compute traces first stop at entry, before the first local declaration.
    await nextTraceLocals(vscode);
    const invocationTrace = await nextTraceLocals(vscode);
    expect(invocationTrace.variables.variables.find(variable => variable.name === 'invocationX')?.value).toBe('2');
    const trace = await nextTraceLocals(vscode);
    expect(trace.stack.stackFrames[0].source.path).toBe(compute);
    expect(trace.variables.variables.find(variable => variable.name === 'traceValue')?.value).toBe('2.25');
  } finally {
    await vscode.evaluateInHost(async vscode => {
      if (vscode.debug.activeDebugSession?.type === 'shader-studio-wgsl-trace') {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
      }
    });
    await revertFixtureEditors(vscode, directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('selects a WGSL vertex replay target and exposes its recorded local @gpu', async ({ vscode }) => {
  const directory = join(workspacePath, `wgsl-project-trace-vertex-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const image = join(directory, 'image.wgsl');
  const vertex = join(directory, 'image.vertex.wgsl');
  const config = join(directory, 'image.sha.json');
  writeFileSync(image, 'fn mainImage(p: vec2f) -> vec4f { return vec4f(0.5, 0.25, 0.75, 1); }\n');
  writeFileSync(vertex, `fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  let traceVertex = (*position).x;
  *position = *position;
}\n`);
  writeFileSync(config, JSON.stringify({ version: '1', passes: { Image: { vertex: 'image.vertex.wgsl' } } }));
  try {
    const frame = await openProjectTrace(vscode, image);
    await expectCanvasPixels(frame, [128, 64, 191]);
    const pass = frame.locator('.trace-control select');
    await pass.selectOption('Image:vertex');
    const vertexIndex = frame.getByLabel('Trace vertex index', { exact: true });
    await vertexIndex.fill('0');
    await vertexIndex.press('Tab');
    await frame.getByRole('button', { name: 'Start Trace', exact: true }).click();
    await expect.poll(() => vscode.evaluateInHost(vscode => vscode.debug.activeDebugSession?.type ?? null))
      .toBe('shader-studio-wgsl-trace');
    const trace = await nextTraceLocals(vscode);
    expect(trace.stack.stackFrames[0].source.path).toBe(vertex);
    expect(trace.variables.variables.find(variable => variable.name === 'traceVertex')).toBeDefined();
  } finally {
    await vscode.evaluateInHost(async vscode => {
      if (vscode.debug.activeDebugSession?.type === 'shader-studio-wgsl-trace') {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
      }
    });
    await revertFixtureEditors(vscode, directory);
    rmSync(directory, { recursive: true, force: true });
  }
});
