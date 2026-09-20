import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { revertFixtureEditors } from './editor-actions.mjs';

const fixtureDir = join(workspacePath, `reset-startup-${process.env.TEST_WORKER_INDEX ?? process.pid}`);
const shaderPath = join(fixtureDir, 'startup.glsl');
test.use({ vscodeKey: 'reset-startup' });

async function centerPixel(canvas) {
  const dataUrl = await canvas.evaluate(element => element.toDataURL());
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

for (const firstSourceArrives of [true, false]) {
  test(`first GLSL panel initializes and resets when the first source ${firstSourceArrives ? 'arrives before the startup response' : 'is lost before the listener is ready'}`, async ({ vscode }) => {
    mkdirSync(fixtureDir, { recursive: true });
    // Original diagnostic: a seeded bit pattern travels through self-feedback
    // and a read from a later pass, like a packed simulation state. Losing either
    // buffer after frame zero turns the visible output red permanently.
    writeFileSync(shaderPath, `void mainImage(out vec4 color, in vec2 coord) {
      bool initialized = floatBitsToUint(texelFetch(iChannel0, ivec2(coord), 0).r) == 0x3f812345u;
      color = initialized ? vec4(0, 1, 0, 1) : vec4(1, 0, 0, 1);
    }`);
    writeFileSync(join(fixtureDir, 'state.glsl'), `void mainImage(out vec4 color, in vec2 coord) {
      vec4 previous = texelFetch(iChannel0, ivec2(coord), 0);
      vec4 later = texelFetch(iChannel1, ivec2(coord), 0);
      bool valid = iFrame == 0
        ? all(equal(previous, vec4(0))) && all(equal(later, vec4(0)))
        : floatBitsToUint(previous.r) == 0x3f812345u && floatBitsToUint(later.r) == 0x3f812345u;
      color = valid ? vec4(uintBitsToFloat(0x3f812345u), 0, 0, 1) : vec4(0);
    }`);
    writeFileSync(join(fixtureDir, 'later.glsl'), `void mainImage(out vec4 color, in vec2 coord) {
      color = texelFetch(iChannel0, ivec2(coord), 0);
    }`);
    writeFileSync(join(fixtureDir, 'startup.sha.json'), JSON.stringify({ version: '1.0', passes: {
      BufferA: { path: './state.glsl', inputs: {
        iChannel0: {type: 'buffer', source: 'BufferA'},
        iChannel1: {type: 'buffer', source: 'BufferB'},
      } },
      BufferB: { path: './later.glsl', inputs: { iChannel0: {type: 'buffer', source: 'BufferA'} } },
      Image: {inputs: { iChannel0: {type: 'buffer', source: 'BufferA'} } },
    }}));

    // Hold the actual initialization response at the host boundary until the
    // first program has rendered. Cached pipelines still exercise the gap.
    try {
      await vscode.evaluateInHost(async (vscode, path) => {
        // VS Code supplies a distinct API object per extension. Intercept the
        // tested extension's API, not the bridge extension's API.
        const requireForExtension = process.getBuiltinModule('module').createRequire(
          vscode.extensions.getExtension('teaqu.shader-studio').extensionPath + '/dist/extension.js',
        );
        const shaderVscode = requireForExtension('vscode');
        const create = shaderVscode.window.createWebviewPanel;
        shaderVscode.window.createWebviewPanel = function(...args) {
          const panel = create.apply(this, args);
          const post = panel.webview.postMessage.bind(panel.webview);
          panel.webview.postMessage = message => {
            if (message.type === 'shaderSource' && message.reload === undefined) {
              globalThis.__deliverInitialShader = () => post(message);
              return Promise.resolve(true);
            }
            if (message.type === 'shaderSource' && typeof message.reload === 'boolean'
              && !globalThis.__startupRefresh) {
              globalThis.__startupRefresh = message;
              globalThis.__releaseStartupRefresh = () => post(message);
              return Promise.resolve(true);
            }
            return post(message);
          };
          return panel;
        };
        try {
          await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
          await vscode.commands.executeCommand('shader-studio.view');
        } finally {
          shaderVscode.window.createWebviewPanel = create;
        }
      }, shaderPath);
      const frame = await vscode.shaderFrame();
      const canvas = frame.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
      await expect.poll(() => vscode.evaluateInHost(() => !!globalThis.__startupRefresh)).toBe(true);
      await frame.evaluate(() => {
        window.__startupDraws = 0;
        window.__startupPrograms = new Set();
        const original = WebGL2RenderingContext.prototype.drawArrays;
        WebGL2RenderingContext.prototype.drawArrays = function(...args) {
          const result = original.apply(this, args);
          if (this.canvas.closest('.canvas-container')) {
            window.__startupDraws++;
            window.__startupPrograms.add(this.getParameter(this.CURRENT_PROGRAM));
          }
          return result;
        };
      });
      // Delivery before the listener exists is allowed to be lost. Replay that
      // same initial host message now to force the already-running case; keep
      // the initialization response held until feedback is established.
      if (firstSourceArrives) {
        await vscode.evaluateInHost(() => globalThis.__deliverInitialShader());
        await expect.poll(() => frame.evaluate(() => window.__startupDraws)).toBeGreaterThan(10);
        await expect.poll(() => centerPixel(canvas)).toEqual([0, 255, 0, 255]);
      }
      const previousPrograms = await frame.evaluate(() => window.__startupPrograms.size);
      await vscode.evaluateInHost(() => globalThis.__releaseStartupRefresh());
      // Wait for the replacement programs to draw, not a pre-compilation frame.
      await expect.poll(() => frame.evaluate(() => window.__startupPrograms.size)).toBeGreaterThan(previousPrograms + 2);
      await expect.poll(() => centerPixel(canvas)).toEqual([0, 255, 0, 255]);

      let wasPaused = false;
      for (const paused of [false, false, true, true]) {
        if (paused !== wasPaused) {
          await frame.getByLabel('Toggle pause').click();
        }
        wasPaused = paused;
        const count = await frame.evaluate(() => window.__startupPrograms.size);
        await frame.getByLabel('Reset shader', {exact: true}).click();
        await expect.poll(() => frame.evaluate(() => window.__startupPrograms.size)).toBeGreaterThan(count + 2);
        await expect.poll(() => centerPixel(canvas)).toEqual([0, 255, 0, 255]);
        await expect(frame.getByLabel('Toggle pause').locator(paused ? '.codicon-play' : '.codicon-debug-pause')).toBeVisible();
      }
    } finally {
      await revertFixtureEditors(vscode, fixtureDir);
      await vscode.evaluateInHost(vscode => vscode.commands.executeCommand('workbench.action.closeAllEditors'));
      await vscode.evaluateInHost(() => {
        delete globalThis.__startupRefresh;
        delete globalThis.__releaseStartupRefresh;
        delete globalThis.__deliverInitialShader;
      });
      rmSync(fixtureDir, {recursive: true, force: true});
    }
  });
}
