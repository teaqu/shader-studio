import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { workspace } from './language-service-fixtures.mjs';
import { waitForAnimationFrames } from './observable-state.mjs';

// iMouse follows Shadertoy: xy only tracks the pointer while a button is
// held, z is positive while held, and w is positive only on the click frame.
// Each shader paints red for x > 0, green for z > 0 and blue for w > 0.
const SHADERS = {
  glsl: 'void mainImage(out vec4 c, in vec2 p) { c = vec4(step(0.5, iMouse.x), step(0.5, iMouse.z), step(0.5, iMouse.w), 1.0); }',
  wgsl: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(step(0.5, iMouse.x), step(0.5, iMouse.z), step(0.5, iMouse.w), 1.0); }',
};

async function openShader(page, language, source = SHADERS[language]) {
  // Seed before boot: background workspace saves must not overwrite fixtures.
  await page.route('**/__mouse_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/__mouse_fixture__');
  await workspace(page, [
    [`mouse.${language}`, source],
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
    for (let frame = 0; frame < 12; frame += 1) {
      await waitForAnimationFrames(page);
      expect(await centrePixel(canvas)).toEqual([0, 0, 0]);
    }

    // Held: xy and z are set, but w only signalled the click frame.
    await page.mouse.down();
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 255, 0]);
    for (let frame = 0; frame < 12; frame += 1) {
      await waitForAnimationFrames(page);
      expect(await centrePixel(canvas)).toEqual([255, 255, 0]);
    }

    // Released: z goes negative and xy stays at the last drag position.
    await page.mouse.up();
    await page.mouse.move(box.x + 1, box.y + 1);
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 0, 0]);
    await expect(page.getByTestId(`shader-option-mouse-${language}`).locator('.shader-error')).toHaveCount(0);
  });
}

for (const language of ['glsl', 'wgsl']) {
  test(`${language} pointer receives right-click and wheel and the global mouse setting persists`, async ({ page }) => {
    const source = language === 'glsl'
      ? 'void mainImage(out vec4 c, in vec2 p) { c = vec4(iPointer.inside == 1 ? 1.0 : 0.0, (iPointer.held & 2) != 0 ? 1.0 : 0.0, iPointer.wheel.y > 0.0 ? 1.0 : 0.0, 1.0); }'
      : 'fn mainImage(p: vec2f) -> vec4f { return vec4f(select(0.0, 1.0, iPointer.inside == 1), select(0.0, 1.0, (iPointer.held & 2) != 0), select(0.0, 1.0, iPointer.wheel.y > 0.0), 1.0); }';
    const canvas = await openShader(page, language, source);
    await expect(canvas).toBeVisible();
    await page.evaluate(() => document.addEventListener('contextmenu', event => {
      window.__canvasMenuPrevented = event.defaultPrevented;
    }));
    await page.evaluate(() => document.addEventListener('wheel', event => {
      window.__canvasWheelPrevented = event.defaultPrevented;
    }));
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 0, 0]);
    await page.mouse.down({ button: 'right' });
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 255, 0]);
    await page.mouse.up({ button: 'right' });
    await expect.poll(() => page.evaluate(() => window.__canvasMenuPrevented)).toBe(true);
    await page.mouse.wheel(0, 80);
    await expect.poll(() => page.evaluate(() => window.__canvasWheelPrevented)).toBe(true);
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 0, 255]);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('checkbox', { name: 'Prevent default mouse actions' }).uncheck();
    await page.keyboard.press('Escape');
    await canvas.click({ button: 'right' });
    await expect.poll(() => page.evaluate(() => window.__canvasMenuPrevented)).toBe(false);
    await page.evaluate(() => {
      window.__canvasWheelPrevented = undefined;
    });
    await page.mouse.wheel(0, -80);
    await expect.poll(() => page.evaluate(() => window.__canvasWheelPrevented)).toBe(false);
    await expect.poll(() => centrePixel(canvas)).toEqual([255, 0, 0]);
    await page.reload();
    await expect(canvas).toHaveAttribute('data-prevent-mouse-defaults', 'false');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Prevent default mouse actions' })).not.toBeChecked();
  });
}
