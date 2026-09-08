import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'line-jump-flash.slang');

// 1-based debug lines in the fixture: L3 shows lineA (dark grey), L4 shows
// lineB (bright grey). The untouched shader renders solid green.
const LINES = [3, 4];

test.use({ vscodeKey: 'debug-line-jump-flash-slang' });

/**
 * The Slang mirror of debug-line-jump-flash.e2e.mjs: jumping the cursor
 * between two debugged lines must go straight from one line's visualization
 * to the other without flashing the whole shader.
 *
 * Slang line jumps compile exactly one debug plan per move, so there is no
 * baseline install to flash with. A WebGPU canvas exposes no GL-style
 * install log - the presented frame is the only signal - so the test jumps
 * repeatedly while screenshotting the canvas: a reintroduced full-pipeline
 * compile would hold the whole shader on screen for the duration of a Slang
 * compile (seconds), which dense sampling cannot miss. Only the real host
 * shows this: it needs debug mode, cursor moves, and genuine Slang compiles.
 */
test.describe('Slang inline rendering across line jumps @gpu', () => {
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

  // A WebGPU canvas has no WebGL context to read back from, so the centre
  // pixel comes from a screenshot of the presented canvas, the way the
  // script-pause-slang spec reads its preview.
  const centrePixel = async (frame) => {
    try {
      // Two canvases exist (one per backend); the first is the live one.
      const screenshot = await frame.locator('.canvas-container canvas').first().screenshot();
      return await frame.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const pixel = [...context.getImageData(
          Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
        ).data.slice(0, 3)];
        bitmap.close();
        return pixel;
      }, screenshot.toString('base64'));
    } catch {
      return null;
    }
  };

  const headerInfo = (frame) => frame.evaluate(
    () => document.querySelector('.header-info')?.textContent?.trim() ?? '',
  );

  const isGrey = (pixel) => {
    if (!pixel) return false;
    const [r, g, b] = pixel;
    return Math.max(r, g, b) - Math.min(r, g, b) <= 60;
  };

  const isFullShader = (pixel) => {
    if (!pixel) return false;
    const [r, g, b] = pixel;
    return g > 200 && r < 60 && b < 60;
  };

  test('goes from one line to the next without showing the whole shader', {
    // Slang compiles are slow: initial load plus a debug compile per jump.
    timeout: 300_000,
  }, async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
      });
      const position = new vscode.Position(0, 0);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    const frame = await vscode.shaderFrame();
    await expect.poll(() => frame.locator('.menu-bar').count(), { timeout: 60_000 }).toBeGreaterThan(0);

    // The untouched shader renders solid green: this also proves screenshot
    // sampling observes the canvas before anything is asserted through it.
    await expect.poll(async () => {
      const pixel = await centrePixel(frame);
      return pixel && isFullShader(pixel) ? 'green' : `not green yet: ${pixel}`;
    }, {
      message: 'the untouched Slang shader never rendered green', timeout: 120_000,
    }).toBe('green');

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

    // Every sample the test observes while settling, across all jumps.
    // Collection starts once the first visualization shows: landing on it
    // transitions away from the untouched render, so its green frames are
    // the starting point, not a flash between lines.
    const samples = [];
    let collecting = false;
    // Dark grey for lineA, bright grey for lineB: the two ends of every jump.
    const settleFor = (oneBasedLine, label, minAvg, maxAvg) => expect.poll(async () => {
      const [info, pixel] = await Promise.all([headerInfo(frame), centrePixel(frame)]);
      if (pixel && collecting) samples.push(pixel);
      if (!info.includes(`L${oneBasedLine}`) || !pixel) return 'waiting for the panel';
      if (!isGrey(pixel)) return 'waiting for inline rendering';
      const avg = (pixel[0] + pixel[1] + pixel[2]) / 3;
      return avg >= minAvg && avg <= maxAvg ? label : `waiting for ${label}`;
    }, { message: `inline rendering never showed ${label}`, timeout: 120_000 }).toBe(label);

    // Land on the first line, then jump back and forth: every move is a
    // window in which a full-pipeline compile would hold the whole shader
    // on screen for seconds.
    await moveCursor(vscode, LINES[0] - 1);
    await settleFor(LINES[0], 'line-a', 25, 115);
    collecting = true;

    await moveCursor(vscode, LINES[1] - 1);
    await settleFor(LINES[1], 'line-b', 150, 255);

    await moveCursor(vscode, LINES[0] - 1);
    await settleFor(LINES[0], 'line-a-again', 25, 115);

    expect(samples.length, 'no frames observed across the jumps').toBeGreaterThan(0);

    // No observed frame shows the whole shader: it renders solid green,
    // never grey.
    expect(
      samples.filter(isFullShader),
      'a jump showed the whole Slang shader',
    ).toEqual([]);

    // The jumps actually switched visualizations instead of sticking on one.
    const avgs = samples
      .filter(isGrey)
      .map(([r, g, b]) => (r + g + b) / 3);
    expect(avgs.some((avg) => avg < 115), 'line A visualization never seen').toBe(true);
    expect(avgs.some((avg) => avg > 150), 'line B visualization never seen').toBe(true);
  });
});
