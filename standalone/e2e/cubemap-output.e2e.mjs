import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { workspace } from './language-service-fixtures.mjs';

async function centerPixel(canvas) {
  const data = await canvas.evaluate(element => element.toDataURL());
  const png = PNG.sync.read(Buffer.from(data.split(',')[1], 'base64'));
  const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

for (const [language, execution] of [['glsl', 'render'], ['slang', 'render'], ['slang', 'compute']]) {
  test(`${language} ${execution} creates a Cubemap tab, samples direction colours, and restores configuration after reload`, async ({ page }) => {
    await page.route('**/__cube_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' }));
    await page.goto('/__cube_fixture__');
    const image = language === 'glsl'
      ? 'void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, vec3(1,0,0)); }'
      : 'float4 mainImage(float2 p) { return iChannel0.Sample(float3(1,0,0)); }';
    await workspace(page, [[`direction.${language}`, image], ['direction.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'buffer', source: 'Cubemap' } } } } })]]);
    await page.goto('/');
    await page.getByTestId(`shader-option-direction-${language}`).click();
    const preview = page.getByTestId('web-preview');
    await preview.getByLabel('Toggle config panel').click();
    await page.getByRole('button', { name: '+ New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Cubemap', exact: true }).click();
    await expect(page.locator('[data-tab-name="Cubemap"]')).toBeVisible();
    await expect(page.getByLabel('Cubemap face size')).toHaveValue('512');
    await page.getByLabel('Cubemap face size').fill('32');
    if (execution === 'compute') {
await page.getByLabel('Cubemap execution').selectOption('compute');
}
    await page.getByRole('button', { name: 'Choose shader file' }).first().click();
    page.once('dialog', dialog => dialog.accept(`direction-cube.${language}`));
    await page.getByRole('dialog', { name: 'Choose shader file' }).getByRole('button', { name: 'Create file…', exact: true }).click();
    const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    // Slang startup can exceed the default 5s poll: CI traces render the expected
    // bytes at about 6s. Use the existing shader-compilation budget for first output.
    await expect.poll(() => centerPixel(canvas), { timeout: 30_000 }).toEqual([255, 128, 128, 255]);
    const saved = JSON.parse((await workspace(page))['/direction.sha.json']);
    expect(saved.passes.Cubemap).toMatchObject({ outputKind: 'cubemap', faceSize: 32 });
    expect((await workspace(page))[`/direction-cube.${language}`]).toContain(execution === 'compute' ? 'mainCompute' : 'mainCubemap');
    await page.getByLabel('Cubemap preview mode').selectOption('face');
    await page.getByLabel('Cubemap face', { exact: true }).selectOption('positive-y');
    await expect.poll(async () => (await centerPixel(canvas))[1]).toBe(255);
    await page.getByLabel('Cubemap preview mode').selectOption('environment');
    await expect.poll(async () => (await centerPixel(canvas))[0]).toBeLessThan(200);
    await page.getByLabel('Cubemap preview mode').selectOption('image');
    await expect.poll(() => centerPixel(canvas)).toEqual([255, 128, 128, 255]);
    await page.reload();
    const reloadedCanvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    // Reload creates a fresh compiler/device; it needs the same startup budget.
    await expect.poll(() => centerPixel(reloadedCanvas), { timeout: 30_000 }).toEqual([255, 128, 128, 255]);
    await page.locator('[data-tab-name="Cubemap"]').click();
    await expect(page.getByLabel('Cubemap face size')).toHaveValue('32');
    await expect(page.getByLabel('Output kind')).toHaveValue('cubemap');
  });
}
