import { expect, test } from '@playwright/test';

import { workspace } from './language-service-fixtures.mjs';

test('canvas click moves keyboard focus out of the editor', async ({ page }) => {
  const shaderName = 'canvas-focus.glsl';
  const source = 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(coord.x); }';
  await page.route('**/__focus_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
  await page.goto('/__focus_fixture__');
  await workspace(page, [
    [shaderName, source],
    ['canvas-focus.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await page.goto('/');
  await page.getByTestId('shader-option-canvas-focus-glsl').click();
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  const disableVim = editor.getByLabel('Disable Vim mode');
  if (await disableVim.count()) {
    await disableVim.click();
  }

  // Sanity: with the editor focused, typing edits the document.
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await page.keyboard.type('q');
  await expect(editor.locator('.view-lines')).toContainText('q');

  // The user's path: click the real preview canvas, then type.
  const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(canvas).toBeVisible();
  await canvas.click();
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector('[data-testid="web-preview"] .canvas-container > canvas:not(.pixel-canvas-marker)');
    return document.activeElement === target;
  })).toBe(true);

  const textBefore = await editor.locator('.view-lines').innerText();
  await page.keyboard.type('z');
  await page.waitForTimeout(300);
  expect(await editor.locator('.view-lines').innerText()).toBe(textBefore);

  // Focus returns to the editor when it is clicked again.
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await page.keyboard.type('e');
  await expect(editor.locator('.view-lines')).toContainText('e');
});
