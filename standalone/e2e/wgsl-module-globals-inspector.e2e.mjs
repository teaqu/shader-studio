import { expect, test } from '@playwright/test';
import { addShaderFiles } from './workspace-store.mjs';

async function seedWorkspaceFiles(page, entries) {
  // Write the fixture before the app starts so its workspace persistence cannot
  // race the IndexedDB transaction.
  await page.route('**/__wgsl_globals_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/__wgsl_globals_fixture__');
  await addShaderFiles(page, entries);
  await page.goto('/');
}

function variableRow(panel, page, name) {
  return panel.locator('.var-row').filter({
    has: page.locator('.var-name', { hasText: new RegExp(`^${name}$`) }),
  });
}

test('WGSL sampled channel locals stay inspectable and module globals stay hidden after reload', async ({ page }) => {
  const source = `fn mainImage(coord: vec2f) -> vec4f {
  let uv = coord / iResolution.xy;
  let src = iChannel0Sample(uv);
  let col = src.rgb;
  let depth = iChannel0Sample(uv).a;
  return vec4f(col * depth * uFog + uHue * 0.0, 1.0);
}`;
  await seedWorkspaceFiles(page, [
    ['globals.wgsl', source],
    ['globals-common.wgsl', 'var<private> uFog: f32 = 1.0;\nconst uHue: f32 = 0.25;\n'],
    ['globals-buffer.wgsl', 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(coord / iResolution.xy, 0.5, 1.0); }'],
    ['globals.sha.json', JSON.stringify({
      version: '1.0',
      passes: {
        common: { path: 'globals-common.wgsl' },
        BufferA: { path: 'globals-buffer.wgsl', inputs: {} },
        Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA' } } },
      },
    })],
  ]);
  await page.getByTestId('shader-option-globals-wgsl').click();

  const preview = page.getByTestId('web-preview');
  const editor = page.getByTestId('web-editor');
  const panel = page.locator('.debug-panel');

  async function inspectReturn() {
    if (!await panel.isVisible()) {
      await preview.getByLabel('Toggle debug mode').click();
    }
    if (await panel.locator('.variables-section').count() === 0) {
      await panel.getByLabel('Toggle variable inspector').click();
    }
    await editor.locator('.view-line').filter({ hasText: 'return vec4f(col * depth' }).click();
    await expect(panel.locator('.fn-name')).toHaveText('mainImage');
    await expect(panel.locator('.header-info:not(.fn-name):not(.fn-type)')).toContainText('L6');
    for (const name of ['uv', 'src', 'col', 'depth']) {
      await expect(variableRow(panel, page, name)).toBeVisible();
    }
    // Module-scope values are not locals of mainImage, matching Slang and GLSL.
    for (const name of ['uFog', 'uHue']) {
      await expect(variableRow(panel, page, name)).toHaveCount(0);
    }
    await expect(panel.getByLabel('Show capture errors')).toHaveCount(0);
  }

  await inspectReturn();
  await page.reload();
  await inspectReturn();
});
