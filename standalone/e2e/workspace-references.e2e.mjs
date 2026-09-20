import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

for (const { language, extension, pass, helper } of [
  { language: 'GLSL', extension: 'glsl', pass: 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(tone(coord.x)); }', helper: 'float tone(float value) { return value * 0.5; }' },
  { language: 'Slang', extension: 'slang', pass: 'float4 mainImage(float2 coord) { return float4(tone(coord.x)); }', helper: 'float tone(float value) { return value * 0.5; }' },
  { language: 'WGSL', extension: 'wgsl', pass: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(tone(coord.x)); }', helper: 'fn tone(value: f32) -> f32 { return value * 0.5; }' },
]) {
  test(`${language} Find References includes unopened workspace passes and Common`, async ({ page }) => {
    const name = `references-${extension}`;
    await page.route('**/__references_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
    await page.goto('/__references_fixture__');
    await workspace(page, [
      [`${name}.${extension}`, pass], [`${name}.common.${extension}`, helper], [`${name}.buffer.${extension}`, pass],
      [`${name}.sha.json`, JSON.stringify({ version: '1.0', passes: {
        common: { path: `${name}.common.${extension}` }, Image: { inputs: {} }, BufferA: { path: `${name}.buffer.${extension}`, inputs: {} },
      } })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-${name}-${extension}`).click();
    const editor = page.getByTestId('web-editor');
    await editor.locator('.view-line').getByText('tone', { exact: true }).dblclick();
    await page.keyboard.press('Home');
    for (let column = 0; column < pass.indexOf('tone') + 1; column++) {
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Shift+F12');
    const peek = page.locator('.reference-zone-widget');
    await expect(peek).toBeVisible();
    await expect(peek.locator('.peekview-title')).toContainText('References (3)');
    await expect(peek.locator('.ref-tree')).toContainText(`${name}.buffer.${extension}`);
    await expect(peek.locator('.ref-tree')).toContainText(`${name}.common.${extension}`);
  });
}
