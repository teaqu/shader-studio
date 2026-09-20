import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

/** Brightest and darkest pixel of the preview canvas, as luminance bytes. */
async function canvasRange(preview) {
  const url = await preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)')
    .evaluate(canvas => canvas.toDataURL());
  const { data } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] + data[i + 1] + data[i + 2]) / 3;
    min = Math.min(min, luma);
    max = Math.max(max, luma);
  }
  return { min, max };
}

test('the bundled WGSL compute sample renders its particle density grid', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  const sample = explorer.getByTestId('shader-option-particle-swarm-wgsl');
  await expect(sample).toBeVisible();
  // Pass sources are hidden by the explorer's default "Hide Buffers" filter,
  // so the compute kernels never show up as broken shaders of their own.
  await expect(explorer.getByTestId('shader-option-swarm-buffer-wgsl')).toHaveCount(0);
  await expect(explorer.getByTestId('shader-option-common-buffer-wgsl')).toHaveCount(0);

  await sample.click();
  const preview = page.getByTestId('web-preview');
  // Particles tallied into the atomic grid light cells well above the backdrop,
  // while the unvisited parts of the grid stay at the dark backdrop colour.
  await expect.poll(async () => (await canvasRange(preview)).max, { timeout: 15000 })
    .toBeGreaterThan(40);
  expect((await canvasRange(preview)).min).toBeLessThan(20);
  // Checked after the first frames, so a compile failure cannot slip through
  // while the pass is still being built.
  await expect(preview.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
  await expect(sample.locator('.shader-error')).toHaveCount(0);
});
