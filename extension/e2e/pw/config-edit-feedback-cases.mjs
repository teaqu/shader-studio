import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { centrePixel } from './canvas-pixel.mjs';

// Frames BufferA must accumulate before Image turns green. A wipe therefore
// shows as red for this many frames, far longer than a sampling gap.
const FRAMES_TO_GREEN = 120;

const COUNTER_SOURCE = {
  glsl: `void mainImage(out vec4 color, in vec2 coord) {
    float previous = load2D(iChannel0, ivec2(coord)).r;
    color = vec4(previous + 1.0, 0.0, 0.0, 1.0);
  }`,
  slang: `float4 mainImage(float2 coord) {
    float previous = iChannel0.Load(int2(coord)).r;
    return float4(previous + 1.0, 0.0, 0.0, 1.0);
  }`,
  wgsl: `fn mainImage(coord: vec2f) -> vec4f {
    let previous = load2D(iChannel0Texture, vec2i(coord)).r;
    return vec4f(previous + 1.0, 0.0, 0.0, 1.0);
  }`,
};

const IMAGE_SOURCE = {
  glsl: `void mainImage(out vec4 color, in vec2 coord) {
    float count = load2D(iChannel0, ivec2(coord)).r;
    color = count >= ${FRAMES_TO_GREEN}.0 ? vec4(0, 1, 0, 1) : vec4(1, 0, 0, 1);
  }`,
  slang: `float4 mainImage(float2 coord) {
    float count = iChannel0.Load(int2(coord)).r;
    return count >= ${FRAMES_TO_GREEN}.0 ? float4(0, 1, 0, 1) : float4(1, 0, 0, 1);
  }`,
  wgsl: `fn mainImage(coord: vec2f) -> vec4f {
    let count = load2D(iChannel0Texture, vec2i(coord)).r;
    if (count >= ${FRAMES_TO_GREEN}.0) { return vec4f(0, 1, 0, 1); }
    return vec4f(1, 0, 0, 1);
  }`,
};

/**
 * A reload-class config edit - anything outside the live-safe leaves, such as an
 * input's filter - resends the shader with `reload: true`. WebGL used that flag
 * to reallocate every ping-pong pair, wiping running simulations, while WebGPU
 * rebuilt only the passes whose pipeline key moved. The same edit therefore left
 * a GLSL shader restarting from zero and a Slang or WGSL shader still running.
 * Both backends must now keep feedback that the edit did not invalidate.
 */
export function registerConfigEditFeedbackTests(language) {
  const label = language === 'glsl' ? 'GLSL' : language === 'wgsl' ? 'WGSL' : 'Slang';
  const fixtureDir = join(
    workspacePath,
    `config-edit-feedback-${language}-${process.env.TEST_WORKER_INDEX ?? process.pid}`,
  );
  const shaderPath = join(fixtureDir, `feedback.${language}`);
  const configPath = join(fixtureDir, 'feedback.sha.json');

  const writeConfig = (filter) => writeFileSync(configPath, JSON.stringify({
    version: '1.0',
    passes: {
      BufferA: {
        path: `./counter.${language}`,
        inputs: { iChannel0: { type: 'buffer', source: 'BufferA', filter } },
      },
      Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA', filter } } },
    },
  }));

  test.use({ vscodeKey: `config-edit-feedback-${language}` });

  test.describe(`${label} buffer feedback across a config edit ${language === 'glsl' ? '' : '@gpu'}`, () => {
    test.afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

    test('a reload-class config edit leaves running buffer feedback intact', async ({ vscode }) => {
      rmSync(fixtureDir, { recursive: true, force: true });
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(join(fixtureDir, `counter.${language}`), COUNTER_SOURCE[language]);
      writeFileSync(shaderPath, IMAGE_SOURCE[language]);
      writeConfig('linear');

      await vscode.evaluateInHost(async (vscode, targetPath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        await vscode.commands.executeCommand('shader-studio.view');
      }, shaderPath);

      const frame = await vscode.shaderFrame();
      await expect.poll(() => frame.locator('.menu-bar').count()).toBeGreaterThan(0);

      // Positive control: prove the edit really took the reload path before
      // asserting what it preserved.
      await frame.evaluate(() => {
        window.__reloadMessages = 0;
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'shaderSource' && event.data.reload === true) {
            window.__reloadMessages++;
          }
        });
      });

      const isGreen = async () => {
        const [red, green] = await centrePixel(frame);
        return green > 200 && red < 80;
      };
      await expect.poll(isGreen, { message: 'counter never accumulated' }).toBe(true);

      // Edit the config the way a user does, in its own editor. `filter` is not
      // a live-safe leaf, so the host classifies this as reload and resends the
      // shader with reload: true.
      await vscode.evaluateInHost(async (vscode, targetPath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
        });
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          document.getText().replaceAll('linear', 'nearest'),
        );
        await vscode.workspace.applyEdit(edit);
      }, configPath);
      await expect.poll(() => frame.evaluate(() => window.__reloadMessages),
        { message: 'the config edit never reached the panel as a reload' }).toBeGreaterThan(0);

      // Sample for longer than the wipe would stay visible, so a reallocation
      // cannot hide between polls.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        expect(await isGreen(), 'buffer feedback was wiped by the config edit').toBe(true);
      }
    });
  });
}
