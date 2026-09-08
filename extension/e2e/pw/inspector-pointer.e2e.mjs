import { join } from 'node:path';
import { test, expect, workspacePath } from './fixtures.mjs';
import { centrePixel } from './canvas-pixel.mjs';

test.use({ vscodeKey: 'inspector-pointer' });

const shaderPath = join(workspacePath, 'inspector-pointer.slang');
const isRed = ([r, g, b]) => r > 200 && g < 60 && b < 60;
const isGreen = ([r, g, b]) => g > 200 && r < 60 && b < 60;

const pointerTarget = (frame) => frame.evaluate(() => {
  const element = [...document.querySelectorAll(':hover')].at(-1);
  return element ? {
    tag: element.tagName,
    className: element.className,
    cursor: getComputedStyle(element).cursor,
    opacity: getComputedStyle(element).opacity,
  } : null;
});

// boundingBox coordinates include VS Code's nested webview offsets, so these
// points can go straight to the real window mouse. No forced DOM events.
async function overlapPoint(tooltip, target) {
  const a = await tooltip.boundingBox();
  const b = await target.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  expect(right - left, 'fixture must overlap the target horizontally').toBeGreaterThan(2);
  expect(bottom - top, 'fixture must overlap the target vertically').toBeGreaterThan(2);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

test.describe('hidden line tooltip leaves inspector interactive @gpu', () => {
  test.beforeAll(async ({ vscode }) => {
    await vscode.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1400, height: 1000 });
    });
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preview: false,
      });
      const position = new vscode.Position(0, 0);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('shader-studio.view');
    }, shaderPath);

    const frame = await vscode.shaderFrame();
    await expect.poll(async () => isRed(await centrePixel(frame))).toBe(true);
    // VS Code's first-run notifications can cover the preview toolbar.
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.commands.executeCommand('notifications.clearAll');
    });
    await frame.getByLabel('Toggle debug mode', { exact: true }).click();
    const panel = frame.locator('.debug-panel');
    await expect(panel).toBeVisible();
    for (const [name, enabled] of [
      ['Toggle inspector', false],
      ['Toggle inline rendering', false],
      ['Toggle variable inspector', true],
    ]) {
      const button = panel.getByLabel(name, { exact: true });
      if ((await button.getAttribute('class')).split(/\s+/).includes('active') !== enabled) {
        await button.click();
      }
    }
    // Send a cursor change after debugging is enabled, as in normal use.
    await vscode.evaluateInHost(async (vscode, targetPath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One, preview: false,
      });
      const position = new vscode.Position(2, 24);
      editor.selection = new vscode.Selection(position, position);
    }, shaderPath);
    await expect(panel.getByRole('group', { name: 'Preview previewColor', exact: true })).toBeVisible();
    await expect(panel.locator('.header-info').first()).toHaveText('L3');
    await panel.getByLabel('Toggle errors', { exact: true }).hover();
    await expect(panel.locator('.line-tooltip')).toHaveCSS('opacity', '0');
    await expect.poll(async () => isRed(await centrePixel(frame))).toBe(true);
  });

  test('clicking a size under the hidden tooltip changes the active sample size', async ({ vscode }, testInfo) => {
    const frame = await vscode.shaderFrame();
    const tooltip = frame.locator('.line-tooltip');
    const button = frame.locator('.variables-section').getByRole('button', { name: '128', exact: true });
    await expect(button).not.toHaveClass(/active/);
    const point = await overlapPoint(tooltip, button);
    await vscode.window.mouse.click(point.x, point.y);
    await testInfo.attach('after-size-click', { body: await vscode.window.screenshot(), contentType: 'image/png' });
    await expect(button, `mouse hit ${JSON.stringify(await pointerTarget(frame))}`).toHaveClass(/active/);
    // Restore the compact thumbnails before the next gesture's geometry is measured.
    const compact = frame.locator('.variables-section').getByRole('button', { name: '32', exact: true });
    await compact.click();
    await expect(compact).toHaveClass(/active/);
  });

  test('hovering a captured variable under the hidden tooltip shows its full canvas preview', async ({ vscode }, testInfo) => {
    const frame = await vscode.shaderFrame();
    const row = frame.getByRole('group', { name: 'Preview previewColor', exact: true });
    // Control gesture: the same variable previews correctly outside the
    // tooltip's rectangle. A broken renderer must not masquerade as this bug.
    const rowBox = await row.boundingBox();
    const tooltipBox = await frame.locator('.line-tooltip').boundingBox();
    expect(rowBox).not.toBeNull();
    expect(tooltipBox).not.toBeNull();
    expect(rowBox.x + 2).toBeLessThan(tooltipBox.x);
    await vscode.window.mouse.move(rowBox.x + 2, rowBox.y + rowBox.height / 2);
    await expect.poll(async () => isGreen(await centrePixel(frame)), {
      message: 'the uncovered part of the same variable must show a green full preview',
    }).toBe(true);
    await frame.getByLabel('Toggle errors', { exact: true }).hover();
    await expect.poll(async () => isRed(await centrePixel(frame))).toBe(true);
    const point = await overlapPoint(frame.locator('.line-tooltip'), row);
    await vscode.window.mouse.move(point.x, point.y);
    const hit = await pointerTarget(frame);
    await testInfo.attach('after-variable-hover', { body: await vscode.window.screenshot(), contentType: 'image/png' });
    await expect.poll(async () => isGreen(await centrePixel(frame)), {
      message: `hovering the captured green variable must replace the red main canvas with its full preview; mouse hit ${JSON.stringify(hit)}`,
    }).toBe(true);
    await frame.getByLabel('Toggle errors', { exact: true }).hover();
    await expect.poll(async () => isRed(await centrePixel(frame)), {
      message: 'leaving the variable must restore the main shader',
    }).toBe(true);
  });

  test('the visible line tooltip still accepts hover from its badge', async ({ vscode }) => {
    const frame = await vscode.shaderFrame();
    const tooltip = frame.locator('.line-tooltip');
    await frame.locator('.line-tooltip-anchor .header-info').hover();
    await expect(tooltip).toHaveCSS('opacity', '1');
    await tooltip.hover({ position: { x: 8, y: 8 } });
    await expect(tooltip).toHaveCSS('pointer-events', 'auto');
    await expect(tooltip).toHaveCSS('opacity', '1');
    await frame.getByLabel('Toggle errors', { exact: true }).hover();
    await expect(tooltip).toHaveCSS('opacity', '0');
    await expect(tooltip).toHaveCSS('pointer-events', 'none');
  });
});
