import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { workspace } from './language-service-fixtures.mjs';

async function openProject(page, entries, name) {
  // Seed before boot: background workspace saves must not overwrite fixtures.
  await page.route('**/__channel_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/__channel_fixture__');
  await workspace(page, entries);
  await page.goto('/');
  await page.getByTestId(`shader-option-${name}`).click();
}
async function expectGreen(page) {
  const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => {
    // Headless compositor screenshots returned black for WebGPU while toDataURL
    // read the actual green canvas. Assert native canvas pixels for both engines.
    const url = await canvas.evaluate(element => element.toDataURL());
    const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...data.subarray(offset, offset + 3)];
  }).toEqual([0, 255, 0]);
}
async function replaceSource(page, code) {
  const editor = page.getByTestId('web-editor');
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(code);
}

for (const language of ['glsl', 'slang', 'wgsl']) {
  test(`edits named ${language} channel metadata and sampling, then reloads`, async ({ page }) => {
    const good = language === 'glsl'
      ? 'void mainImage(out vec4 c, in vec2 p) { c = albedo.loaded == 1 && albedo.size.x == 256. && albedo.time == 0. ? vec4(0,1,0,1) + texture(albedo.sampler,vec2(0)).rrrr : vec4(1,0,0,1); }'
      : language === 'slang'
        ? 'float4 mainImage(float2 p) { return albedo.loaded && albedo.size.x == 256 && albedo.time == 0 ? float4(0,1,0,1) + sample2DLevel(albedo.texture, albedo.sampler, float2(0), 0).rrrr : float4(1,0,0,1); }'
        : 'fn mainImage(p: vec2f) -> vec4f { if (albedo.loaded && albedo.size.x == 256 && albedo.time == 0) { return vec4f(0,1,0,1) + sample2DLevel(albedoTexture, albedoSampler, vec2f(0), 0).rrrr; } return vec4f(1,0,0,1); }';
    const initial = language === 'glsl' ? 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1,0,0,1); }'
      : language === 'slang' ? 'float4 mainImage(float2 p) { return float4(1,0,0,1); }'
        : 'fn mainImage(p: vec2f) -> vec4f { return vec4f(1,0,0,1); }';
    await openProject(page, [
      [`named.${language}`, initial],
      ['named.sha.json', JSON.stringify({ version: '1', passes: { Image: { inputs: { albedo: { type: 'keyboard' } } } } })],
    ], `named-${language}`);
    await replaceSource(page, good);
    await expectGreen(page);
    await expect.poll(async () => (await workspace(page))['/shaders/named.' + language]).toBe(good);
    await page.reload();
    await expectGreen(page);
  });
}

test('WGSL named channel Load renders after editing and persists across reload', async ({ page }) => {
  const initial = 'fn mainImage(p: vec2f) -> vec4f { return vec4f(1,0,0,1); }';
  const good = 'fn mainImage(p: vec2f) -> vec4f { return vec4f(0,1,0,1) + albedoLoad(vec2i(0)).rrrr; }';
  await openProject(page, [
    ['load.wgsl', initial],
    ['load.sha.json', JSON.stringify({ version: '1', passes: { Image: { inputs: { albedo: { type: 'keyboard' } } } } })],
  ], 'load-wgsl');

  await replaceSource(page, good);
  await expectGreen(page);
  await expect.poll(async () => (await workspace(page))['/shaders/load.wgsl']).toBe(good);
  await page.reload();
  await expectGreen(page);
});

test('WGSL compute reports implicit sampling and recovers after an explicit-LOD edit', async ({ page }) => {
  const invalid = '@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) { writeOutput(id.xy, vec4f(0,1,0,1) + keysSample(vec2f(0))); }';
  const valid = invalid.replace('keysSample(vec2f(0))', 'sample2DLevel(keysTexture, keysSampler, vec2f(0), 0)');
  await openProject(page, [
    ['stage.wgsl', 'fn mainImage(p: vec2f) -> vec4f { return resultSampleLevel(p / iResolution.xy, 0); }'],
    ['update.wgsl', invalid],
    ['stage.sha.json', JSON.stringify({ version: '1', passes: {
      Image: { inputs: { result: { type: 'buffer', source: 'Compute' } } },
      Compute: { type: 'compute', path: 'update.wgsl', entryPoint: 'update', inputs: { keys: { type: 'keyboard' } } },
    } })],
  ], 'stage-wgsl');
  await expect(page.getByTestId('shader-option-stage-wgsl').locator('.shader-error')).toBeVisible();
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Hide Buffers', { exact: true }).uncheck();
  await page.getByTestId('shader-option-update-wgsl').click();
  await replaceSource(page, valid);
  await expect.poll(async () => (await workspace(page))['/shaders/update.wgsl']).toBe(valid);
  await page.getByTestId('shader-option-stage-wgsl').click();
  await expectGreen(page);
  await expect(page.getByTestId('shader-option-stage-wgsl').locator('.shader-error')).toHaveCount(0);
  await page.reload();
  await expectGreen(page);
});

for (const language of ['glsl', 'slang', 'wgsl']) {
  test(`${language} cubemap metadata becomes loaded and samples the positive-Y face`, async ({ page }) => {
    const cross = new PNG({ width: 4, height: 3 });
    // All faces red except +Y (column 1, row 0), which is green.
    for (let i = 0; i < 12; i++) {
      cross.data.set(i === 1 ? [0,255,0,255] : [255,0,0,255], i * 4);
    }
    await page.route('**/channel-cube.png', route => route.fulfill({ contentType: 'image/png', body: PNG.sync.write(cross) }));
    const image = language === 'glsl'
      ? 'void mainImage(out vec4 c, in vec2 p) { c = sky.loaded == 1 && sky.size.x == 1. && sky.time == 0. ? textureLod(sky.sampler,vec3(0,1,0),0.) : vec4(1,0,0,1); }'
      : language === 'slang'
        ? 'float4 mainImage(float2 p) { return sky.loaded && sky.size.x == 1 && sky.time == 0 ? sampleCubeLevel(sky.texture,sky.sampler,float3(0,1,0),0) : float4(1,0,0,1); }'
        : 'fn mainImage(p: vec2f) -> vec4f { if (sky.loaded && sky.size.x == 1 && sky.time == 0) { return sampleCubeLevel(skyTexture,skySampler,vec3f(0,1,0),0); } return vec4f(1,0,0,1); }';
    await openProject(page, [
      [`cube.${language}`, image],
      ['cube.sha.json', JSON.stringify({ version: '1', passes: { Image: { inputs: { sky: { type: 'cubemap', path: 'http://127.0.0.1:4174/channel-cube.png', filter: 'nearest' } } } } })],
    ], `cube-${language}`);
    await expectGreen(page);
    await page.reload();
    await expectGreen(page);
  });
}
