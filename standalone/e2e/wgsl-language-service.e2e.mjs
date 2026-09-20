import { expect, test } from '@playwright/test';
import {
  addShaderFiles,
  readWorkspaceFiles,
  readWorkspaceLayout,
  seedLegacyWorkspace,
} from './workspace-store.mjs';

async function seedWorkspace(page, entries) {
  await addShaderFiles(page, entries);
}

test('carries a pre-existing single-array workspace over to per-path records', async ({ page }) => {
  // The v1 layout kept every file in one array under state/workspace, so each
  // edit rewrote the lot. Opening it must move the files across without losing
  // any, and the superseded array must not be left behind as a stale copy.
  const basename = 'legacy-workspace';
  const at = Date.now();
  const legacy = [
    {
      path: `/shaders/${basename}.wgsl`,
      contents: 'fn mainImage(coord: vec2f) -> vec4f {\n  return vec4f(0.25, 0.5, 0.75, 1.0);\n}',
      createdAt: at,
      modifiedAt: at,
    },
    {
      path: `/shaders/${basename}.sha.json`,
      contents: JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } }),
      createdAt: at,
      modifiedAt: at,
    },
  ];
  await page.route('**/__legacy_workspace_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
  await page.goto('/__legacy_workspace_fixture__');
  await seedLegacyWorkspace(page, legacy);

  await page.goto('/');
  await page.getByTestId(`shader-option-${basename}-wgsl`).click();
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.view-lines')).toContainText('vec4f(0.25, 0.5, 0.75, 1.0)');

  const layout = await readWorkspaceLayout(page);
  expect(layout.version).toBe(2);
  expect(layout.stores).toContain('files');
  expect(layout.legacyRecord).toBeNull();
  const migrated = await readWorkspaceFiles(page);
  for (const file of legacy) {
    expect(migrated.find(record => record.path === file.path)?.contents).toBe(file.contents);
  }

  // The migrated workspace still survives a reload, from the records this time.
  await page.reload();
  await expect(page.getByTestId(`shader-option-${basename}-wgsl`)).toBeVisible();
});

test('WGSL storage declared with native vectors and matrices raises no editor diagnostic', async ({ page }) => {
  // Regression: `f32`/`vec4<f32>` are how a WGSL config spells storage element
  // types, and the renderer accepts them, but authoring validation rejected
  // them as reserved words and warned on every line 1 of a valid shader.
  const basename = 'wgsl-native-storage';
  const shaderName = `${basename}.wgsl`;
  const source = `fn mainImage(coord: vec2f) -> vec4f {
  let sample = samples[0];
  return vec4f(sample, coord.x, 0.0, 1.0);
}`;
  await page.route('**/__wgsl_storage_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
  await page.goto('/__wgsl_storage_fixture__');
  await seedWorkspace(page, [
    [shaderName, source],
    [`${basename}.sha.json`, JSON.stringify({
      version: '1.0',
      storage: {
        samples: { count: 256, elementType: 'f32' },
        directions: { count: 4, elementType: 'vec3<i32>' },
        bases: { count: 2, elementType: 'mat2x3<f32>' },
        transforms: { count: 2, elementType: 'mat4x2f' },
      },
      passes: { Image: { inputs: {} } },
    })],
  ]);
  await page.goto('/');
  await page.getByTestId(`shader-option-${basename}-wgsl`).click();
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.view-line').getByText('let sample = samples[0];', { exact: true })).toBeVisible();

  // The service reports the storage warning against line 1, which is on screen.
  await expect(editor.locator('.squiggly-warning')).toHaveCount(0);
  await expect(editor.locator('.squiggly-error')).toHaveCount(0);
});

test('WGSL aliases offer vector swizzles and struct fields in the standalone Monaco host', async ({ page }) => {
  const basename = 'wgsl-alias-members';
  const shaderName = `${basename}.wgsl`;
  const source = `alias Tint = vec4f;
struct Light { color: vec3f, }
alias KeyLight = Light;
fn mainImage(coord: vec2f) -> vec4f {
  var tint: Tint;
  var key: KeyLight;
  tint.
  key.
  return vec4f(coord, 0.0, 1.0);
}`;
  await page.route('**/__wgsl_ls_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
  await page.goto('/__wgsl_ls_fixture__');
  await seedWorkspace(page, [
    [shaderName, source],
    [`${basename}.sha.json`, JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await page.goto('/');
  await page.getByTestId(`shader-option-${basename}-wgsl`).click();
  const editor = page.getByTestId('web-editor');

  for (const [line, member] of [["tint.", "xyzw"], ["key.", "color"]]) {
    await editor.locator('.view-line').getByText(line, { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+Space');
    const suggestions = page.locator('.suggest-widget:visible');
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toContainText(member);
    await page.keyboard.press('Escape');
  }
});
