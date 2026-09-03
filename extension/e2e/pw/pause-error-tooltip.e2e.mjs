import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const shaderPath = join(workspacePath, 'tooltip-many-errors.slang');

test.use({ vscodeKey: 'pause-error-tooltip' });

/**
 * The tooltip's geometry depends on layout the unit tests cannot produce: its
 * own padding and border, and the dockview pane it lives in, which is laid out
 * independently of the webview that clips it. Every regression here has been
 * invisible to jsdom, so this drives the real thing in a deliberately small
 * window with a shader that fails on many lines at once.
 */
test.describe('pause error tooltip geometry', () => {
  /** @type {{ tooltip: any, viewport: any, blocks: any[] }} */
  let measured;

  test.beforeAll(async ({ vscode }) => {
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    let frame = await vscode.shaderFrame();
    await expect.poll(() => frame.locator('.error-tooltip').count(), { timeout: 30_000 }).toBeGreaterThan(0);

    await vscode.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ ...win.getBounds(), height: 420, width: 900 });
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    frame = await vscode.shaderFrame();

    await frame.getByLabel('Toggle pause').hover();
    await expect.poll(
      () => frame.locator('.error-tooltip.visible').count(),
      { message: 'tooltip never became visible', timeout: 10_000 },
    ).toBeGreaterThan(0);

    measured = await frame.evaluate(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
      };
      const tooltip = document.querySelector('.error-tooltip');
      return {
        viewport: { height: window.innerHeight, width: window.innerWidth },
        anchor: box(document.querySelector('.pause-button-container')),
        tooltip: {
          ...box(tooltip),
          maxHeight: parseFloat(tooltip.style.maxHeight),
          maxWidth: parseFloat(tooltip.style.maxWidth),
          scrollHeight: tooltip.scrollHeight,
        },
        blocks: [...document.querySelectorAll('.error-tooltip-block')].map(box),
        // What the viewer would actually click at the tooltip's centre: if a
        // panel paints over it, this is not the tooltip.
        topmostAtCentre: (() => {
          const r = tooltip.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit ? !!hit.closest('.error-tooltip') : false;
        })(),
        portalledToBody: tooltip.parentElement === document.body,
      };
    });
  });

  test('overflows its own content rather than the pane', () => {
    // A shader broken on eight lines produces more than a short pane can show.
    expect(measured.tooltip.scrollHeight).toBeGreaterThan(measured.tooltip.height);
  });

  test('stays inside the pane on every edge', () => {
    expect(measured.tooltip.top, 'runs off the top').toBeGreaterThanOrEqual(0);
    expect(measured.tooltip.right, 'runs past the right edge')
      .toBeLessThanOrEqual(measured.viewport.width);
    expect(measured.tooltip.bottom).toBeLessThanOrEqual(measured.viewport.height);
  });

  test('counts padding and border inside its measured cap', () => {
    // content-box sizing put the box ~18px past the room measured for it.
    expect(measured.tooltip.height).toBeLessThanOrEqual(Math.ceil(measured.tooltip.maxHeight));
    expect(measured.tooltip.width).toBeLessThanOrEqual(Math.ceil(measured.tooltip.maxWidth));
  });

  test('is not painted over by the panels around it', () => {
    // It used to live inside the dockview pane, which clipped it at the pane
    // edge and let neighbouring panels stack above it.
    expect(measured.portalledToBody).toBe(true);
    expect(measured.topmostAtCentre).toBe(true);
  });

  test('splits the compile into one block per diagnostic', () => {
    expect(measured.blocks.length).toBeGreaterThan(1);
  });

  test('opens flush against the pause button, leaving no gap to cross', () => {
    // The tooltip is portalled to the body and is hovered to reach its copy
    // button. Any gap between the two is dead space: crossing it hands the
    // pointer to the body, which disarms the hover and closes the tooltip.
    const anchorEdge = measured.tooltip.top < measured.anchor.top
      ? measured.anchor.top
      : measured.anchor.bottom;
    const touchingEdge = measured.tooltip.top < measured.anchor.top
      ? measured.tooltip.bottom
      : measured.tooltip.top;

    expect(Math.abs(touchingEdge - anchorEdge)).toBeLessThanOrEqual(1);
  });

  test('can be walked into from the pause button to copy the errors', async ({ vscode }) => {
    const frame = await vscode.shaderFrame();

    await frame.getByLabel('Toggle pause').hover();
    await expect.poll(() => frame.locator('.error-tooltip.visible').count()).toBeGreaterThan(0);

    // The real gesture: leave the button for the tooltip. This is what the gap
    // used to break — the tooltip closed before the pointer arrived.
    await frame.getByLabel('Copy error to clipboard').hover();
    await expect(frame.locator('.error-tooltip.visible')).toHaveCount(1);

    await frame.getByLabel('Copy error to clipboard').click();
    await expect.poll(() => frame.evaluate(() => navigator.clipboard.readText()))
      .toContain('error');
  });
});
