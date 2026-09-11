import { expect, test } from '@playwright/test';

import { workspace } from './language-service-fixtures.mjs';

for (const { name, extension, pass, helper } of [
  { name: 'GLSL', extension: 'glsl', pass: 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(tone(coord.x)); }', helper: 'float tone(float value) { return value * 0.5; }' },
  { name: 'Slang', extension: 'slang', pass: 'float4 mainImage(float2 coord) { return float4(tone(coord.x)); }', helper: 'float tone(float value) { return value * 0.5; }' },
  { name: 'WGSL', extension: 'wgsl', pass: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(tone(coord.x)); }', helper: 'fn tone(value: f32) -> f32 { return value * 0.5; }' },
]) for (const mode of ['local', 'common-reference', 'common-declaration']) {
  const common = mode !== 'local';
  const declaration = mode === 'common-declaration';
  test(`${name} Monaco F2 ${mode} rename persists every file after reload`, async ({ page }) => {
    page.on('console', message => { const text = message.text(); if (message.type() === 'error' || text.includes('environment')) console.log(`[${message.type()}]`, text.slice(0, 300)); });
    const basename = `symbol-rename-${extension}`;
    const shaderName = `${basename}.${extension}`;
    const commonName = `${basename}.common.${extension}`;
    const source = common ? pass : `${helper}\n${pass}`;
    // Seed before starting the app: its background saves must not race fixture writes.
    await page.route('**/__rename_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
    await page.goto('/__rename_fixture__');
    let editor = page.getByTestId('web-editor');
    await workspace(page, [
      [shaderName, source],
      ...(common ? [[commonName, helper]] : []),
      [`${basename}.sha.json`, JSON.stringify({ version: '1.0', passes: {
        ...(common ? { common: { path: commonName } } : {}), Image: { inputs: {} },
      } })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-${basename}-${extension}`).click();
    if (declaration) {
      await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
      await page.locator('[data-tab-name="Common"]').dblclick();
      editor = page.locator(`[data-testid="file-editor"][data-path="/shaders/${commonName}"]`);
      await expect(editor.locator('.monaco-editor')).toBeVisible();
    }
    await editor.locator('.view-line').getByText('tone', { exact: true }).last().dblclick();
    await page.keyboard.press('Home');
    for (let column = 0; column < (declaration ? helper : pass).indexOf('tone') + 1; column++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('F2');
    const input = page.locator('.rename-box input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('tone');
    await input.fill('discardedName');
    await input.press('Escape');
    await expect(input).not.toBeVisible();
    await expect(editor.locator('.view-lines')).toContainText(declaration ? 'tone' : 'tone(coord.x)');
    await page.keyboard.press('F2');
    await expect(input).toHaveValue('tone');
    await input.fill('curve');
    await input.press('Enter');
    const expected = source.replaceAll('tone', 'curve');
    await expect(editor.locator('.view-lines')).toContainText(declaration ? 'curve' : 'curve(coord.x)');
    await expect.poll(async () => (await workspace(page))[`/shaders/${shaderName}`]).toBe(expected);
    await page.reload();
    await expect(page.getByTestId('web-editor').locator('.view-lines')).toContainText('curve');
    const saved = await workspace(page);
    expect(saved[`/shaders/${shaderName}`]).toBe(expected);
    if (common) expect(saved[`/shaders/${commonName}`]).toBe(helper.replaceAll('tone', 'curve'));
  });
}
