import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import { putWorkspaceFiles, readWorkspaceFiles } from './workspace-store.mjs';
import { useSharedShaderEditor } from './explorer-preferences.mjs';

// Slang rendering needs a WebGPU adapter in headless Chromium.
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu'] } });

test('active shader files open together, switch cleanly and can be disabled', async ({ page }) => {
  await page.route('**/__active_files__', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/__active_files__');
  const code = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }';
  await putWorkspaceFiles(page, [
    ['/first.glsl', code], ['/second.glsl', code],
    ['/first.buffer.glsl', code], ['/shared.buffer.glsl', code],
    ['/first.sha.json', JSON.stringify({ passes: { Image: {}, A: { path: 'first.buffer.glsl' }, B: { path: 'shared.buffer.glsl' } } })],
    ['/second.sha.json', JSON.stringify({ passes: { Image: {}, B: { path: 'shared.buffer.glsl' } } })],
  ].map(([path, contents]) => ({ path, contents, createdAt: 1, modifiedAt: 1 })));
  await page.goto('/');
  const editor = path => page.locator(`[data-testid="file-editor"][data-path="/${path}"]`);
  await page.getByTestId('shader-option-first-glsl').click();
  await expect(editor('first.glsl')).toBeVisible();
  await expect(editor('first.buffer.glsl')).toHaveCount(1);
  await expect(editor('shared.buffer.glsl')).toHaveCount(1);
  await expect(editor('first.sha.json')).toHaveCount(0);
  await page.getByTestId('shader-option-second-glsl').click();
  await expect(editor('second.glsl')).toBeVisible();
  await expect(editor('first.glsl')).toHaveCount(0);
  await expect(editor('first.buffer.glsl')).toHaveCount(0);
  await expect(editor('shared.buffer.glsl')).toHaveCount(1);
  const toolbar = page.getByTestId('web-shader-explorer').locator('.toolbar');
  const before = await toolbar.boundingBox();
  await page.getByTitle('Options', { exact: true }).click();
  const settings = page.getByRole('region', { name: 'Explorer settings' });
  await expect(settings).toBeVisible();
  expect((await toolbar.boundingBox()).height).toBe(before.height);
  const bounds = await settings.boundingBox();
  const explorerBounds = await page.getByTestId('web-shader-explorer').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(explorerBounds.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(explorerBounds.x + explorerBounds.width);
  await page.screenshot({ path: test.info().outputPath('explorer-settings.png') });
  await expect(page.getByLabel('Only keep active shader files open')).toBeChecked();
  await page.getByLabel('Only keep active shader files open').uncheck();
  await page.reload();
  await expect(page.getByLabel('Only keep active shader files open')).not.toBeChecked();
  await page.getByLabel('Only keep active shader files open').check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Explorer settings' })).toHaveCount(0);
  await page.getByTestId('shader-option-first-glsl').click();
  await expect(editor('first.buffer.glsl')).toHaveCount(1);
  await expect(editor('second.glsl')).toHaveCount(0);
});

test('Viewing follows line rendering and restores the selected buffer when line rendering stops', async ({ page }) => {
  await page.route('**/__line_cards__', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/__line_cards__');
  await putWorkspaceFiles(page, [
    ['/line-cards.glsl', 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.0, 1.0, 0.0, 1.0); }'],
    ['/line-buffer.glsl', 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec4 tint = vec4(0.0, 0.0, 1.0, 1.0);\n  fragColor = vec4(1.0, 0.0, 0.0, 1.0);\n}'],
    ['/line-cards.sha.json', JSON.stringify({ version: '1', passes: { Image: {}, A: { path: 'line-buffer.glsl' } } })],
  ].map(([path, contents]) => ({ path, contents, createdAt: 1, modifiedAt: 1 })));
  await page.goto('/');
  await page.getByTestId('shader-option-line-cards-glsl').click();
  const preview = page.getByTestId('web-preview');
  await preview.getByLabel('Toggle config panel').click();
  await page.getByRole('button', { name: 'Preview A', exact: true }).click();
  await page.locator('[data-tab-name="A"]').dblclick();
  await preview.getByLabel('Toggle debug mode').click();
  await page.getByLabel('Toggle inline rendering', { exact: true }).click();
  const editor = page.locator('[data-testid="file-editor"][data-path="/line-buffer.glsl"]');
  // Click the line itself: ControlOrMeta+Home is not document start on macOS.
  await editor.locator('.view-line').filter({ hasText: 'vec4 tint' }).click();
  await page.keyboard.press('End');
  await expect(page.getByLabel('Currently previewing A', { exact: true })).toHaveText('Viewing · L2');
  const pixel = async () => {
    const url = await preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)').evaluate(canvas => canvas.toDataURL());
    const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...data.subarray(offset, offset + 3)];
  };
  await expect.poll(pixel).toEqual([0, 0, 255]);
  await page.keyboard.insertText(' ');
  await expect.poll(pixel).toEqual([0, 0, 255]);
  await page.getByText('Config', { exact: true }).click();
  await page.locator('[data-tab-name="Image"]').click();
  await expect(page.getByLabel('Currently previewing A', { exact: true })).toHaveText('Viewing · L2');
  await page.getByText('Debug', { exact: true }).click();
  await expect(page.getByRole('img', { name: 'Line rendering enabled' })).toBeVisible();
  await page.getByLabel('Toggle inline rendering', { exact: true }).click();
  await expect(page.getByRole('img', { name: 'Line rendering enabled' })).toBeHidden();
  await expect(page.getByLabel('Currently previewing A', { exact: true })).toHaveText('Viewing');
  await expect.poll(pixel).toEqual([255, 0, 0]);
});

