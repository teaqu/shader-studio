import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

const fixtures = [
  {
    language: 'GLSL', extension: 'glsl', parameter: 'coord', selection: 'yx',
    source: 'void mainImage(out vec4 color, in vec2 coord) {\n  vec2 chosen = coord;\n  color = vec4(chosen, 0.0, 1.0);\n}\n',
  },
  {
    language: 'Slang', extension: 'slang', parameter: 'coord', selection: 'yx',
    source: 'float4 mainImage(float2 coord) {\n  float2 chosen = coord;\n  return float4(chosen, 0.0, 1.0);\n}\n',
  },
  {
    language: 'WGSL', extension: 'wgsl', parameter: 'coord', selection: 'yx',
    source: 'fn mainImage(coord: vec2f) -> vec4f {\n  let chosen = coord;\n  return vec4f(chosen, 0.0, 1.0);\n}\n',
  },
];

async function openShader(page, fixture) {
  const basename = `swizzle-${fixture.extension}`;
  await page.route('**/__swizzle_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
  await page.goto('/__swizzle_fixture__');
  await workspace(page, [
    [`${basename}.${fixture.extension}`, fixture.source],
    [`${basename}.sha.json`, JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await page.goto('/');
  await page.getByTestId(`shader-option-${basename}-${fixture.extension}`).click();
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.view-lines')).toBeVisible();
  return { basename, editor };
}

for (const fixture of fixtures) {
  test(`${fixture.language} accepts a reordered swizzle completion without duplicating its prefix`, async ({ page }) => {
    const { basename, editor } = await openShader(page, fixture);
    await editor.locator('.view-line').filter({ hasText: `chosen = ${fixture.parameter}` }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('.');

    const suggestions = page.locator('.suggest-widget').filter({ visible: true });
    await expect(suggestions).toBeVisible();
    const options = suggestions.getByRole('option');
    await expect(options.nth(0)).toHaveAccessibleName(/^x,/);
    await expect(options.nth(1)).toHaveAccessibleName(/^y,/);
    await expect(options.nth(2)).toHaveAccessibleName(/^xy,/);

    await page.keyboard.type(fixture.selection);
    const choice = suggestions.getByRole('option', { name: new RegExp(`^${fixture.selection},`) }).first();
    await expect(choice).toBeVisible();
    await choice.click();

    const expected = `${fixture.parameter}.${fixture.selection}`;
    await expect(editor).toContainText(expected);
    await expect(editor).not.toContainText(`${fixture.parameter}.${fixture.selection}${fixture.selection}`);
    await expect.poll(async () => (await workspace(page))[`/shaders/${basename}.${fixture.extension}`]).toContain(expected);
    await expect(editor.locator('[data-marker-count]').first()).toHaveAttribute('data-marker-count', '0');
    await expect(page.getByTestId('web-preview').locator('[aria-label="Toggle pause"]')).not.toHaveClass(/error/);
  });
}
