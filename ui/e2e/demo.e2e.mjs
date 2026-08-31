import { expect, test } from '@playwright/test';

test('shows a resizable editor beside the preview and switches among bundled demos', async ({ page }) => {
  const languageWorkerRequests = new Set();
  page.on('request', (request) => {
    const url = request.url();
    if (/\/(?:glsl|slang)LanguageService\.worker-[^/]+\.js$/.test(url)) {
      languageWorkerRequests.add(url);
    }
  });

  await page.goto('/');

  const editor = page.getByTestId('demo-editor');
  const preview = page.getByTestId('demo-preview');
  const explorer = page.getByTestId('demo-shader-explorer');
  const demoTitlebar = page.getByTestId('demo-titlebar');
  await expect(demoTitlebar).toContainText('Demo mode');
  await expect(demoTitlebar).toContainText('Changes are saved in this browser. Some extension features are unavailable.');
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(explorer).toBeVisible();
  await expect(explorer.getByPlaceholder('Search shaders...')).toHaveCount(0);
  await expect(explorer.getByTestId('demo-explorer-toolbar').getByRole('button')).toHaveCount(1);
  await expect(explorer.getByRole('button', { name: 'Reset examples' })).toBeVisible();
  await expect.poll(async () => explorer.locator('.shader-thumbnail img').count()).toBeGreaterThanOrEqual(4);
  const thumbnailSources = await explorer.locator('.shader-thumbnail img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  expect(new Set(thumbnailSources).size).toBeGreaterThan(1);
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect.poll(async () => (await editor.locator('.monaco-editor').boundingBox())?.height).toBeGreaterThan(100);
  await expect.poll(() => [...languageWorkerRequests].some((url) => url.includes('/glslLanguageService.worker-'))).toBe(true);

  const editorBox = await editor.boundingBox();
  const previewBox = await preview.boundingBox();
  const explorerBox = await explorer.boundingBox();
  const titlebarBox = await demoTitlebar.boundingBox();
  expect(explorerBox?.width).toBeLessThanOrEqual(260);
  expect(explorerBox?.x).toBeLessThan(editorBox?.x ?? 0);
  expect(editorBox?.x).toBeLessThan(previewBox?.x ?? 0);
  expect((titlebarBox?.y ?? 0) + (titlebarBox?.height ?? 0)).toBeLessThanOrEqual((editorBox?.y ?? 0) + 37);

  // The fixed-width Explorer divider is disabled; the remaining enabled sash
  // is the resizable Editor/Preview boundary.
  const sash = page.locator('.dv-sash.dv-enabled').first();
  await expect(sash).toBeVisible();
  const sashBox = await sash.boundingBox();
  expect(sashBox).not.toBeNull();
  await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + sashBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sashBox.x + 120, sashBox.y + sashBox.height / 2);
  await page.mouse.up();
  await expect.poll(async () => (await editor.boundingBox())?.width).toBeGreaterThan(editorBox?.width ?? 0);

  await page.getByTestId('demo-shader-option-slang').click();
  await expect(editor.locator('.view-lines')).toContainText('Aurora Slang / WebGPU demo');
  await expect.poll(() => [...languageWorkerRequests].some((url) => url.includes('/slangLanguageService.worker-'))).toBe(true);

  await page.getByTestId('demo-shader-option-image').click();
  await expect(editor.locator('.view-lines')).toContainText('Bundled image input demo');
  await expect(page.getByTestId('demo-shader-option-image')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('demo-shader-option-video').click();
  await expect(editor.locator('.view-lines')).toContainText('Bundled video input demo');

  await page.getByTestId('demo-shader-option-cubemap').click();
  await expect(editor.locator('.view-lines')).toContainText('Bundled cubemap input demo');
  const previewCanvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(previewCanvas).toBeVisible();
  const cubemapBeforeDrag = await previewCanvas.screenshot();
  const canvasBox = await previewCanvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.8, canvasBox.y + canvasBox.height * 0.35);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect((await previewCanvas.screenshot()).equals(cubemapBeforeDrag)).toBe(false);
  for (const asset of [
    'demo-assets/nebula-texture.png',
    'demo-assets/nebula-motion.mp4',
    'demo-assets/desert-cubemap-cross.png',
  ]) {
    const response = await page.request.get(`/${asset}`);
    expect(response.ok()).toBe(true);
  }

  await page.reload();
  await expect(page.getByTestId('demo-shader-option-cubemap')).toHaveAttribute('aria-pressed', 'true');
  await explorer.getByRole('button', { name: 'Reset examples' }).click();
  await expect(page.getByTestId('demo-shader-option-glsl')).toHaveAttribute('aria-pressed', 'true');
});