test('clearing the workspace restores the default shaders after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('shader-option-aurora-glsl')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Clear Workspace', exact: true }).click();
  await reloaded;
  await expect(page.getByTestId('shader-option-aurora-glsl')).toBeVisible();
  await expect(page.getByTestId('shader-option-particle-swarm-wgsl')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('shader-option-aurora-glsl')).toBeVisible();
});

const bufferLockCases = [
  ...['glsl', 'slang', 'wgsl'].flatMap(language => [false, true].map(locked => [language, locked, 0])),
  ['slang', true, 6000],
];
for (const [language, locked, compileDelay] of bufferLockCases) {
  test(`opening a buffer respects the preview lock (${language}, ${locked}${compileDelay ? ', slow compiler' : ''})`, async ({ page }) => {
    if (compileDelay) {
      // A busy CI compiler can leave the prior blue shader visible for more
      // than the default five-second assertion timeout. Keep that path covered.
      await page.addInitScript(delay => {
        const postMessage = Worker.prototype.postMessage;
        const delayedWorkers = new WeakSet();
        Worker.prototype.postMessage = function(message, ...args) {
          if (message?.type === 'compile' && message.options?.sourcePath === '/main.slang'
            && !delayedWorkers.has(this)) {
            delayedWorkers.add(this);
            setTimeout(() => postMessage.call(this, message, ...args), delay);
            return;
          }
          return postMessage.call(this, message, ...args);
        };
      }, compileDelay);
    }
    await page.route('**/__buffer_lock__', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    await page.goto('/__buffer_lock__');
    const shader = expression => language === 'glsl'
      ? `void mainImage(out vec4 color, in vec2 coord) { color = ${expression}; }`
      : language === 'slang' ? `float4 mainImage(float2 coord) { return ${expression}; }`
        : `fn mainImage(coord: vec2f) -> vec4f { return ${expression}; }`;
    const vector = language === 'glsl' ? 'vec4' : language === 'slang' ? 'float4' : 'vec4f';
    const sample = language === 'glsl' ? 'texture(iChannel0, coord / iResolution.xy)'
      : language === 'slang' ? 'iChannel0.Sample(coord / iResolution.xy)' : 'iChannel0Sample(coord / iResolution.xy)';
    await putWorkspaceFiles(page, [
      [`/main.${language}`, shader(`${vector}(1.0, 0.0, 0.0, 1.0)`)],
      [`/green.${language}`, shader(`${vector}(0.0, 1.0, 0.0, 1.0)`)],
      [`/blue.${language}`, shader(`${vector}(0.0, 0.0, 1.0, 1.0)`)],
      [`/pass/buffer.${language}`, shader(sample)],
      ['/main.sha.json', JSON.stringify({ version: '1.0', passes: {
        Source: { path: `green.${language}` },
        BufferA: { path: `pass/buffer.${language}`, inputs: { iChannel0: { type: 'buffer', source: 'Source' } } }, Image: {},
      } })],
      ['/pass/buffer.sha.json', JSON.stringify({ version: '1.0', passes: {
        Source: { path: `../blue.${language}` }, Image: { inputs: { iChannel0: { type: 'buffer', source: 'Source' } } },
      } })],
    ].map(([path, contents]) => ({ path, contents, createdAt: 1, modifiedAt: 1 })));
    await page.goto('/');
    await page.getByTestId(`shader-option-main-${language}`).click();
    const preview = page.getByTestId('web-preview');
    const lock = preview.getByLabel('Toggle lock', { exact: true });
    const pixel = async () => {
      const url = await preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)').evaluate(canvas => canvas.toDataURL());
      const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
      const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
      return [...data.subarray(offset, offset + 3)];
    };
    const expectPixel = expected => expect.poll(pixel, { timeout: 15_000 }).toEqual(expected);
    await expectPixel([255, 0, 0]);
    if (locked) {
      await lock.click();
    }
    await preview.getByLabel('Toggle config panel').click();
    await page.locator('[data-tab-name="BufferA"]').dblclick();
    await expect(page.locator(`[data-testid="file-editor"][data-path="/pass/buffer.${language}"] .monaco-editor`)).toBeVisible();
    await expect(lock).toHaveAttribute('aria-pressed', String(locked));
    await expectPixel([255, 0, 0]);
    await page.getByRole('button', { name: 'Preview BufferA', exact: true }).click();
    await expectPixel([0, 255, 0]);
    await expect(page.getByLabel('Currently previewing BufferA', { exact: true })).toHaveText('Viewing');
    await page.locator('[data-tab-name="Image"]').click();
    await expect(page.locator('[data-tab-name="Image"]')).toHaveAttribute('aria-pressed', 'true');
    await expectPixel([0, 255, 0]);
    await page.getByRole('button', { name: 'Preview Image', exact: true }).click();
    await expectPixel([255, 0, 0]);
    await page.locator('[data-tab-name="BufferA"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Preview file standalone', exact: true }).click();
    await expectPixel([0, 0, 255]);
    await expect(lock).toHaveAttribute('aria-pressed', String(locked));
    await page.reload();
    await expectPixel([0, 0, 255]);
    await expect(lock).toHaveAttribute('aria-pressed', 'false');
  });
}

