import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

async function openShader(page, basename, files) {
  // Seed before starting the app: its background saves must not race fixture writes.
  await page.route('**/__wgsl_parity_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
  await page.goto('/__wgsl_parity_fixture__');
  await workspace(page, files);
  await page.goto('/');
  await page.getByTestId(`shader-option-${basename}-${files[0][0].split('.').pop()}`).click();
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.view-lines')).toBeVisible();
  return editor;
}

const lineText = async (editor, index) => (await editor.locator('.view-lines').evaluate((element, index) => {
  const lines = [...element.querySelectorAll('.view-line')].sort((left, right) => parseFloat(left.style.top) - parseFloat(right.style.top));
  return lines[index]?.textContent ?? '';
}, index)).replace(/ /g, ' ');

test('WGSL errors reconcile with the renderer marker per line and clear after a typed correction', async ({ page }) => {
  const source = 'fn mainImage(coord: vec2f) -> vec4f {\n    let shade = coord.x / iResolution.x;\n    return vec4f(shade * mysteriousGain, 0.0, 0.0, 1.0);\n}\n';
  const editor = await openShader(page, 'wgsl-errors', [
    ['wgsl-errors.wgsl', source],
    ['wgsl-errors.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  const container = editor.locator('[data-marker-count]').first();
  await expect.poll(() => container.getAttribute('data-marker-count'), { message: 'the renderer never reported the error' }).toBe('1');
  // One squiggle for the line: the service error gave way to the renderer's.
  await expect(editor.locator('.view-overlays .squiggly-error')).toHaveCount(1);
  await editor.locator('.view-line').getByText('mysteriousGain').hover();
  await expect(page.locator('.monaco-hover').filter({ visible: true })).toContainText(/mysteriousGain/);

  await editor.locator('.view-line').getByText('mysteriousGain').dblclick();
  await page.keyboard.type('1.5');
  await expect.poll(() => lineText(editor, 2)).toContain('shade * 1.5,');
  await expect(editor.locator('.view-overlays .squiggly-error')).toHaveCount(0);
  await expect.poll(() => container.getAttribute('data-marker-count')).toBe('0');
});

test('WGSL signature help follows typed nested arguments', async ({ page }) => {
  const source = '// Scales a colour by gain.\nfn shade(color: vec3f, gain: f32) -> vec3f {\n    return color * gain;\n}\n\nfn mainImage(coord: vec2f) -> vec4f {\n    let lit = vec3f(0.5);\n    return vec4f(lit, 1.0);\n}\n';
  const editor = await openShader(page, 'wgsl-signature', [
    ['wgsl-signature.wgsl', source],
    ['wgsl-signature.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await editor.locator('.view-line').getByText('return vec4f(lit, 1.0);').click();
  await page.keyboard.press('Home');
  await page.keyboard.type('let c = shade(');
  const hints = page.locator('.parameter-hints-widget').filter({ visible: true });
  await expect(hints).toContainText('fn shade(color: vec3f, gain: f32) -> vec3f');
  await expect(hints).toContainText('Scales a colour by gain.');
  await expect(hints.locator('.parameter.active')).toHaveText('color: vec3f');
  await page.keyboard.type('vec3f(max(1.0, 2.0)), ');
  await expect(hints.locator('.parameter.active')).toHaveText('gain: f32');
});

test('WGSL colour picker keeps vec3f and vec3<f32> spellings and persists after reload', async ({ page }) => {
  const source = 'fn mainImage(coord: vec2f) -> vec4f {\n    let tint = vec3f(1.0, 0.0, 0.0);\n    let glow = vec3<f32>(0.0, 0.5, 1.0);\n    return vec4f(tint + glow, 1.0);\n}\n';
  const editor = await openShader(page, 'wgsl-colors', [
    ['wgsl-colors.wgsl', source],
    ['wgsl-colors.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  // The inline swatch renders as extra space before the constructor in the line text.
  const patterns = [/let tint =\s+vec3f\((\d*\.?\d+), (\d*\.?\d+), (\d*\.?\d+)\);/, /let glow =\s+vec3<f32>\((\d*\.?\d+), (\d*\.?\d+), (\d*\.?\d+)\);/];
  const collapse = text => text.replace(/\s+/g, ' ').trim();
  for (const [index, pattern] of patterns.entries()) {
    const swatch = editor.locator('.colorpicker-color-decoration').nth(index);
    await expect(swatch).toBeVisible();
    await swatch.click();
    const picker = page.locator('.colorpicker-widget').filter({ visible: true });
    await expect(picker).toBeVisible();
    const box = await picker.locator('.saturation-wrap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
    await expect.poll(async () => {
      const line = await lineText(editor, index + 1);
      return pattern.test(line) && collapse(line) !== collapse(source.split('\n')[index + 1]);
    }, { message: `swatch ${index} lost its constructor spelling or never changed` }).toBe(true);
    await page.keyboard.press('Escape');
  }
  await expect.poll(async () => {
    const saved = (await workspace(page))['/shaders/wgsl-colors.wgsl'] ?? '';
    return patterns.every(pattern => pattern.test(saved)) && saved !== source;
  }, { message: 'colour edits were not saved' }).toBe(true);
  await page.reload();
  await page.getByTestId('shader-option-wgsl-colors-wgsl').click();
  const reloaded = page.getByTestId('web-editor');
  await expect.poll(async () => patterns[0].test(await lineText(reloaded, 1)) && patterns[1].test(await lineText(reloaded, 2)), {
    message: 'reloaded source lost the edited constructors',
  }).toBe(true);
});

test('WGSL completion shows the shadowing local rather than the host builtin', async ({ page }) => {
  const source = 'fn mainImage(coord: vec2f) -> vec4f {\n    let iTime = 2i;\n    return vec4f(f32(iTime));\n}\n';
  const editor = await openShader(page, 'wgsl-shadowing', [
    ['wgsl-shadowing.wgsl', source],
    ['wgsl-shadowing.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await editor.locator('.view-line').getByText('return vec4f(f32(iTime));').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('let t = iTim');
  await page.keyboard.press('Control+Space');
  const row = page.locator('.suggest-widget .monaco-list-row').filter({ hasText: /^iTime/ }).first();
  await expect(row).toBeVisible();
  await expect(row.locator('.details-label')).toHaveText('i32');
});

test('WGSL 2x2 matrices capture in authored column order in the standalone debug panel', async ({ page }) => {
  const source = 'fn mainImage(coord: vec2f) -> vec4f {\n    let annotated: mat2x2f = mat2x2f(0.125, 0.25, 0.5, 0.75);\n    let inferred = mat2x2<f32>(vec2f(0.75, 0.5), vec2f(0.25, 0.125));\n    return vec4f(annotated[0] + inferred[1], 0.0, 1.0);\n}\n';
  const editor = await openShader(page, 'wgsl-matrix', [
    ['wgsl-matrix.wgsl', source],
    ['wgsl-matrix.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  const panel = page.locator('.debug-panel');
  if (!await panel.isVisible()) {
    await page.getByTestId('web-preview').getByLabel('Toggle debug mode').click();
  }
  if (await panel.locator('.variables-section').count() === 0) {
    await panel.getByLabel('Toggle variable inspector').click();
  }
  await editor.locator('.view-line').filter({ hasText: 'let inferred' }).click();
  await expect(panel.locator('.header-info:not(.fn-name):not(.fn-type)')).toContainText('L3');
  const row = name => panel.locator('.var-row').filter({ has: page.locator('.var-name', { hasText: new RegExp(`^${name}$`) }) });
  await expect(row('annotated').locator('.var-type')).toHaveText('mat2x2f');
  await expect(row('annotated').locator('.var-value')).toHaveText(/^\(0\.125,\s*0\.250,\s*0\.500,\s*0\.750\)$/);
  await expect(row('inferred').locator('.var-type')).toHaveText('mat2x2<f32>');
  await expect(row('inferred').locator('.var-value')).toHaveText(/^\(0\.750,\s*0\.500,\s*0\.250,\s*0\.125\)$/);
  await expect(panel.getByLabel('Show capture errors')).toHaveCount(0);
});
