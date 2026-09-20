import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { addShaderFiles } from './workspace-store.mjs';

const image = `void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 a = texture(iChannel0, uv);
  vec4 b = texture(iChannel1, uv);
  color = vec4(a.r, a.g, b.g * b.b, 1.0);
}`;

const bufferA = `void mainImage(out vec4 color, in vec2 fragCoord) {
  vec4 previous = texture(iChannel0, fragCoord / iResolution.xy);
  float initialized = max(previous.r,
    iFrame == 0 && all(equal(previous, vec4(0.0))) ? 1.0 : 0.0);
  color = vec4(initialized, initialized, 0.0, 1.0);
}`;

const bufferB = `void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 previous = texture(iChannel0, uv);
  vec4 laterBuffer = texture(iChannel1, uv);
  float selfInitialized = max(previous.g,
    iFrame == 0 && all(equal(previous, vec4(0.0))) ? 1.0 : 0.0);
  float crossInitialized = max(previous.b,
    iFrame == 0 && all(equal(laterBuffer, vec4(0.0))) ? 1.0 : 0.0);
  color = vec4(1.0, selfInitialized, crossInitialized, 1.0);
}`;

const config = JSON.stringify({
  version: '1.0',
  passes: {
    BufferB: {
      path: 'reset-atomic-buffer-b.glsl',
      inputs: {
        iChannel0: { type: 'buffer', source: 'BufferB', filter: 'nearest' },
        iChannel1: { type: 'buffer', source: 'BufferA', filter: 'nearest' },
      },
    },
    BufferA: {
      path: 'reset-atomic-buffer-a.glsl',
      inputs: { iChannel0: { type: 'buffer', source: 'BufferA', filter: 'nearest' } },
    },
    Image: {
      inputs: {
        iChannel0: { type: 'buffer', source: 'BufferA', filter: 'nearest' },
        iChannel1: { type: 'buffer', source: 'BufferB', filter: 'nearest' },
      },
    },
  },
});

async function seedResetShader(page) {
  await page.goto('/');
  await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
  await page.route('**/__reset_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/__reset_fixture__');
  await addShaderFiles(page, [
    ['reset-atomic.glsl', image],
    ['reset-atomic-buffer-a.glsl', bufferA],
    ['reset-atomic-buffer-b.glsl', bufferB],
    ['reset-atomic.sha.json', config],
  ]);
  await page.goto('/');
  await page.getByTestId('shader-option-reset-atomic-glsl').click();
}

async function centerPixel(canvas) {
  const dataUrl = await canvas.evaluate(element => element.toDataURL());
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

for (const paused of [false, true]) {
  test(`Reset publishes frame-zero self and cross-buffer state while ${paused ? 'paused' : 'running'}`, async ({ page }) => {
    await seedResetShader(page);
    const preview = page.getByTestId('web-preview');
    const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    const pause = preview.getByLabel('Toggle pause');
    await expect(canvas).toBeVisible();
    await expect.poll(() => centerPixel(canvas)).toEqual([255, 255, 255, 255]);

    if (paused) {
      await pause.click();
      await expect(pause.locator('.codicon-play')).toBeVisible();
    } else {
      await expect(pause.locator('.codicon-debug-pause')).toBeVisible();
    }

    await page.evaluate(() => {
      window.__resetBarrierEntered = false;
      window.__shaderStudioResetCompileBarrier = () => new Promise(resolve => {
        window.__resetBarrierEntered = true;
        window.__releaseResetBarrier = resolve;
      });
    });

    const click = preview.getByLabel('Reset shader', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__resetBarrierEntered)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect.poll(() => centerPixel(canvas)).toEqual([255, 255, 255, 255]);

    await page.evaluate(() => window.__releaseResetBarrier());
    await click;
    await expect.poll(() => centerPixel(canvas)).toEqual([255, 255, 255, 255]);

    if (paused) {
      await expect(pause.locator('.codicon-play')).toBeVisible();
    } else {
      await expect(pause.locator('.codicon-debug-pause')).toBeVisible();
    }
  });
}
