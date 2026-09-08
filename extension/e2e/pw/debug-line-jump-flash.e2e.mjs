import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'line-jump-flash.glsl');

// 1-based debug lines in the fixture: L3 shows lineA (dark grey), L4 shows
// lineB (bright grey). The untouched shader renders solid green.
// FULL_SHADER_MARKER must stay in the fixture's terminal statement: only the
// untouched compile still contains it, which is how the install log tells a
// full-shader program apart from a line visualization.
const LINE_A = 3;
const LINE_B = 4;
const FULL_SHADER_MARKER = 'vec4(base, 1.0)';

test.use({ vscodeKey: 'debug-line-jump-flash' });

/**
 * Moving the cursor between two debugged lines must go straight from one
 * line's visualization to the other. Every cursor move used to recompile the
 * untouched shader first (a baseline, to keep error reporting honest), which
 * installs the full-shader program - so the canvas flashed the whole shader
 * between the two lines. Only the real app shows this: it needs debug mode,
 * a cursor move, and a genuine GL compile installing each program.
 *
 * The install log is the deterministic gate: any install of the untouched
 * program necessarily paints at least one frame, while its absence proves no
 * flash could have happened. Pixel samples back the user-visible side.
 */
test.describe('inline rendering across a line jump', () => {
  const moveCursor = (vscode, zeroBasedLine) => vscode.evaluateInHost(
    async (vscode, targetPath, line) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(line, 4);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }, shaderPath, zeroBasedLine,
  );

  const centrePixel = (frame) => frame.evaluate(() => {
    const canvas = document.querySelector('.canvas-container canvas');
    const context = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (!context) {
      return null;
    }
    const pixel = new Uint8Array(4);
    context.readPixels(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
      context.RGBA, context.UNSIGNED_BYTE, pixel,
    );
    return [...pixel.slice(0, 3)];
  });

  const headerInfo = (frame) => frame.evaluate(
    () => document.querySelector('.header-info')?.textContent?.trim() ?? '',
  );

  const isGrey = (pixel) => {
    if (!pixel) return false;
    const [r, g, b] = pixel;
    return Math.max(r, g, b) - Math.min(r, g, b) <= 45;
  };

  test('goes from one line to the next without showing the whole shader', async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(0, 0);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    // The install log keys on this marker: fail loudly if the fixture no
    // longer contains it rather than letting the gate go vacuous.
    const fixtureText = await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      return document.getText();
    }, shaderPath);
    expect(fixtureText).toContain(FULL_SHADER_MARKER);

    const frame = await vscode.shaderFrame();
    await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);

    // The untouched shader renders solid green: this also proves pixel
    // sampling observes the canvas before anything is asserted through it.
    await expect.poll(async () => {
      const pixel = await centrePixel(frame);
      if (!pixel) return 'no canvas yet';
      const [r, g, b] = pixel;
      return g > 200 && r < 60 && b < 60 ? 'green' : `not green yet: ${pixel}`;
    }, {
      message: 'the untouched shader never rendered green', timeout: 90_000,
    }).toBe('green');

    // Record every program the canvas context installs from here on, tagged
    // by whether its fragment source is the untouched shader. Line-debug
    // output truncates the body at the inspected line, so only the untouched
    // compile still contains the fixture's terminal statement - anything
    // else observed here is a line visualization (or capture) shader. The
    // render loop binds the current program every frame, so an install the
    // test never observes cannot exist - and any install of the untouched
    // program paints at least one full-shader frame.
    await frame.evaluate((marker) => {
      if (window.__ssLineJump) return;
      const sources = new Map();
      const state = (window.__ssLineJump = { log: [], mark: 0, marker });
      const classify = (gl, program) => {
        if (!program || !gl) return 0;
        let fragment = null;
        for (const shader of gl.getAttachedShaders(program) ?? []) {
          if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) {
            fragment = sources.get(shader) ?? null;
          }
        }
        if (fragment === null) return 0;
        return fragment.includes(state.marker) ? 1 : 2;
      };
      for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
        if (!proto || proto.__ssLineJumpHooked) continue;
        const rawShaderSource = proto.shaderSource;
        proto.shaderSource = function hookedShaderSource(shader, source) {
          sources.set(shader, String(source));
          return rawShaderSource.call(this, shader, source);
        };
        const rawUseProgram = proto.useProgram;
        proto.useProgram = function hookedUseProgram(program) {
          if (program) state.log.push(classify(this, program));
          return rawUseProgram.call(this, program);
        };
        proto.__ssLineJumpHooked = true;
      }
    }, FULL_SHADER_MARKER);

    // The toggle stays disabled until the shader has loaded, and a click that
    // lands before then does nothing at all.
    await expect.poll(
      () => frame.evaluate(() => !document.querySelector(
        'button.collapse-debug[aria-label="Toggle debug mode"]')?.disabled),
      { message: 'debug mode never became available', timeout: 90_000 },
    ).toBe(true);
    await frame.evaluate(() => {
      document.querySelector('button.collapse-debug[aria-label="Toggle debug mode"]')?.click();
    });
    await expect.poll(() => frame.locator('.debug-panel').count(), { timeout: 30_000 }).toBeGreaterThan(0);

    // Land on the first line and wait for its visualization: dark grey, not
    // the untouched green.
    await moveCursor(vscode, LINE_A - 1);
    await expect.poll(() => headerInfo(frame), {
      message: `debug panel never followed the cursor to L${LINE_A}`, timeout: 30_000,
    }).toContain(`L${LINE_A}`);
    await expect.poll(async () => {
      const pixel = await centrePixel(frame);
      if (!isGrey(pixel)) return 'not grey yet';
      const avg = (pixel[0] + pixel[1] + pixel[2]) / 3;
      return avg >= 25 && avg <= 115 ? 'line-a' : 'not line A yet';
    }, { message: 'inline rendering never showed line A as dark grey', timeout: 60_000 }).toBe('line-a');
    const pixelA = await centrePixel(frame);

    // Everything from here is the jump under test.
    await frame.evaluate(() => {
      window.__ssLineJump.mark = window.__ssLineJump.log.length;
    });

    // Jump to the second line, sampling every frame the test observes: with
    // the bug each of those installs the untouched program first.
    await moveCursor(vscode, LINE_B - 1);
    const seen = [];
    await expect.poll(async () => {
      const [info, pixel] = await Promise.all([headerInfo(frame), centrePixel(frame)]);
      if (pixel) seen.push(pixel);
      if (!info.includes(`L${LINE_B}`) || !pixel) return 'waiting for the panel';
      if (!isGrey(pixel)) return 'waiting for inline rendering';
      const avg = (pixel[0] + pixel[1] + pixel[2]) / 3;
      return avg > 150 ? 'line-b' : 'waiting for line B';
    }, { message: 'inline rendering never showed line B as bright grey', timeout: 60_000 }).toBe('line-b');
    expect(seen.length, 'no frames observed during the jump').toBeGreaterThan(0);

    // Let a lagging compile land: with the bug the baseline installs before
    // the instrumented program, so it is already logged - this only guards
    // against async reordering hiding it.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const installs = await frame.evaluate(
      () => window.__ssLineJump.log.slice(window.__ssLineJump.mark),
    );
    const pixelB = await centrePixel(frame);

    // Every frame the test saw stayed inside a line visualization: a
    // full-shader frame is solid green, never grey.
    expect(
      seen.filter((pixel) => !isGrey(pixel)),
      `the jump showed the whole shader: ${JSON.stringify(seen)}`,
    ).toEqual([]);

    // The deterministic gate: after the jump started, no installed program
    // may come from the untouched fragment source (1), nor from a program
    // linked before the spy was installed (0). 2 is a line-visualization
    // install; the jump must contain at least one, or the test observed no
    // recompile at all.
    expect(installs.length, 'no program installs observed after the jump').toBeGreaterThan(0);
    expect(
      installs.filter((kind) => kind !== 2),
      'the jump installed the untouched shader between the two lines',
    ).toEqual([]);

    // The jump actually switched visualizations: line B renders bright grey,
    // well clear of line A's dark grey.
    const avgA = (pixelA[0] + pixelA[1] + pixelA[2]) / 3;
    const avgB = (pixelB[0] + pixelB[1] + pixelB[2]) / 3;
    expect(avgB - avgA, `line B ${pixelB} did not follow line A ${pixelA}`).toBeGreaterThan(60);
  });
});
