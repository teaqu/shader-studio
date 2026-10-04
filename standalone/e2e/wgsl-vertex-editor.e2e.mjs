import { test, expect } from '@playwright/test';
import { readWorkspaceFiles } from './workspace-store.mjs';
import { workspace } from './language-service-fixtures.mjs';

for (const language of ['wgsl', 'slang']) {
  test(`Native buffer Insert creates its configured ${language} file and persists code`, async ({ page }) => {
    const stem = `native-new-file-${language}`;
    const source = language === 'wgsl' ? 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1); }' : 'float4 mainImage(float2 coord) { return float4(1); }';
    await page.route('**/__native_buffer_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' }));
    await page.goto('/__native_buffer_fixture__');
    await workspace(page, [[`${stem}.${language}`, source], [`${stem}.sha.json`, JSON.stringify({ version: '1.0',
      passes: { Image: {}, BufferA: { path: `owned-new.${language}`, entryPoints: {} } } })]]);
    await page.goto('/');
    await page.getByTestId(`shader-option-${stem}-${language}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.getByRole('button', { name: 'BufferA Remove BufferA', exact: true }).click();
    const main = page.locator('.tab-content .buffer-details > .config-item').first();
    await main.getByRole('button', { name: 'Insert', exact: true }).click();
    const path = `/shaders/owned-new.${language}`;
    await expect.poll(async () => (await workspace(page))[path]).toContain('BufferAFragment');
    await expect(page.getByLabel('Fragment function', { exact: true })).toHaveValue('BufferAFragment');
    expect((await workspace(page))[`/shaders/${stem}.${language}`]).toBe(source);
    await page.reload();
    await expect.poll(async () => (await workspace(page))[path]).toContain('BufferAFragment');
    expect(JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.BufferA.entryPoints).toEqual({ fragment: 'BufferAFragment' });
  });
  test(`Native defaults create fragment-only ${language} shaders and buffers, with Add and vertex Clear`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByLabel('Default shader mode', { exact: true }).selectOption('native');
    await settings.getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('web-shader-explorer').getByTitle('New Shader').click();
    const dialog = page.getByRole('dialog', { name: 'New Shader' });
    await dialog.getByLabel('Shader name').fill('default-native');
    await dialog.getByLabel('Shader language').selectOption(language);
    await expect(dialog.getByLabel('Shader functions')).toHaveValue('native');
    await dialog.getByRole('button', { name: 'Create Shader' }).click();
    const sourcePath = `/shaders/default-native.${language}`;
    const configPath = '/shaders/default-native.sha.json';
    await expect.poll(async () => (await workspace(page))[sourcePath]).toContain('ImageFragment');
    expect((await workspace(page))[sourcePath]).not.toContain('ImageVertex');
    expect((await workspace(page))[sourcePath]).toContain('coord / iResolution.xy');
    expect((await workspace(page))[sourcePath]).toContain('cos(iTime + uv.xyx');
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await expect(page.getByLabel('Vertex function', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '+ New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Buffer', exact: true }).click();
    const main = page.locator('.tab-content .buffer-details > .config-item').first();
    await main.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(page.getByLabel('Fragment function', { exact: true })).toHaveValue('BufferAFragment');
    await expect(page.getByLabel('Vertex function', { exact: true })).toHaveValue('');
    await expect.poll(async () => (await workspace(page))[sourcePath]).toContain('BufferAFragment');
    await expect(main.getByRole('button', { name: 'Insert', exact: true })).toHaveCount(0);
    expect((await workspace(page))[sourcePath]).not.toContain('BufferAVertex');
    const functions = page.getByLabel('Render entry points', { exact: true });
    await functions.getByRole('group', { name: 'Fragment function controls' }).getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByLabel('Fragment function', { exact: true })).toHaveValue('BufferAFragment2');
    await expect.poll(async () => (await workspace(page))[sourcePath]).toContain('BufferAFragment2');
    const vertex = page.locator('.config-item').filter({ has: page.getByRole('heading', { name: 'Vertex shader', exact: true }) });
    await functions.getByRole('group', { name: 'Vertex function controls' }).getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByLabel('Vertex function', { exact: true })).toHaveValue('BufferAVertex3');
    await expect.poll(async () => (await workspace(page))[sourcePath]).toContain('BufferAVertex3');
    await expect(vertex.getByRole('button', { name: 'Insert', exact: true })).toHaveCount(0);
    await vertex.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(vertex.locator('.config-input')).toHaveValue('');
    await expect(page.getByLabel('Vertex function', { exact: true })).toHaveValue('');
    await expect.poll(async () => JSON.parse((await workspace(page))[configPath]).passes.BufferA.entryPoints).toEqual({ fragment: 'BufferAFragment2' });
    await page.reload();
    await expect.poll(async () => JSON.parse((await workspace(page))[configPath]).passes.BufferA.entryPoints).toEqual({ fragment: 'BufferAFragment2' });
  });
  test(`global mode defaults and buffer-owned Built-in/Native Insert persist for ${language}`, async ({ page }) => {
    const stem = `insert-mode-${language}`;
    const source = language === 'wgsl' ? 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1); }' : 'float4 mainImage(float2 coord) { return float4(1); }';
    await page.route('**/__insert_mode_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' }));
    await page.goto('/__insert_mode_fixture__');
    await workspace(page, [[`${stem}.${language}`, source], [`${stem}.sha.json`, JSON.stringify({ version: '1.0', passes: { Image: {} } })]]);
    await page.goto('/');
    await page.getByTestId(`shader-option-${stem}-${language}`).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByLabel('Default shader mode', { exact: true }).selectOption('native');
    await settings.getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.getByRole('button', { name: '+ New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Buffer', exact: true }).click();
    const main = page.locator('.tab-content .buffer-details > .config-item').first();
    await expect(main.getByLabel('Insert mode')).toHaveValue('native');
    await main.getByLabel('Insert mode').selectOption('hooks');
    await main.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(main.locator('.config-input')).toHaveValue(new RegExp(`\\.${language}$`));
    const configured = await main.locator('.config-input').inputValue();
    const path = configured.startsWith('/') ? configured : `/shaders/${configured.replace(/^\.\//, '')}`;
    const vertex = page.locator('.config-item').filter({ has: page.getByRole('heading', { name: 'Vertex shader', exact: true }) });
    await expect(vertex.getByLabel('Insert mode')).toHaveValue('native');
    await vertex.getByLabel('Insert mode').selectOption('hooks');
    await vertex.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(async () => (await workspace(page))[path]).toContain('mainVertex(');
    expect((await workspace(page))[`/shaders/${stem}.${language}`]).toBe(source);
    await vertex.getByLabel('Insert mode').selectOption('native');
    await vertex.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(page.getByLabel('Vertex function', { exact: true })).toHaveValue('BufferAVertex');
    await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.BufferA.entryPoints.vertex).toBe('BufferAVertex');
    expect((await workspace(page))[`/shaders/${stem}.${language}`]).toBe(source);
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByLabel('Default shader mode')).toHaveValue('native');
  });
}

