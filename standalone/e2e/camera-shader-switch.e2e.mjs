import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

const sources = {
  glsl: `void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(abs(iWorldPosition) * 0.65 + vec3(0.08, 0.03, 0.12), 1.0);
}`,
  wgsl: `fn mainImage(coord: vec2f) -> vec4f {
  return vec4f(abs(iWorldPosition) * 0.65 + vec3f(0.08, 0.03, 0.12), 1.0);
}`,
  slang: `float4 mainImage(float2 coord) {
  return float4(abs(iWorldPosition) * 0.65 + float3(0.08, 0.03, 0.12), 1);
}`,
};

for (const [language, source] of Object.entries(sources)) {
  test(`opening another ${language} shader resets the 3D camera`, async ({ page }) => {
    await page.route('**/__camera_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Camera fixture</title>' }));
    await page.goto('/__camera_fixture__');
    const config = JSON.stringify({ version: '1.0', passes: { Image: { geometry: { type: 'cube' } } } });
    await workspace(page, [
      [`camera-first.${language}`, source], ['camera-first.sha.json', config],
      [`camera-second.${language}`, source], ['camera-second.sha.json', config],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-camera-first-${language}`).click();
    const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    const read = () => canvas.evaluate(element => element.toDataURL());
    // Wait for a rendered cube rather than accepting the initial blank canvas.
    await expect.poll(() => canvas.evaluate(async element => {
      const bitmap = await createImageBitmap(await (await fetch(element.toDataURL())).blob());
      const target = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = target.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context.getImageData(0, 0, target.width, target.height).data.some((value, index) => index % 4 !== 3 && value > 0);
    })).toBe(true);
    const initial = await read();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await expect.poll(read).not.toBe(initial);
    await page.getByTestId(`shader-option-camera-second-${language}`).click();
    await expect.poll(read).toBe(initial);
    await page.getByTestId(`shader-option-camera-first-${language}`).click();
    await expect.poll(read).toBe(initial);
  });
}
