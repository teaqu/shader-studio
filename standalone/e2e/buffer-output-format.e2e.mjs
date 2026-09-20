import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { addShaderFiles } from './workspace-store.mjs';

const bufferA = `void mainImage(out vec4 color, in vec2 fragCoord) {
  color = vec4(1.0001, 0.0, 0.0, 1.0);
}`;

const image = `void mainImage(out vec4 color, in vec2 fragCoord) {
  float stored = texture(iChannel0, fragCoord / iResolution.xy).r;
  color = vec4((stored - 1.0) * 5000.0, 0.0, 0.0, 1.0);
}`;

const config = JSON.stringify({
  version: '1.0',
  passes: {
    BufferA: { path: 'precision-source.glsl', outputFormat: 'rgba32float', inputs: {} },
    Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA', filter: 'nearest' } } },
  },
});

async function seedShader(page) {
  await page.route('**/__buffer_output_format_fixture__', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html></html>',
  }));
  await page.goto('/__buffer_output_format_fixture__');
  // The explorer hides any shader whose name contains "buffer", so the
  // fixture names avoid the word.
  await addShaderFiles(page, [
    ['precision-feedback.glsl', image],
    ['precision-source.glsl', bufferA],
    ['precision-feedback.sha.json', config],
  ]);
  await page.goto('/');
  await page.getByTestId('shader-option-precision-feedback-glsl').click();
}

/** Open the config panel if the toolbar shows it closed, then select BufferA. */
async function openBufferAConfig(page, preview) {
  const toggle = preview.getByLabel('Toggle config panel');
  await expect(toggle).toBeEnabled();
  if (!await toggle.evaluate(element => element.classList.contains('active'))) {
    await toggle.click();
  }
  await page.locator('[data-tab-name="BufferA"]').click();
}

async function centerRed(canvas) {
  const dataUrl = await canvas.evaluate(element => element.toDataURL());
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  return png.data[(Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4];
}

test('GLSL BufferA output format changes the rendered feedback texture and persists after reload', async ({ page }) => {
  await seedShader(page);
  const preview = page.getByTestId('web-preview');
  const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(canvas).toBeVisible();

  // A 32-bit target preserves 1.0001, so Image magnifies the residual to red.
  await expect.poll(() => centerRed(canvas)).toBeGreaterThan(80);

  await openBufferAConfig(page, preview);
  const format = page.getByLabel('Output format');
  await expect(format).toHaveValue('rgba32float');
  await format.selectOption('rgba16float');
  await expect(format).toHaveValue('rgba16float');

  // Half precision rounds 1.0001 to 1.0, leaving no residual to display.
  await expect.poll(() => centerRed(canvas)).toBeLessThan(20);

  await page.reload();
  const reloadedPreview = page.getByTestId('web-preview');
  const reloadedCanvas = reloadedPreview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(reloadedCanvas).toBeVisible();
  await expect.poll(() => centerRed(reloadedCanvas)).toBeLessThan(20);

  await openBufferAConfig(page, reloadedPreview);
  await expect(page.getByLabel('Output format')).toHaveValue('rgba16float');
});
