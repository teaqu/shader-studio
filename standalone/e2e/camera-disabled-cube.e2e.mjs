import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

const sources = {
  glsl: `void mainImage(out vec4 color, vec2 coord) { color = vec4(abs(iWorldPosition) * 0.65 + vec3(0.08), 1.0); }`,
  wgsl: `fn mainImage(coord: vec2f) -> vec4f {
  return vec4f(abs(iWorldPosition) * 0.65 + vec3f(0.08), 1.0);
}`,
  slang: `float4 mainImage(float2 coord) {
  return float4(abs(iWorldPosition) * 0.65 + float3(0.08), 1);
}`,
};

async function hasColor(canvas) {
  return canvas.evaluate(async element => {
    const bitmap = await createImageBitmap(await (await fetch(element.toDataURL())).blob());
    const target = new OffscreenCanvas(1, 1);
    const context = target.getContext('2d');
    context.drawImage(bitmap, Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1, 0, 0, 1, 1);
    bitmap.close();
    return context.getImageData(0, 0, 1, 1).data.slice(0, 3).some(value => value > 0);
  });
}

for (const [language, source] of Object.entries(sources)) {
  test(`unchecking Use viewer camera keeps an unmodified ${language} cube visible`, async ({ page }) => {
    await page.route('**/__camera_cube_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Camera fixture</title>' }));
    await page.goto('/__camera_cube_fixture__');
    await workspace(page, [
      [`camera-cube.${language}`, source],
      ['camera-cube.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { geometry: { type: 'cube' } } } })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-camera-cube-${language}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    const camera = page.getByLabel('Use viewer camera', { exact: true });
    const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    if (language === 'glsl') {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.getByLabel('Use viewer camera', { exact: true }).uncheck();
      await settings.getByRole('button', { name: 'Done' }).click();
      await expect(camera).not.toBeChecked();
      await expect.poll(() => hasColor(canvas)).toBe(true);
      await camera.check();
    }
    await expect(camera).toBeChecked();
    await expect.poll(() => hasColor(canvas)).toBe(true);
    const orbitView = await canvas.evaluate(element => element.toDataURL());
    await camera.uncheck();
    await expect.poll(() => hasColor(canvas)).toBe(true);
    await expect.poll(() => canvas.evaluate(element => element.toDataURL())).not.toBe(orbitView);
    const rawView = await canvas.evaluate(element => element.toDataURL());
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => canvas.evaluate(element => element.toDataURL())).toBe(rawView);
    await page.reload();
    await expect(camera).not.toBeChecked();
    await expect.poll(() => hasColor(canvas)).toBe(true);
    await camera.check();
    await expect.poll(() => hasColor(canvas)).toBe(true);
    await camera.uncheck();
    await expect.poll(() => hasColor(canvas)).toBe(true);
  });
}
