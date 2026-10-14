import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { workspace } from './language-service-fixtures.mjs';

const volume = readFileSync(new URL('../../tests/fixtures/shader-corpus/assets/volume-input/axis-ramp.ktx2', import.meta.url));
const shaders = {
  glsl: 'void mainImage(out vec4 c, in vec2 p) { vec3 v = texture(iChannel0, vec3(0.9375)).rgb; c = all(greaterThan(v, vec3(0.99))) && iCh0.loaded == 1 && all(equal(iCh0.size, vec3(8))) ? vec4(0,1,0,1) : vec4(1,0,0,1); }',
  slang: 'float4 mainImage(float2 p) { float3 v = iChannel0.SampleLevel(float3(0.9375), 0).rgb; return all(v > 0.99) && iChannel0.loaded && all(iChannel0.size == uint3(8)) ? float4(0,1,0,1) : float4(1,0,0,1); }',
  wgsl: 'fn mainImage(p: vec2f) -> vec4f { let v = iChannel0SampleLevel(vec3f(0.9375), 0).rgb; if (all(v > vec3f(0.99)) && iChannel0Loaded() && all(iChannel0Size() == vec3u(8))) { return vec4f(0,1,0,1); } return vec4f(1,0,0,1); }',
};

for (const [language, source] of Object.entries(shaders)) {
  test(`volume controls and GPU sampling persist in standalone ${language}`, async ({ page, baseURL }) => {
    await page.route('**/__volume_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
    await page.route('**/__axis.ktx2', route => route.fulfill({ contentType: 'image/ktx2', body: volume }));
    await page.goto('/__volume_fixture__');
    const path = `${baseURL}/__axis.ktx2`;
    const config = { version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'volume', path, filter: 'linear', wrap: 'repeat' } } } } };
    await workspace(page, [[`volume.${language}`, source], ['volume.sha.json', JSON.stringify(config)]]);
    await page.goto('/');
    await page.getByTestId(`shader-option-volume-${language}`).click();
    const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    const green = async () => {
      await expect.poll(async () => {
        const url = await canvas.evaluate(element => element.toDataURL());
        const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
        const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
        return [...data.subarray(offset, offset + 3)];
      }).toEqual([0, 255, 0]);
    };
    await green();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.getByRole('button', { name: 'Configure iChannel0', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Volumes', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog', { name: /^iChannel0/ }).getByText('8 × 8 × 8 · RGBA8', { exact: true })).toBeVisible();
    await expect(page.getByLabel('3D volume preview; drag to rotate')).toBeVisible();
    await page.getByRole('button', { name: 'Slices', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /^iChannel0/ }).getByLabel('Volume slice preview')).toBeVisible();
    await page.getByRole('combobox', { name: 'Slice axis', exact: true }).selectOption('x');
    await page.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('nearest');
    await page.getByRole('combobox', { name: 'Wrap X / Y / Z', exact: true }).selectOption('clamp');
    await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/volume.sha.json']).passes.Image.inputs.iChannel0)
      .toMatchObject({ type: 'volume', path, filter: 'nearest', wrap: 'clamp' });
    await page.reload();
    await green();
    await page.getByRole('button', { name: 'Configure iChannel0', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Filter', exact: true })).toHaveValue('nearest');
    await expect(page.getByRole('combobox', { name: 'Wrap X / Y / Z', exact: true })).toHaveValue('clamp');
    await expect(page.getByRole('dialog', { name: /^iChannel0/ }).getByText('8 × 8 × 8 · RGBA8', { exact: true })).toBeVisible();
  });
}

for (const [name, uri, format] of [
  ['Random Greyscale.ktx2', 'shader-studio://volumes/noise-grey', 'R8'],
  ['Random RGBA.ktx2', 'shader-studio://volumes/noise-rgba', 'RGBA8'],
]) {
  test(`built-in ${name} is selectable and persists`, async ({ page }) => {
    await page.goto('/');
    await workspace(page, [
      ['noise.glsl', 'void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, vec3(p / iResolution.xy, 0.5)); }'],
      ['noise.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'volume', path: '' } } } } })],
    ]);
    await page.reload();
    await page.getByTestId('shader-option-noise-glsl').click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.getByRole('button', { name: 'Configure iChannel0', exact: true }).click();
    await page.getByRole('button', { name: `Volume slice preview ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^iChannel0/ });
    await expect(dialog.getByText(`32 × 32 × 32 · ${format}`, { exact: true })).toBeVisible();
    const filter = dialog.getByRole('combobox', { name: 'Filter', exact: true });
    const wrap = dialog.getByRole('combobox', { name: 'Wrap X / Y / Z', exact: true });
    for (const control of [filter, wrap]) {
      await expect(control).toHaveCSS('border-radius', '4px');
      await expect(control).toHaveCSS('padding-left', '12px');
    }
    await filter.selectOption('nearest');
    await wrap.selectOption('clamp');
    await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/noise.sha.json']).passes.Image.inputs.iChannel0)
      .toMatchObject({ type: 'volume', path: uri, filter: 'nearest', wrap: 'clamp' });
    await page.reload();
    await page.getByRole('button', { name: 'Configure iChannel0', exact: true }).click();
    await expect(dialog.getByText(`32 × 32 × 32 · ${format}`, { exact: true })).toBeVisible();
    await expect(filter).toHaveValue('nearest');
    await expect(wrap).toHaveValue('clamp');
  });
}
