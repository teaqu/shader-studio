import { test, expect, workspacePath } from './fixtures.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectCanvasPixels, revertFixtureEditors } from './editor-actions.mjs';

test.use({ vscodeKey: 'wgsl-step-trace' });

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