for (const language of ['glsl', 'slang', 'wgsl']) {
  for (const source of ['common', 'vertex']) {
    test(`double-clicking ${language} ${source} keeps standalone responsive`, async ({ page }) => {
      // The pass opens beside the shared editor, which the test checks after reload.
      await useSharedShaderEditor(page);
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      // Seed before the app mounts so its workspace autosave cannot overwrite the fixture.
      await page.route('**/', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
      await page.goto('/');
      await putWorkspaceFiles(page, [
        [`/aurora.${language}`, language === 'glsl'
          ? 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }'
          : language === 'slang'
            ? 'float4 mainImage(float2 coord) { return float4(1.0); }'
            : 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }'],
        [`/shared.${language}`, '// shared functions'],
        [`/vertex.${language}`, language === 'glsl'
          ? 'void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {}'
          : language === 'slang'
            ? 'void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}'
            : 'fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {}'],
        ['/aurora.sha.json', JSON.stringify({ version: '1.0', passes: {
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
      const path = `/${source === 'common' ? 'shared' : 'vertex'}.${language}`;
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
    ['/owner-a.glsl', 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }'],
    ['/owner-a.common.glsl', 'vec4 ownerColor(float value) { return vec4(value); }'],
    ['/owner-a.buffer.glsl', 'void mainImage(out vec4 color, in vec2 coord) { color = ownerColor(coord.x); }'],
    ['/owner-a.sha.json', JSON.stringify({ version: '1.0', passes: {
      common: { path: 'owner-a.common.glsl' }, Image: { inputs: {} }, BufferA: { path: 'owner-a.buffer.glsl', inputs: {} },
    } })],
    ['/owner-b.glsl', 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.0, ownerColor(coord.x), 0.0, 1.0); }'],
    ['/owner-b.common.glsl', 'float ownerColor(float value) { return 1.0; }'],
    ['/owner-b.sha.json', JSON.stringify({ version: '1.0', passes: {
      common: { path: 'owner-b.common.glsl' }, Image: { inputs: {} },
    } })],
  ].map(([path, contents]) => ({ path, contents, createdAt: 1, modifiedAt: 1 })));
  await page.unroute('**/__detached_common_context__');
  await page.goto('/');
  await page.getByTestId('shader-option-owner-a-glsl').click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  await page.locator('[data-tab-name="BufferA"]').dblclick();
  const bufferEditor = page.locator('[data-testid="file-editor"][data-path="/owner-a.buffer.glsl"]');
  await expect(bufferEditor.locator('.monaco-editor')).toBeVisible();
  await expect(bufferEditor.locator('.squiggly-error')).toHaveCount(0);

  // Explorer's Open Files mode opens B in another editor rather than navigating
  // the preview. Turn it off so this is the A → B session change under test.
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Only keep active shader files open', { exact: true }).uncheck();
  await page.getByLabel('Open file when selecting a shader', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  // Opening a configured source leaves the preview unlocked.
  const preview = page.getByTestId('web-preview');
  const lock = preview.locator('button.collapse-lock');
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
  // Saves from the shared editor race the preview navigation it follows.
  await useSharedShaderEditor(page);
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
  await expect(editor.locator('.view-lines')).toContainText('uv.xyx + vec3(0, 2, 4)');
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
    '/aurora.glsl': edited,
    '/desert-cubemap.glsl': before['/desert-cubemap.glsl'],
  });
  await page.reload();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('pending navigation edit');
  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('Drag in the preview');
  expect((await workspace(page))['/desert-cubemap.glsl']).toBe(before['/desert-cubemap.glsl']);
});