for (const language of ['glsl', 'slang', 'wgsl']) {
  test(`inserts a shared ${language} vertex hook and applies topology and space after reload`, async ({ page }) => {
    const stem = `shared-vertex-${language}`;
    const source = language === 'wgsl'
      ? 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1, 0, 0, 1); }'
      : language === 'slang' ? 'float4 mainImage(float2 coord) { return float4(1, 0, 0, 1); }'
        : 'void mainImage(out vec4 color, vec2 coord) { color = vec4(1, 0, 0, 1); }';
    await page.route('**/__shared_vertex_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' }));
    await page.goto('/__shared_vertex_fixture__');
    await workspace(page, [[`${stem}.${language}`, source], [`${stem}.sha.json`, JSON.stringify({
      version: '1.0', passes: { Image: { geometry: { type: 'vertices', space: 'clip', vertexCount: 3 } } },
    })]]);
    await page.goto('/');
    await page.getByTestId(`shader-option-${stem}-${language}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    const vertex = page.locator('.config-item').filter({ has: page.getByRole('heading', { name: 'Vertex shader', exact: true }) });
    await vertex.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(vertex.locator('input')).toHaveValue(new RegExp(`${stem}\\.${language}$`));
    const canvas = page.getByTestId('web-preview').locator('.canvas-container canvas').first();
    const centerRed = () => canvas.evaluate(async element => {
      const image = await createImageBitmap(await (await fetch(element.toDataURL())).blob());
      const sample = new OffscreenCanvas(1, 1);
      const context = sample.getContext('2d');
      context.drawImage(image, Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1, 0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[0];
    });
    await expect.poll(centerRed).toBeGreaterThan(240);
    await page.getByLabel('Topology', { exact: true }).selectOption('point-list');
    await expect.poll(centerRed).toBeLessThan(10);
    await page.getByLabel('Topology', { exact: true }).selectOption('triangle-list');
    await expect.poll(centerRed).toBeGreaterThan(240);
    await page.getByLabel('Space', { exact: true }).selectOption('world');
    await expect.poll(async () => {
      const files = await readWorkspaceFiles(page);
      return JSON.parse(files.find(file => file.path.endsWith(`${stem}.sha.json`)).contents).passes.Image.geometry.space;
    }).toBeUndefined();
    await page.getByLabel('Space', { exact: true }).selectOption('clip');
    await expect.poll(centerRed).toBeGreaterThan(240);
    await expect(vertex.getByRole('button', { name: 'Insert', exact: true })).toHaveCount(0);
    await expect.poll(async () => {
      const files = await readWorkspaceFiles(page);
      return (files.find(file => file.path.endsWith(`${stem}.${language}`)).contents.match(/(?:fn|void) mainVertex\(/g) ?? []).length;
    }).toBe(1);
    await page.reload();
    await expect.poll(centerRed).toBeGreaterThan(240);
  });
}

for (const { name, option, extension, vertexPattern } of [
  { name: 'GLSL', option: 'aurora-glsl', extension: 'glsl', vertexPattern: 'void mainVertex' },
  { name: 'Slang', option: 'aurora-slang-slang', extension: 'slang', vertexPattern: 'void mainVertex' },
  { name: 'WGSL', option: 'aurora-wgsl-wgsl', extension: 'wgsl', vertexPattern: 'ptr<function, vec3f>' },
]) {
  test(`opens a created ${name} vertex shader from the Config panel`, async ({ page }) => {
    await page.goto('/');
    await page.getByTestId(`shader-option-${option}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();

    const vertex = page.locator('.config-item').filter({
      has: page.getByRole('heading', { name: 'Vertex shader', exact: true }),
    });
    page.once('dialog', dialog => dialog.accept(dialog.defaultValue()));
    await vertex.getByRole('button', { name: 'Create', exact: true }).click();
    const vertexPath = await vertex.locator('input').inputValue();
    const absoluteVertexPath = vertexPath.startsWith('/') ? vertexPath : `/shaders/${vertexPath.replace(/^\.\//, '')}`;
    await expect(vertex.locator('input')).toHaveValue(new RegExp(`\\.vert\\.${extension}$`));

    await vertex.getByRole('heading', { name: 'Vertex shader', exact: true }).dblclick();
    await expect(page.locator(`[data-testid="file-editor"][data-path="${absoluteVertexPath}"] .monaco-editor`)).toBeVisible();
    await expect(page.locator(`[data-testid="file-editor"][data-path="${absoluteVertexPath}"] .view-lines`)).toContainText(vertexPattern);
    await expect(page.getByTestId('web-preview').locator('.canvas-container canvas').first()).toBeVisible();
  });
}
