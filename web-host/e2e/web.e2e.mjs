import { expect, test } from '@playwright/test';

test('runs a persistent virtual shader workspace in web mode', async ({ page }) => {
  const languageWorkerRequests = new Set();
  page.on('request', (request) => {
    const url = request.url();
    if (/\/(?:glsl|slang)LanguageService\.worker-[^/]+\.js$/.test(url)) {
      languageWorkerRequests.add(url);
    }
  });

  await page.goto('/');

  const editor = page.getByTestId('web-editor');
  const preview = page.getByTestId('web-preview');
  const explorer = page.getByTestId('web-shader-explorer');
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(explorer).toBeVisible();
  await expect.poll(() => page.evaluate(() => [
    document.querySelector('meta[name="shader-studio-slang-script-url"]')?.getAttribute('content'),
    document.querySelector('meta[name="shader-studio-slang-wasm-url"]')?.getAttribute('content'),
    document.querySelector('meta[name="shader-studio-slang-worker-url"]')?.getAttribute('content'),
  ].every(Boolean))).toBe(true);
  await expect(explorer.getByPlaceholder('Search shaders...')).toBeVisible();
  await expect.poll(async () => explorer.locator('.shader-thumbnail img').count()).toBeGreaterThanOrEqual(4);
  const thumbnailSources = await explorer.locator('.shader-thumbnail img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  expect(new Set(thumbnailSources).size).toBeGreaterThan(1);
  await expect(editor.locator('.monaco-editor')).toBeVisible();

  await page.getByLabel('Open options menu').click();
  await page.getByLabel('Open editor submenu').click();
  await page.getByLabel('Enable editor overlay').click();
  const overlayEditor = page.locator('.editor-wrapper:not(.pane)');
  await expect(overlayEditor).toBeVisible();
  await expect(editor.getByLabel('Enable Vim mode')).toHaveAttribute('aria-pressed', 'false');
  await editor.getByLabel('Enable Vim mode').click();
  await expect(editor.getByLabel('Disable Vim mode')).toHaveAttribute('aria-pressed', 'true');

  page.once('dialog', (dialog) => dialog.accept('starter.glsl'));
  await explorer.getByTitle('New Shader').click();
  const starterShader = page.getByTestId('shader-option-starter-glsl');
  await expect(starterShader).toBeVisible();
  await expect(starterShader.locator('.shader-error')).toHaveCount(0);
  await expect(starterShader.locator('.shader-thumbnail img')).toBeVisible();
  await expect.poll(async () => (await editor.locator('.monaco-editor').boundingBox())?.height).toBeGreaterThan(100);
  await expect.poll(() => [...languageWorkerRequests].some((url) => url.includes('/glslLanguageService.worker-'))).toBe(true);

  const editorInput = editor.locator('.inputarea');
  await editorInput.click();
  await editorInput.press('Control+A');
  await editorInput.type('void mainImage(out vec4 color, in vec2 coord) {\n  norm\n}');
  await editorInput.press('Control+Space');
  await expect(editor.locator('.suggest-widget')).toBeVisible();
  await expect(editor.locator('.suggest-widget')).toContainText('normalize');

  const editorBox = await editor.boundingBox();
  const previewBox = await preview.boundingBox();
  const explorerBox = await explorer.boundingBox();
  expect(explorerBox?.width).toBeLessThanOrEqual(260);
  expect(explorerBox?.x).toBeLessThan(editorBox?.x ?? 0);
  expect(editorBox?.x).toBeLessThan(previewBox?.x ?? 0);

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

  await page.getByTestId('shader-option-aurora-slang').click();
  await expect(editor.locator('.view-lines')).toContainText('Aurora Slang / WebGPU');
  await expect.poll(() => [...languageWorkerRequests].some((url) => url.includes('/slangLanguageService.worker-'))).toBe(true);

  await page.getByTestId('shader-option-nebula-texture-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default texture');
  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('shader-option-nebula-video-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default video');

  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default cubemap');
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
    'assets/nebula-texture.png',
    'assets/nebula-motion.mp4',
    'assets/desert-cubemap-cross.png',
  ]) {
    const response = await page.request.get(`/${asset}`);
    expect(response.ok()).toBe(true);
  }

  await page.reload();
  await expect(page.getByTestId('shader-option-desert-cubemap-glsl')).toHaveAttribute('aria-pressed', 'true');
});
