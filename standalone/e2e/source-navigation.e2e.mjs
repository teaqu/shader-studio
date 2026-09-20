import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import { putWorkspaceFiles, readWorkspaceFiles } from './workspace-store.mjs';

// Slang rendering needs a WebGPU adapter in headless Chromium.
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu'] } });

for (const language of ['glsl', 'slang', 'wgsl']) {
  for (const source of ['common', 'vertex']) {
    test(`double-clicking ${language} ${source} keeps standalone responsive`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      // Seed before the app mounts so its workspace autosave cannot overwrite the fixture.
      await page.route('**/', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
      await page.goto('/');
      await putWorkspaceFiles(page, [
        [`/shaders/aurora.${language}`, language === 'glsl'
          ? 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }'
          : language === 'slang'
            ? 'float4 mainImage(float2 coord) { return float4(1.0); }'
            : 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }'],
        [`/shaders/shared.${language}`, '// shared functions'],
        [`/shaders/vertex.${language}`, language === 'glsl'
          ? 'void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) {}'
          : language === 'slang'
            ? 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {}'
            : 'fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {}'],
        ['/shaders/aurora.sha.json', JSON.stringify({ version: '1.0', passes: {
          Image: { inputs: {}, vertex: `vertex.${language}` }, common: { path: `shared.${language}` },
        } })],
      ].map(([path, contents]) => ({ path, contents, createdAt: 1, modifiedAt: 1 })));
      await page.unroute('**/');
      await page.reload();
      await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
      await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
      if (source === 'common') {
        await page.locator('[data-tab-name="Common"]').dblclick();
      } else {
        await page.getByRole('heading', { name: 'Vertex shader', exact: true }).dblclick();
      }
      const path = `/shaders/${source === 'common' ? 'shared' : 'vertex'}.${language}`;
      const editor = page.locator(`[data-testid="file-editor"][data-path="${path}"]`);
      await expect(editor.locator('.monaco-editor')).toBeVisible();
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Reset workspace layout', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await editor.locator('.view-lines').click();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.insertText('// navigation edit\n');
      await expect(page.getByTestId('web-preview').getByLabel('Toggle pause')).not.toHaveClass(/error/);
      await expect.poll(async () => (await readWorkspaceFiles(page))
        .find(file => file.path === path)?.contents ?? '').toContain('navigation edit');
      await page.reload();
      await expect(editor.locator('.monaco-editor')).toBeVisible();
      await expect(editor.locator('.view-lines')).toContainText('navigation edit');
      await expect(page.getByTestId('web-editor').locator('.view-lines')).toContainText('mainImage');
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Reset workspace layout', exact: true })).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  }
}

test('a detached buffer retains its owner Common authoring context after preview navigation', async ({ page }) => {
  await page.route('**/__detached_common_context__', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/__detached_common_context__');
  await putWorkspaceFiles(page, [
    ['/shaders/owner-a.glsl', 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }'],
    ['/shaders/owner-a.common.glsl', 'vec4 ownerColor(float value) { return vec4(value); }'],
    ['/shaders/owner-a.buffer.glsl', 'void mainImage(out vec4 color, in vec2 coord) { color = ownerColor(coord.x); }'],
    ['/shaders/owner-a.sha.json', JSON.stringify({ version: '1.0', passes: {
      common: { path: 'owner-a.common.glsl' }, Image: { inputs: {} }, BufferA: { path: 'owner-a.buffer.glsl', inputs: {} },
    } })],
    ['/shaders/owner-b.glsl', 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.0, ownerColor(coord.x), 0.0, 1.0); }'],
    ['/shaders/owner-b.common.glsl', 'float ownerColor(float value) { return 1.0; }'],
    ['/shaders/owner-b.sha.json', JSON.stringify({ version: '1.0', passes: {
      common: { path: 'owner-b.common.glsl' }, Image: { inputs: {} },
    } })],
  ].map(([path, contents]) => ({ path, contents, createdAt: 1, modifiedAt: 1 })));
  await page.unroute('**/__detached_common_context__');
  await page.goto('/');
  await page.getByTestId('shader-option-owner-a-glsl').click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  await page.locator('[data-tab-name="BufferA"]').dblclick();
  const bufferEditor = page.locator('[data-testid="file-editor"][data-path="/shaders/owner-a.buffer.glsl"]');
  await expect(bufferEditor.locator('.monaco-editor')).toBeVisible();
  await expect(bufferEditor.locator('.squiggly-error')).toHaveCount(0);

  // Explorer's Open Files mode opens B in another editor rather than navigating
  // the preview. Turn it off so this is the A → B session change under test.
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Open Files', { exact: true }).uncheck();
  // Opening a configured source intentionally locks its owning preview.
  const preview = page.getByTestId('web-preview');
  const lock = preview.locator('button.collapse-lock');
  await expect(lock).toHaveClass(/active/);
  if (await lock.isVisible()) {
    await lock.click();
  } else {
    await preview.getByLabel('Open options menu', { exact: true }).click();
    await preview.locator('.options-menu-item[aria-label="Toggle lock"]').click();
  }
  await expect(lock).not.toHaveClass(/active/);
  await page.getByTestId('shader-option-owner-b-glsl').click();
  await expect(page.getByTestId('shader-option-owner-b-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const url = await preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)').evaluate(canvas => canvas.toDataURL());
    const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...data.subarray(offset, offset + 3)];
  }).toEqual([0, 255, 0]);
  await bufferEditor.getByText('ownerColor', { exact: true }).hover();
  await expect(page.locator('.monaco-hover').filter({ visible: true })).toContainText('vec4 ownerColor');
  await expect(bufferEditor.locator('.squiggly-error')).toHaveCount(0);
});

test('navigating during an editor save preserves both shader files after reload', async ({ page }) => {
  const { workspace } = await import('./language-service-fixtures.mjs');
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    window.pendingEditorSaves = [];
    window.holdEditorSaves = false;
    window.setTimeout = (callback, delay, ...args) => {
      if (window.holdEditorSaves && delay === 15) {
        window.pendingEditorSaves.push(() => callback(...args));
        return -window.pendingEditorSaves.length;
      }
      return schedule(callback, delay, ...args);
    };
  });
  await page.goto('/');
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.view-lines')).toContainText('sin(p.x * 3.0 + iTime)');
  const before = await workspace(page);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  // Hold the existing save debounce while performing the navigation, so this
  // race is deterministic without slowing the application or adding retries.
  await page.evaluate(() => {
    window.holdEditorSaves = true;
  });
  const edited = 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.25); } // pending navigation edit';
  await page.keyboard.insertText(edited);
  await page.getByTestId('shader-option-desert-cubemap-glsl').click({ force: true });
  await page.evaluate(() => {
    window.holdEditorSaves = false; window.pendingEditorSaves.splice(0).forEach(save => save());
  });
  await expect.poll(() => workspace(page)).toMatchObject({
    '/shaders/aurora.glsl': edited,
    '/shaders/desert-cubemap.glsl': before['/shaders/desert-cubemap.glsl'],
  });
  await page.reload();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('pending navigation edit');
  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('Drag in the preview');
  expect((await workspace(page))['/shaders/desert-cubemap.glsl']).toBe(before['/shaders/desert-cubemap.glsl']);
});
