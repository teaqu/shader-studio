import { test, expect } from '@playwright/test';
import { readWorkspaceFiles } from './workspace-store.mjs';
import { workspace } from './language-service-fixtures.mjs';

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
    await vertex.getByRole('button', { name: 'Insert', exact: true }).click();
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
