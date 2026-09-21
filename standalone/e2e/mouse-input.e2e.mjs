import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { workspace } from './language-service-fixtures.mjs';

// iMouse follows Shadertoy: xy only tracks the pointer while a button is
// held, z is positive while held, and w is positive only on the click frame.
// Each shader paints red for x > 0, green for z > 0 and blue for w > 0.
const SHADERS = {
  glsl: 'void mainImage(out vec4 c, in vec2 p) { c = vec4(step(0.5, iMouse.x), step(0.5, iMouse.z), step(0.5, iMouse.w), 1.0); }',
  wgsl: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(step(0.5, iMouse.x), step(0.5, iMouse.z), step(0.5, iMouse.w), 1.0); }',
};

async function openShader(page, language) {
  // Seed before boot: background workspace saves must not overwrite fixtures.
  await page.route('**/__mouse_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/__mouse_fixture__');
  await workspace(page, [
    [`mouse.${language}`, SHADERS[language]],
    ['mouse.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await page.goto('/');
  await page.getByTestId(`shader-option-mouse-${language}`).click();
  return page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
}

async function centrePixel(canvas) {
  // Headless compositor screenshots can read back black for WebGPU, so read
  // the canvas itself.
  const url = await canvas.evaluate(element => element.toDataURL());
  const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
  const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  return [...data.subarray(offset, offset + 3)];
}

for (const language of ['glsl', 'wgsl']) {
  test(`${language} iMouse matches Shadertoy for hover, hold and release`, async ({ page }) => {
    const canvas = await openShader(page, language);
    await expect(canvas).toBeVisible();
    await expect.poll(() => centrePixel(canvas)).toEqual([0, 0, 0]);
    const box = await canvas.boundingBox();

    // Hovering without a button must not move iMouse.xy.
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
    await page.waitForTimeout(250);
    expect(await centrePixel(canvas)).toEqual([0, 0, 0]);

    // Held: xy and z are set, but w only signalled the click frame.
    await page.mouse.down();
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 255, 0]);
    await page.waitForTimeout(250);
    expect(await centrePixel(canvas)).toEqual([255, 255, 0]);

    // Released: z goes negative and xy stays at the last drag position.
    await page.mouse.up();
    await page.mouse.move(box.x + 1, box.y + 1);
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 0, 0]);
    await expect(page.getByTestId(`shader-option-mouse-${language}`).locator('.shader-error')).toHaveCount(0);
  });
}
