import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { workspace } from './language-service-fixtures.mjs';

async function expectGreen(page) {
  const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => {
    const url = await canvas.evaluate(element => element.toDataURL());
    const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...data.subarray(offset, offset + 3)];
  }).toEqual([0, 255, 0]);
}

for (const language of ['glsl', 'wgsl', 'slang']) {
  test(`${language} selects webcam and microphone, samples live data and persists on reload`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__liveCaptureStreams = [];
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await capture(constraints);
        window.__liveCaptureStreams.push(stream);
        return stream;
      };
    });
    const code = language === 'glsl'
      ? 'void mainImage(out vec4 c, in vec2 p) { float wave = texture(sound.sampler, vec2(.5,.75)).r; vec3 frame = texture(camera.sampler, vec2(.5)).rgb; bool ok = sound.loaded == 1 && sound.size.x == 512. && sound.size.y == 2. && camera.loaded == 1 && camera.size.x > 0. && wave > .1 && dot(frame,frame) > 0.; c = ok ? vec4(0,1,0,1) : vec4(1,0,0,1); }'
      : language === 'slang'
        ? 'float4 mainImage(float2 p) { float wave = sample2DLevel(sound.texture, sound.sampler, float2(.5,.75), 0).r; float3 frame = sample2DLevel(camera.texture, camera.sampler, float2(.5), 0).rgb; bool ok = sound.loaded && sound.size.x == 512 && sound.size.y == 2 && camera.loaded && camera.size.x > 0 && wave > .1 && dot(frame,frame) > 0; return ok ? float4(0,1,0,1) : float4(1,0,0,1); }'
        : 'fn mainImage(p: vec2f) -> vec4f { let wave = sample2DLevel(soundTexture, soundSampler, vec2f(.5,.75), 0).r; let frame = sample2DLevel(cameraTexture, cameraSampler, vec2f(.5), 0).rgb; if (sound.loaded && sound.size.x == 512 && sound.size.y == 2 && camera.loaded && camera.size.x > 0 && wave > .1 && dot(frame,frame) > 0) { return vec4f(0,1,0,1); } return vec4f(1,0,0,1); }';
    await page.route('**/__live_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
    await page.goto('/__live_fixture__');
    await workspace(page, [
      [`live.${language}`, code],
      ['live.sha.json', JSON.stringify({ version: '1', passes: { Image: { inputs: { camera: { type: 'keyboard' }, sound: { type: 'keyboard' } } } } })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-live-${language}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    for (const [name, label] of [['camera', 'Webcam'], ['sound', 'Microphone']]) {
      await page.locator('.channel-row').filter({ hasText: name }).click();
      await page.getByRole('tab', { name: 'Misc', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await expectGreen(page);
    await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/live.sha.json']).passes.Image.inputs).toEqual({ camera: { type: 'webcam' }, sound: { type: 'microphone' } });
    await page.reload();
    await expectGreen(page);
    await expect.poll(() => page.evaluate(() => window.__liveCaptureStreams.length)).toBeGreaterThanOrEqual(2);
    // Make the shader independent of the channels before removing them, so
    // capture teardown is tested through a successful config compilation.
    const plain = language === 'glsl'
      ? 'void mainImage(out vec4 c, in vec2 p) { c = vec4(0,1,0,1); }'
      : language === 'slang' ? 'float4 mainImage(float2 p) { return float4(0,1,0,1); }'
        : 'fn mainImage(p: vec2f) -> vec4f { return vec4f(0,1,0,1); }';
    await page.getByTestId('web-editor').locator('.view-lines').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(plain);
    await expect.poll(async () => (await workspace(page))['/shaders/live.' + language]).toBe(plain);
    for (const name of ['camera', 'sound']) {
      await page.locator('.channel-row').filter({ hasText: name }).click();
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
    }
    await expect.poll(() => page.evaluate(() => window.__liveCaptureStreams.every(stream =>
      stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
    await expectGreen(page);
  });
}
